from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from features.workflows import service as workflow_service
from features.workflows.models import WorkflowRunCreate

from .schemas import (
    EvalWorkflowSpec,
    WorkflowEvalCase,
    WorkflowEvalExport,
    WorkflowEvalRunRecord,
    WorkflowEvalSourceRecord,
)


DEFAULT_RESULTS_DIR = Path(__file__).resolve().parent / "results"
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


def _slug(value: str, fallback: str = "workflow-eval") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip().lower()).strip("-._")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    return cleaned or fallback


def _json_safe(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))
    except Exception:
        return str(value)


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


def _record_from_failed_spec(workflow: EvalWorkflowSpec, *, inputs: dict[str, Any], error: str, duration_ms: float) -> WorkflowEvalRunRecord:
    return WorkflowEvalRunRecord(
        workflow_id=workflow.workflow_id,
        label=workflow.label,
        status="failed",
        duration_ms=round(duration_ms, 2),
        notes=workflow.notes,
        inputs=_json_safe(inputs),
        error=error,
    )


def _record_from_run(workflow: EvalWorkflowSpec, *, inputs: dict[str, Any], run, duration_ms: float) -> WorkflowEvalRunRecord:
    result = run.result
    metadata = dict((result.metadata if result else {}) or {})
    usage = metadata.get("usage_accounting") if isinstance(metadata.get("usage_accounting"), dict) else {}
    status = "completed" if run.status == "completed" and result is not None else "failed"
    return WorkflowEvalRunRecord(
        workflow_id=workflow.workflow_id,
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
    )


def run_eval_case(uid: str, case: WorkflowEvalCase) -> WorkflowEvalExport:
    runs: list[WorkflowEvalRunRecord] = []

    for workflow in case.workflows:
        inputs = _merge_inputs(case, workflow)
        selection = workflow.selection or case.document_set.selection
        started_at = time.perf_counter()
        try:
            payload = WorkflowRunCreate(
                workflow_id=workflow.workflow_id,
                selection=selection,
                inputs=inputs,
            )
            run = workflow_service.execute_eval_run(uid, payload)
            duration_ms = (time.perf_counter() - started_at) * 1000
            runs.append(_record_from_run(workflow, inputs=inputs, run=run, duration_ms=duration_ms))
        except HTTPException as exc:
            duration_ms = (time.perf_counter() - started_at) * 1000
            detail = getattr(exc, "detail", None) or str(exc) or "Workflow failed"
            runs.append(_record_from_failed_spec(workflow, inputs=inputs, error=str(detail), duration_ms=duration_ms))
        except Exception as exc:
            duration_ms = (time.perf_counter() - started_at) * 1000
            runs.append(_record_from_failed_spec(workflow, inputs=inputs, error=str(exc) or "Workflow failed", duration_ms=duration_ms))

    return WorkflowEvalExport(
        eval_id=case.eval_id,
        description=case.description,
        app_git_commit=_git_commit(),
        uid=uid,
        document_set=case.document_set,
        metadata=_json_safe(case.metadata),
        runs=runs,
    )


def write_eval_export(export: WorkflowEvalExport, output_dir: str | Path = DEFAULT_RESULTS_DIR) -> Path:
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    timestamp = export.created_at.strftime("%Y%m%dT%H%M%SZ")
    path = target_dir / f"{_slug(export.eval_id)}__{timestamp}.json"
    with path.open("w", encoding="utf-8") as handle:
        json.dump(export.model_dump(mode="json"), handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return path


def run_eval_case_file(uid: str, case_path: str | Path, output_dir: str | Path = DEFAULT_RESULTS_DIR) -> tuple[WorkflowEvalExport, Path]:
    case = load_eval_case(case_path)
    export = run_eval_case(uid, case)
    path = write_eval_export(export, output_dir)
    return export, path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run internal workflow eval cases and export a JSON report.")
    parser.add_argument("--uid", required=True, help="User/tenant uid whose uploaded files should be used for the eval run.")
    parser.add_argument("--case", required=True, help="Path to a workflow eval case JSON file.")
    parser.add_argument("--out", default=str(DEFAULT_RESULTS_DIR), help="Directory where the eval JSON export should be written.")
    args = parser.parse_args()

    export, path = run_eval_case_file(args.uid, args.case, args.out)
    completed = sum(1 for item in export.runs if item.status == "completed")
    failed = sum(1 for item in export.runs if item.status == "failed")
    print(f"Wrote {path}")
    print(f"Completed: {completed}; failed: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
