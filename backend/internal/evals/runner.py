from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from features.workflows import service as workflow_service
from features.workflows.models import WorkflowRunCreate

from .compare import compare_eval_exports, load_eval_export, write_comparison_export
from .export import slug, write_json, write_markdown_bundle, write_comparison_markdown
from .schemas import (
    EvalRubric,
    EvalWorkflowSpec,
    WorkflowEvalCase,
    WorkflowEvalCriterionScore,
    WorkflowEvalExport,
    WorkflowEvalRunRecord,
    WorkflowEvalSourceRecord,
)
from .validation import validate_eval_run


DEFAULT_RESULTS_DIR = Path(__file__).resolve().parent / "results"
DEFAULT_RUBRICS_DIR = Path(__file__).resolve().parent / "rubrics"
_STRUCTURED_METADATA_KEYS = {
    "workflow_profile",
    "legal_profile",
    "risk_items",
    "clause_items",
    "obligation_items",
    "approval_notes",
    "open_questions",
    "evidence_highlights",
    "suggested_actions",
    "summary_profile",
    "extraction_profile",
    "report_profile",
    "draft_profile",
    "plan_profile",
}


def _json_safe(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))
    except Exception:
        return str(value)


def _fingerprint(value: Any) -> str:
    normalized = json.dumps(_json_safe(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parents[3],
            capture_output=True,
            text=True,
            check=False,
            timeout=2,
        )
    except Exception:
        return None
    commit = result.stdout.strip()
    return commit or None


def load_eval_case(path: str | Path) -> WorkflowEvalCase:
    case_path = Path(path)
    with case_path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return WorkflowEvalCase.model_validate(raw)


def _merge_inputs(case: WorkflowEvalCase, workflow: EvalWorkflowSpec) -> dict[str, Any]:
    inputs = dict(case.default_inputs or {})
    inputs.update(workflow.inputs or {})
    return inputs


def _extract_sources(metadata: dict[str, Any]) -> list[WorkflowEvalSourceRecord]:
    raw_sources = metadata.get("source_files")
    if not isinstance(raw_sources, list):
        return []

    sources: list[WorkflowEvalSourceRecord] = []
    for item in raw_sources:
        if not isinstance(item, dict):
            continue
        sources.append(
            WorkflowEvalSourceRecord(
                file_id=str(item.get("file_id") or ""),
                name=str(item.get("name") or ""),
                folder_path=item.get("folder_path"),
                content_type=item.get("content_type"),
                excerpt_chars=item.get("excerpt_chars"),
                full_text_chars=item.get("full_text_chars"),
                truncated=item.get("truncated"),
                source_kind=item.get("source_kind"),
                chunk_count=item.get("chunk_count"),
            )
        )
    return sources


def _extract_structured_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    structured = {key: metadata[key] for key in sorted(_STRUCTURED_METADATA_KEYS) if key in metadata}
    if "warnings" in metadata:
        structured["warnings"] = metadata["warnings"]
    if "source_file_count" in metadata:
        structured["source_file_count"] = metadata["source_file_count"]
    if "source_record_count" in metadata:
        structured["source_record_count"] = metadata["source_record_count"]
    if "single_source_workflow" in metadata:
        structured["single_source_workflow"] = metadata["single_source_workflow"]
    return _json_safe(structured)


def _rubric_path_from_id(rubric_id: str, rubric_dir: str | Path) -> Path:
    safe = str(rubric_id).strip().replace("\\", "/")
    return Path(rubric_dir) / f"{safe}.json"


def _load_rubric(
    case: WorkflowEvalCase,
    workflow: EvalWorkflowSpec,
    *,
    case_dir: str | Path | None = None,
    rubric_dir: str | Path = DEFAULT_RUBRICS_DIR,
) -> EvalRubric | None:
    if workflow.rubric_path:
        raw_path = Path(workflow.rubric_path)
        path = raw_path if raw_path.is_absolute() else Path(case_dir or ".") / raw_path
        with path.open("r", encoding="utf-8") as handle:
            return EvalRubric.model_validate(json.load(handle))

    if workflow.rubric_id:
        path = _rubric_path_from_id(workflow.rubric_id, rubric_dir)
        with path.open("r", encoding="utf-8") as handle:
            return EvalRubric.model_validate(json.load(handle))

    rubric = case.rubrics.get(workflow.workflow_id)
    if rubric:
        return rubric
    return None


def _criterion_placeholders(rubric: EvalRubric | None) -> list[WorkflowEvalCriterionScore]:
    if not rubric:
        return []
    return [
        WorkflowEvalCriterionScore(
            criterion_id=item.id,
            label=item.label,
            weight=item.weight,
            max_score=item.max_score,
            score=None,
            notes="",
        )
        for item in rubric.criteria
    ]


def _record_fingerprints(
    record: WorkflowEvalRunRecord,
    *,
    workflow: EvalWorkflowSpec,
    selection: Any,
    inputs: dict[str, Any],
) -> WorkflowEvalRunRecord:
    source_payload = [source.model_dump(mode="json") for source in record.sources]
    record.config_fingerprint = _fingerprint(
        {
            "workflow_id": workflow.workflow_id,
            "label": workflow.label,
            "selection": _json_safe(selection),
            "inputs": inputs,
            "workflow_version": record.workflow_version,
            "prompt_version": record.prompt_version,
            "rubric_id": record.rubric_id,
        }
    )
    record.output_fingerprint = _fingerprint(record.output_markdown or "")
    record.structured_metadata_fingerprint = _fingerprint(record.structured_metadata)
    record.source_fingerprint = _fingerprint(source_payload)
    return record


def _run_key(workflow: EvalWorkflowSpec, index: int) -> str:
    label = slug(workflow.label or "") if workflow.label else str(index)
    return f"{workflow.workflow_id}::{label}"


def _record_from_failed_spec(
    workflow: EvalWorkflowSpec,
    *,
    run_key: str,
    inputs: dict[str, Any],
    error: str,
    duration_ms: float,
    workflow_version: str | None,
    prompt_version: str | None,
    rubric: EvalRubric | None,
) -> WorkflowEvalRunRecord:
    return WorkflowEvalRunRecord(
        workflow_id=workflow.workflow_id,
        run_key=run_key,
        label=workflow.label,
        status="failed",
        duration_ms=round(duration_ms, 2),
        notes=workflow.notes,
        inputs=_json_safe(inputs),
        error=error,
        workflow_version=workflow_version,
        prompt_version=prompt_version,
        rubric_id=rubric.rubric_id if rubric else workflow.rubric_id,
        criterion_scores=_criterion_placeholders(rubric),
    )


def _record_from_skipped_spec(
    workflow: EvalWorkflowSpec,
    *,
    run_key: str,
    mode: str,
    inputs: dict[str, Any],
    workflow_version: str | None,
    prompt_version: str | None,
    rubric: EvalRubric | None,
) -> WorkflowEvalRunRecord:
    return WorkflowEvalRunRecord(
        workflow_id=workflow.workflow_id,
        run_key=run_key,
        label=workflow.label,
        status="skipped",
        notes=workflow.notes,
        inputs=_json_safe(inputs),
        error=f"Skipped because mode '{mode}' is not listed in workflow modes: {workflow.modes}",
        workflow_version=workflow_version,
        prompt_version=prompt_version,
        rubric_id=rubric.rubric_id if rubric else workflow.rubric_id,
        criterion_scores=_criterion_placeholders(rubric),
    )


def _record_from_run(
    workflow: EvalWorkflowSpec,
    *,
    run_key: str,
    inputs: dict[str, Any],
    run,
    duration_ms: float,
    workflow_version: str | None,
    prompt_version: str | None,
    rubric: EvalRubric | None,
) -> WorkflowEvalRunRecord:
    result = run.result
    metadata = dict((result.metadata if result else {}) or {})
    usage = metadata.get("usage_accounting") if isinstance(metadata.get("usage_accounting"), dict) else {}
    status = "completed" if run.status == "completed" and result is not None else "failed"
    return WorkflowEvalRunRecord(
        workflow_id=workflow.workflow_id,
        run_key=run_key,
        label=workflow.label,
        status=status,
        run_id=run.id,
        title=run.title,
        capability=str(run.capability or ""),
        duration_ms=round(duration_ms, 2),
        notes=workflow.notes,
        inputs=_json_safe(inputs),
        error=run.error,
        summary=(result.summary if result else "") or "",
        bullets=list(result.bullets if result else []),
        next_actions=list(result.next_actions if result else []),
        output_markdown=(result.preview_markdown if result else "") or "",
        structured_metadata=_extract_structured_metadata(metadata),
        sources=_extract_sources(metadata),
        usage=_json_safe(usage),
        workflow_version=workflow_version,
        prompt_version=prompt_version,
        rubric_id=rubric.rubric_id if rubric else workflow.rubric_id,
        criterion_scores=_criterion_placeholders(rubric),
    )


def _apply_validation_and_fingerprints(
    record: WorkflowEvalRunRecord,
    *,
    workflow: EvalWorkflowSpec,
    selection: Any,
    inputs: dict[str, Any],
    rubric: EvalRubric | None,
) -> WorkflowEvalRunRecord:
    record.validation = validate_eval_run(record, workflow, rubric)
    return _record_fingerprints(record, workflow=workflow, selection=selection, inputs=inputs)


def run_eval_case(
    uid: str,
    case: WorkflowEvalCase,
    *,
    mode: str | None = None,
    case_dir: str | Path | None = None,
    rubric_dir: str | Path = DEFAULT_RUBRICS_DIR,
) -> WorkflowEvalExport:
    active_mode = mode or case.mode or "full"
    runs: list[WorkflowEvalRunRecord] = []

    for index, workflow in enumerate(case.workflows, start=1):
        inputs = _merge_inputs(case, workflow)
        selection = workflow.selection or case.document_set.selection
        workflow_version = workflow.workflow_version or case.default_workflow_version
        prompt_version = workflow.prompt_version or case.default_prompt_version
        run_key = _run_key(workflow, index)
        rubric = _load_rubric(case, workflow, case_dir=case_dir, rubric_dir=rubric_dir)

        if workflow.modes and active_mode not in workflow.modes:
            record = _record_from_skipped_spec(
                workflow,
                run_key=run_key,
                mode=active_mode,
                inputs=inputs,
                workflow_version=workflow_version,
                prompt_version=prompt_version,
                rubric=rubric,
            )
            runs.append(_apply_validation_and_fingerprints(record, workflow=workflow, selection=selection, inputs=inputs, rubric=rubric))
            continue

        started_at = time.perf_counter()
        try:
            payload = WorkflowRunCreate(
                workflow_id=workflow.workflow_id,
                selection=selection,
                inputs=inputs,
            )
            run = workflow_service.execute_eval_run(uid, payload)
            duration_ms = (time.perf_counter() - started_at) * 1000
            record = _record_from_run(
                workflow,
                run_key=run_key,
                inputs=inputs,
                run=run,
                duration_ms=duration_ms,
                workflow_version=workflow_version,
                prompt_version=prompt_version,
                rubric=rubric,
            )
        except HTTPException as exc:
            duration_ms = (time.perf_counter() - started_at) * 1000
            detail = getattr(exc, "detail", None) or str(exc) or "Workflow failed"
            record = _record_from_failed_spec(
                workflow,
                run_key=run_key,
                inputs=inputs,
                error=str(detail),
                duration_ms=duration_ms,
                workflow_version=workflow_version,
                prompt_version=prompt_version,
                rubric=rubric,
            )
        except Exception as exc:
            duration_ms = (time.perf_counter() - started_at) * 1000
            record = _record_from_failed_spec(
                workflow,
                run_key=run_key,
                inputs=inputs,
                error=str(exc) or "Workflow failed",
                duration_ms=duration_ms,
                workflow_version=workflow_version,
                prompt_version=prompt_version,
                rubric=rubric,
            )

        runs.append(_apply_validation_and_fingerprints(record, workflow=workflow, selection=selection, inputs=inputs, rubric=rubric))

    export = WorkflowEvalExport(
        eval_id=case.eval_id,
        description=case.description,
        mode=active_mode,
        app_git_commit=_git_commit(),
        uid=uid,
        document_set=case.document_set,
        metadata=_json_safe(case.metadata),
        runs=runs,
    )
    export.case_fingerprint = _fingerprint(
        {
            "eval_id": case.eval_id,
            "mode": active_mode,
            "document_set": case.document_set.model_dump(mode="json"),
            "default_inputs": case.default_inputs,
            "workflows": [workflow.model_dump(mode="json") for workflow in case.workflows],
            "metadata": case.metadata,
        }
    )
    return export


def write_eval_export(export: WorkflowEvalExport, output_dir: str | Path = DEFAULT_RESULTS_DIR) -> Path:
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    timestamp = export.created_at.strftime("%Y%m%dT%H%M%SZ")
    path = target_dir / f"{slug(export.eval_id)}__{timestamp}.json"
    return write_json(path, export)


def run_eval_case_file(
    uid: str,
    case_path: str | Path,
    output_dir: str | Path = DEFAULT_RESULTS_DIR,
    *,
    mode: str | None = None,
    rubric_dir: str | Path = DEFAULT_RUBRICS_DIR,
    markdown: bool = False,
    compare_to: str | Path | None = None,
) -> tuple[WorkflowEvalExport, Path, Path | None, Path | None, Path | None]:
    case_path = Path(case_path)
    case = load_eval_case(case_path)
    export = run_eval_case(uid, case, mode=mode, case_dir=case_path.parent, rubric_dir=rubric_dir)
    export_path = write_eval_export(export, output_dir)
    markdown_path = write_markdown_bundle(export, output_dir) if markdown else None
    comparison_json_path: Path | None = None
    comparison_markdown_path: Path | None = None
    if compare_to:
        baseline = load_eval_export(compare_to)
        comparison = compare_eval_exports(export, baseline, current_path=str(export_path), baseline_path=str(compare_to))
        timestamp = comparison.created_at.strftime("%Y%m%dT%H%M%SZ")
        comparison_json_path = Path(output_dir) / f"comparison__{slug(export.eval_id)}__{timestamp}.json"
        write_comparison_export(comparison, comparison_json_path)
        if markdown:
            comparison_markdown_path = write_comparison_markdown(comparison, output_dir)
    return export, export_path, markdown_path, comparison_json_path, comparison_markdown_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run internal workflow eval cases and export JSON/markdown reports.")
    parser.add_argument("--uid", required=True, help="User/tenant uid whose uploaded files should be used for the eval run.")
    parser.add_argument("--case", required=True, help="Path to a workflow eval case JSON file.")
    parser.add_argument("--out", default=str(DEFAULT_RESULTS_DIR), help="Directory where eval exports should be written.")
    parser.add_argument("--mode", default=None, help="Optional run mode. Workflows with a modes list only run when this mode is included.")
    parser.add_argument("--rubric-dir", default=str(DEFAULT_RUBRICS_DIR), help="Directory for rubric_id lookups.")
    parser.add_argument("--compare-to", default=None, help="Optional baseline eval JSON export to compare against.")
    parser.add_argument("--markdown", action="store_true", help="Also write a human-readable markdown bundle.")
    args = parser.parse_args()

    export, export_path, markdown_path, comparison_json_path, comparison_markdown_path = run_eval_case_file(
        args.uid,
        args.case,
        args.out,
        mode=args.mode,
        rubric_dir=args.rubric_dir,
        markdown=args.markdown,
        compare_to=args.compare_to,
    )
    completed = sum(1 for item in export.runs if item.status == "completed")
    failed = sum(1 for item in export.runs if item.status == "failed")
    skipped = sum(1 for item in export.runs if item.status == "skipped")
    warnings = sum(1 for run in export.runs for issue in run.validation.issues if issue.severity == "warning")
    errors = sum(1 for run in export.runs for issue in run.validation.issues if issue.severity == "error")
    print(f"Wrote JSON export: {export_path}")
    if markdown_path:
        print(f"Wrote markdown bundle: {markdown_path}")
    if comparison_json_path:
        print(f"Wrote comparison JSON: {comparison_json_path}")
    if comparison_markdown_path:
        print(f"Wrote comparison markdown: {comparison_markdown_path}")
    print(f"Completed: {completed}; failed: {failed}; skipped: {skipped}; validation warnings: {warnings}; validation errors: {errors}")
    return 1 if failed or errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
