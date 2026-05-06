from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from features.files import service as files_service
from features.files.schemas import FileItem
from features.rag import chunk_store
from features.workflows.models import WorkflowSelectionIn

from internal.evals.compare import compare_eval_exports, load_eval_export, write_comparison_export
from internal.evals.export import slug, write_comparison_markdown, write_markdown_bundle
from internal.evals.runner import DEFAULT_RESULTS_DIR, DEFAULT_RUBRICS_DIR, load_eval_case, run_eval_case, write_eval_export
from internal.evals.schemas import WorkflowEvalExport

from .schemas import (
    InternalEvalCaseSummary,
    InternalEvalCaseWorkflowSummary,
    InternalEvalCompareRequest,
    InternalEvalCompareResponse,
    InternalEvalFolderOption,
    InternalEvalJob,
    InternalEvalJobMessage,
    InternalEvalResultSummary,
    InternalEvalReviewPayload,
    InternalEvalReviewRecord,
    InternalEvalRunRequest,
    InternalEvalSelectionOptions,
)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
EVAL_ROOT = BACKEND_ROOT / "internal" / "evals"
CASES_DIR = EVAL_ROOT / "cases"
RESULTS_DIR = DEFAULT_RESULTS_DIR
RUBRICS_DIR = DEFAULT_RUBRICS_DIR
REVIEWS_DIR = EVAL_ROOT / "reviews"
JOBS_DIR = EVAL_ROOT / "jobs"

_RUN_LOCK = threading.Lock()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _json_load(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return raw if isinstance(raw, dict) else {}


def _json_write(path: Path, payload: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False, default=str)
        handle.write("\n")
    return path


def _normalize_folder_path(path: str | None) -> str:
    return str(path or "").strip().strip("/")


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        cleaned = str(value or "").strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        out.append(cleaned)
    return out


def _is_within_folder_path(file_folder: str | None, folder_path: str) -> bool:
    target = _normalize_folder_path(folder_path)
    current = _normalize_folder_path(file_folder)
    return bool(target) and (current == target or current.startswith(target + "/"))


def _parent_folder(path: str) -> str | None:
    cleaned = _normalize_folder_path(path)
    if not cleaned or "/" not in cleaned:
        return None
    return cleaned.rsplit("/", 1)[0]


def _folder_name(path: str) -> str:
    cleaned = _normalize_folder_path(path)
    return cleaned.rsplit("/", 1)[-1] if cleaned else "Root"


def _relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(BACKEND_ROOT.resolve())).replace("\\", "/")
    except Exception:
        return str(path)


def _safe_relative_path(value: str, *, default_root: Path, allowed_root: Path = EVAL_ROOT) -> Path:
    raw = str(value or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Path is required")

    candidate = Path(raw)
    if not candidate.is_absolute():
        if raw.startswith("internal/evals/"):
            candidate = BACKEND_ROOT / candidate
        else:
            candidate = default_root / candidate

    try:
        resolved = candidate.resolve()
        allowed = allowed_root.resolve()
        resolved.relative_to(allowed)
    except Exception:
        raise HTTPException(status_code=400, detail="Path is outside the internal eval directory") from None

    if not resolved.exists():
        raise HTTPException(status_code=404, detail="Internal eval file was not found")
    return resolved


def _case_path(value: str) -> Path:
    return _safe_relative_path(value, default_root=CASES_DIR)


def _result_path(value: str) -> Path:
    raw = str(value or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Result is required")
    if raw.endswith(".json") or "/" in raw or "\\" in raw:
        return _safe_relative_path(raw, default_root=RESULTS_DIR)
    safe = slug(raw, fallback="result")
    candidates = [RESULTS_DIR / f"{safe}.json", RESULTS_DIR / raw, RESULTS_DIR / f"{raw}.json"]
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    matches = sorted(RESULTS_DIR.glob(f"{safe}*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    if matches:
        return matches[0].resolve()
    raise HTTPException(status_code=404, detail="Eval result was not found")


def _review_path(result_id: str) -> Path:
    return REVIEWS_DIR / f"{slug(result_id)}.review.json"


def _job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{slug(job_id)}.json"


def _load_job(job_id: str) -> InternalEvalJob:
    path = _job_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Eval job was not found")
    return InternalEvalJob.model_validate(_json_load(path))


def _save_job(job: InternalEvalJob) -> InternalEvalJob:
    _json_write(_job_path(job.id), job.model_dump(mode="json"))
    return job


MAX_JOB_MESSAGES = 80


def _append_job_message(
    job: InternalEvalJob,
    message: str,
    *,
    level: str = "info",
    run_key: str | None = None,
    workflow_id: str | None = None,
    label: str | None = None,
) -> None:
    safe_level = level if level in {"info", "success", "warning", "error"} else "info"
    job.last_message = message
    job.messages.append(
        InternalEvalJobMessage(
            level=safe_level,  # type: ignore[arg-type]
            message=message,
            run_key=run_key,
            workflow_id=workflow_id,
            label=label,
        )
    )
    if len(job.messages) > MAX_JOB_MESSAGES:
        job.messages = job.messages[-MAX_JOB_MESSAGES:]


def _validation_counts_for_run(record: Any) -> tuple[int, int]:
    errors = 0
    warnings = 0
    validation = getattr(record, "validation", None)
    for issue in getattr(validation, "issues", []) or []:
        severity = getattr(issue, "severity", None)
        if severity == "error":
            errors += 1
        elif severity == "warning":
            warnings += 1
    return errors, warnings


def _record_job_progress(job: InternalEvalJob, payload: dict[str, Any]) -> None:
    event = str(payload.get("event") or "")
    total = int(payload.get("total") or 0)
    if total:
        job.total_runs = total

    if event == "case_started":
        job.completed_runs = 0
        job.failed_runs = 0
        job.skipped_runs = 0
        job.validation_error_count = 0
        job.validation_warning_count = 0
        _append_job_message(job, f"Eval started with {job.total_runs} workflow run{'' if job.total_runs == 1 else 's'}.")
        return

    if event == "run_started":
        index = int(payload.get("index") or 0)
        run_key = str(payload.get("run_key") or "")
        workflow_id = str(payload.get("workflow_id") or "")
        label = str(payload.get("label") or "") or workflow_id
        job.current_run_key = run_key or None
        job.current_workflow_id = workflow_id or None
        job.current_label = label or None
        _append_job_message(
            job,
            f"Running {index}/{job.total_runs or total}: {label}",
            run_key=run_key or None,
            workflow_id=workflow_id or None,
            label=label or None,
        )
        return

    if event == "run_finished":
        record = payload.get("record")
        run_key = str(getattr(record, "run_key", "") or "")
        workflow_id = str(getattr(record, "workflow_id", "") or "")
        label = str(getattr(record, "label", "") or "") or workflow_id
        status = str(getattr(record, "status", "") or "")
        errors, warnings = _validation_counts_for_run(record)
        job.validation_error_count += errors
        job.validation_warning_count += warnings

        if status == "completed":
            job.completed_runs += 1
            level = "success" if errors == 0 else "warning"
            suffix = f" · {errors} validation error{'' if errors == 1 else 's'}" if errors else ""
            _append_job_message(job, f"Completed: {label}{suffix}", level=level, run_key=run_key or None, workflow_id=workflow_id or None, label=label or None)
        elif status == "skipped":
            job.skipped_runs += 1
            _append_job_message(job, f"Skipped: {label}", level="warning", run_key=run_key or None, workflow_id=workflow_id or None, label=label or None)
        else:
            job.failed_runs += 1
            error = str(getattr(record, "error", "") or "Workflow run failed")
            _append_job_message(job, f"Failed: {label} — {error}", level="error", run_key=run_key or None, workflow_id=workflow_id or None, label=label or None)
        return

    if event == "case_finished":
        _append_job_message(
            job,
            f"Workflow execution finished: {job.completed_runs} completed, {job.failed_runs} failed, {job.skipped_runs} skipped.",
            level="success" if job.failed_runs == 0 else "warning",
        )



def _case_workflow_key_from_values(workflow_id: str, label: str | None, index: int) -> str:
    label_slug = slug(str(label or "")) if label else str(index)
    return f"{workflow_id}::{label_slug}"


def _case_workflow_key(workflow: Any, index: int) -> str:
    return _case_workflow_key_from_values(
        str(getattr(workflow, "workflow_id", "") or "").strip(),
        str(getattr(workflow, "label", "") or "") or None,
        index,
    )


def _case_workflow_summaries(raw_workflows: list[Any]) -> list[InternalEvalCaseWorkflowSummary]:
    summaries: list[InternalEvalCaseWorkflowSummary] = []
    for index, workflow in enumerate(raw_workflows or [], start=1):
        if not isinstance(workflow, dict):
            continue
        workflow_id = str(workflow.get("workflow_id") or "").strip()
        if not workflow_id:
            continue
        label = workflow.get("label")
        summaries.append(
            InternalEvalCaseWorkflowSummary(
                key=_case_workflow_key_from_values(workflow_id, str(label) if label else None, index),
                index=index,
                workflow_id=workflow_id,
                label=str(label) if label else None,
                modes=[str(item) for item in workflow.get("modes") or [] if str(item or "").strip()],
            )
        )
    return summaries

def _summarize_case(path: Path) -> InternalEvalCaseSummary:
    raw: dict[str, Any] = {}
    try:
        raw = _json_load(path)
    except Exception:
        raw = {}
    stat = path.stat()
    raw_workflows = raw.get("workflows") if isinstance(raw.get("workflows"), list) else []
    return InternalEvalCaseSummary(
        id=_relative(path),
        path=_relative(path),
        eval_id=raw.get("eval_id"),
        description=str(raw.get("description") or ""),
        workflow_count=len(raw_workflows),
        mode=raw.get("mode"),
        workflows=_case_workflow_summaries(raw_workflows),
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
    )


def list_cases() -> list[InternalEvalCaseSummary]:
    if not CASES_DIR.exists():
        return []
    return [_summarize_case(path) for path in sorted(CASES_DIR.rglob("*.json"))]


def list_selection_options(uid: str) -> InternalEvalSelectionOptions:
    files = files_service.list_files(uid)
    folder_paths: set[str] = set()

    for folder in files_service.list_folders(uid):
        path = _normalize_folder_path(getattr(folder, "path", None))
        if path:
            folder_paths.add(path)

    for file_item in files:
        folder = _normalize_folder_path(getattr(file_item, "folder_path", None))
        if not folder:
            continue
        parts = folder.split("/")
        for index in range(1, len(parts) + 1):
            folder_paths.add("/".join(parts[:index]))

    folder_options = [
        InternalEvalFolderOption(
            path=path,
            name=_folder_name(path),
            parent_path=_parent_folder(path),
            direct_file_count=sum(1 for file_item in files if _normalize_folder_path(file_item.folder_path) == path),
            recursive_file_count=sum(1 for file_item in files if _is_within_folder_path(file_item.folder_path, path)),
        )
        for path in sorted(folder_paths, key=lambda item: (item.count("/"), item.lower()))
    ]

    return InternalEvalSelectionOptions(uid=uid, files=files, folders=folder_options)


def _validation_counts(export: WorkflowEvalExport) -> tuple[int, int]:
    errors = 0
    warnings = 0
    for run in export.runs:
        for issue in run.validation.issues:
            if issue.severity == "error":
                errors += 1
            elif issue.severity == "warning":
                warnings += 1
    return errors, warnings


def summarize_result_path(path: Path) -> InternalEvalResultSummary | None:
    if path.name.startswith("comparison__") or path.name.endswith(".review.json"):
        return None
    try:
        export = WorkflowEvalExport.model_validate(_json_load(path))
    except Exception:
        return None
    stat = path.stat()
    errors, warnings = _validation_counts(export)
    result_id = path.stem
    return InternalEvalResultSummary(
        id=result_id,
        path=_relative(path),
        eval_id=export.eval_id,
        description=export.description,
        mode=export.mode,
        created_at=export.created_at,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
        run_count=len(export.runs),
        completed_count=sum(1 for run in export.runs if run.status == "completed"),
        failed_count=sum(1 for run in export.runs if run.status == "failed"),
        skipped_count=sum(1 for run in export.runs if run.status == "skipped"),
        validation_error_count=errors,
        validation_warning_count=warnings,
        has_review=_review_path(result_id).exists(),
    )


def list_results(limit: int = 50) -> list[InternalEvalResultSummary]:
    if not RESULTS_DIR.exists():
        return []
    paths = sorted(RESULTS_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    summaries = [summary for path in paths for summary in [summarize_result_path(path)] if summary is not None]
    return summaries[: max(1, min(limit, 200))]


def get_result(result_id: str) -> dict[str, Any]:
    path = _result_path(result_id)
    payload = _json_load(path)
    payload["_internal"] = {
        "id": path.stem,
        "path": _relative(path),
        "review": get_review(path.stem, missing_ok=True),
    }
    return payload


def get_review(result_id: str, *, missing_ok: bool = False) -> dict[str, Any] | None:
    path = _review_path(result_id)
    if not path.exists():
        if missing_ok:
            return None
        raise HTTPException(status_code=404, detail="Eval review was not found")
    return _json_load(path)


def save_review(result_id: str, payload: InternalEvalReviewPayload, *, uid: str, email: str | None) -> InternalEvalReviewRecord:
    _result_path(result_id)
    record = InternalEvalReviewRecord(
        result_id=slug(result_id),
        updated_by_uid=uid,
        updated_by_email=email,
        reviewer_notes=payload.reviewer_notes,
        run_reviews=payload.run_reviews,
    )
    _json_write(_review_path(result_id), record.model_dump(mode="json"))
    return record


def _clean_manifest_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for value in paths or []:
        path = str(value or "").replace("\\", "/").strip().strip("/")
        parts = [part for part in path.split("/") if part and part != "."]
        normalized = "/".join(parts)
        if normalized and normalized not in seen:
            seen.add(normalized)
            cleaned.append(normalized)
    return cleaned



def _selection_with_manifest_paths(request: InternalEvalRunRequest) -> WorkflowSelectionIn | None:
    manifest_paths = _clean_manifest_paths(request.manifest_paths)
    if request.selection is None and not manifest_paths:
        return None

    selection = request.selection or WorkflowSelectionIn()
    file_paths = _clean_manifest_paths(list(getattr(selection, "file_paths", []) or []))
    if manifest_paths:
        file_paths = _dedupe_preserve_order(file_paths + manifest_paths)

    folder_paths = _dedupe_preserve_order([_normalize_folder_path(path) for path in selection.folder_paths])
    file_ids = _dedupe_preserve_order(list(selection.file_ids))
    current_folder = _normalize_folder_path(selection.current_folder)
    if not current_folder and len(folder_paths) == 1:
        current_folder = folder_paths[0]

    if not file_ids and not file_paths and not folder_paths:
        return None

    return WorkflowSelectionIn(
        file_ids=file_ids,
        file_paths=file_paths,
        folder_paths=folder_paths,
        current_folder=current_folder,
    )


def _file_item_display_path(file_item: FileItem) -> str:
    name = str(file_item.original_name or file_item.name or file_item.id.rsplit("/", 1)[-1]).strip()
    folder = _normalize_folder_path(file_item.folder_path)
    return f"{folder}/{name}" if folder else name


def _selection_app_files(uid: str, selection: WorkflowSelectionIn | None) -> list[FileItem]:
    if selection is None:
        return []

    all_files = files_service.list_files(uid)
    by_id = {item.id: item for item in all_files}
    by_path: dict[str, list[FileItem]] = {}
    selected: list[FileItem] = []

    for item in all_files:
        display_path = _clean_manifest_paths([_file_item_display_path(item)])
        if display_path:
            by_path.setdefault(display_path[0].lower(), []).append(item)

    for file_id in selection.file_ids:
        item = by_id.get(str(file_id or ""))
        if item is not None:
            selected.append(item)

    for folder_path in selection.folder_paths:
        normalized = _normalize_folder_path(folder_path)
        if not normalized:
            continue
        selected.extend(item for item in all_files if _is_within_folder_path(item.folder_path, normalized))

    for file_path in selection.file_paths:
        normalized = _clean_manifest_paths([file_path])
        if not normalized:
            continue
        selected.extend(by_path.get(normalized[0].lower()) or [])

    return _dedupe_app_files(selected)


def _dedupe_app_files(files: list[FileItem]) -> list[FileItem]:
    seen: set[str] = set()
    out: list[FileItem] = []
    for item in files:
        if item.id in seen:
            continue
        seen.add(item.id)
        out.append(item)
    return out


def _validate_app_document_selection(request: InternalEvalRunRequest, *, uid: str) -> None:
    selection = _selection_with_manifest_paths(request)
    selected_files = _selection_app_files(uid, selection)
    if not selected_files:
        raise HTTPException(status_code=400, detail="Select at least one uploaded app document or folder for this eval run")

    missing_chunks: list[str] = []
    for file_item in selected_files:
        payload = chunk_store.load_chunk_artifact(uid, file_item)
        chunks = payload.get("chunks") if isinstance(payload, dict) else None
        if not isinstance(chunks, list) or not chunks:
            missing_chunks.append(_file_item_display_path(file_item) or file_item.id)

    if missing_chunks:
        preview = ", ".join(missing_chunks[:5])
        suffix = f" and {len(missing_chunks) - 5} more" if len(missing_chunks) > 5 else ""
        raise HTTPException(
            status_code=400,
            detail=f"Selected app documents must finish upload processing before eval. Missing chunk artifacts: {preview}{suffix}",
        )




def _workflow_filter_value(value: str | None) -> str:
    return str(value or "").strip()


def _filter_case_workflows(case, request: InternalEvalRunRequest):
    workflow_run_key = _workflow_filter_value(request.workflow_run_key)
    workflow_id = _workflow_filter_value(request.workflow_id)
    if not workflow_run_key and not workflow_id:
        return case, None

    original_workflows = list(case.workflows or [])
    if workflow_run_key:
        selected = [workflow for index, workflow in enumerate(original_workflows, start=1) if _case_workflow_key(workflow, index) == workflow_run_key]
    else:
        selected = [workflow for workflow in original_workflows if str(getattr(workflow, "workflow_id", "") or "").strip() == workflow_id]

    if not selected:
        target = workflow_run_key or workflow_id
        raise HTTPException(status_code=400, detail=f"Selected workflow was not found in this eval case: {target}")

    case.workflows = selected
    return case, {
        "workflow_id": workflow_id or None,
        "workflow_run_key": workflow_run_key or None,
        "matched_count": len(selected),
        "available_count": len(original_workflows),
    }


def _apply_request_overrides(case, request: InternalEvalRunRequest):
    if request.prompt_version:
        case.default_prompt_version = request.prompt_version
    if request.workflow_version:
        case.default_workflow_version = request.workflow_version

    case, workflow_filter = _filter_case_workflows(case, request)

    metadata = dict(case.metadata or {})
    metadata["document_source"] = request.document_source
    if workflow_filter:
        metadata["workflow_filter"] = workflow_filter
    if request.notes:
        metadata["run_notes"] = request.notes

    manifest_paths = _clean_manifest_paths(request.manifest_paths)
    if manifest_paths:
        metadata["manifest_paths"] = manifest_paths
        metadata["manifest_path_count"] = len(manifest_paths)

    selection = _selection_with_manifest_paths(request)
    if selection is not None:
        case.document_set.selection = selection
        if request.apply_selection_to_workflows:
            for workflow in case.workflows:
                workflow.selection = selection
        file_paths = list(getattr(selection, "file_paths", []) or [])
        folder_paths = list(selection.folder_paths)
        metadata["selection_override"] = {
            "file_ids": list(selection.file_ids),
            "file_paths": file_paths,
            "folder_paths": folder_paths,
            "current_folder": selection.current_folder,
            "apply_selection_to_workflows": request.apply_selection_to_workflows,
            "folder_paths_are_recursive": True,
            "file_count": len(selection.file_ids) + len(file_paths),
            "folder_count": len(folder_paths),
        }

    case.metadata = metadata
    return case


def _run_eval_job(job_id: str) -> None:
    with _RUN_LOCK:
        job = _load_job(job_id)
        job.status = "running"
        job.started_at = utc_now()
        job.finished_at = None
        job.error = None
        job.result_id = None
        job.export_path = None
        job.markdown_path = None
        job.comparison_path = None
        job.comparison_markdown_path = None
        job.total_runs = 0
        job.completed_runs = 0
        job.failed_runs = 0
        job.skipped_runs = 0
        job.validation_error_count = 0
        job.validation_warning_count = 0
        job.current_run_key = None
        job.current_workflow_id = None
        job.current_label = None
        job.last_message = None
        job.messages = []
        _append_job_message(job, "Job accepted. Loading manifest and preparing workflow runs.")
        _save_job(job)

        def on_progress(payload: dict[str, Any]) -> None:
            nonlocal job
            _record_job_progress(job, payload)
            _save_job(job)

        try:
            request = job.request
            uid = request.uid or job.requested_by_uid
            case_path = _case_path(request.case_path)
            case = _apply_request_overrides(load_eval_case(case_path), request)
            job.total_runs = len(case.workflows)
            _append_job_message(job, f"Loaded case {case.eval_id} with {job.total_runs} workflow run{'' if job.total_runs == 1 else 's'}.")
            _save_job(job)

            export = run_eval_case(uid, case, mode=request.mode, case_dir=case_path.parent, rubric_dir=RUBRICS_DIR, progress_callback=on_progress)
            _append_job_message(job, "Writing JSON export.")
            _save_job(job)
            export_path = write_eval_export(export, RESULTS_DIR)
            markdown_path = write_markdown_bundle(export, RESULTS_DIR) if request.markdown else None
            if markdown_path:
                _append_job_message(job, "Markdown review bundle written.")

            comparison_path: Path | None = None
            comparison_markdown_path: Path | None = None
            if request.compare_to:
                _append_job_message(job, "Comparing against selected baseline.")
                baseline_path = _result_path(request.compare_to)
                baseline = load_eval_export(baseline_path)
                comparison = compare_eval_exports(export, baseline, current_path=str(export_path), baseline_path=str(baseline_path))
                comparison_path = RESULTS_DIR / f"comparison__{slug(export.eval_id)}__{comparison.created_at.strftime('%Y%m%dT%H%M%SZ')}.json"
                write_comparison_export(comparison, comparison_path)
                if request.markdown:
                    comparison_markdown_path = write_comparison_markdown(comparison, RESULTS_DIR)

            job.status = "completed"
            job.finished_at = utc_now()
            job.current_run_key = None
            job.current_workflow_id = None
            job.current_label = None
            job.result_id = export_path.stem
            job.export_path = _relative(export_path)
            job.markdown_path = _relative(markdown_path) if markdown_path else None
            job.comparison_path = _relative(comparison_path) if comparison_path else None
            job.comparison_markdown_path = _relative(comparison_markdown_path) if comparison_markdown_path else None
            _append_job_message(
                job,
                f"Completed eval job. {job.completed_runs} completed, {job.failed_runs} failed, {job.skipped_runs} skipped.",
                level="success" if job.failed_runs == 0 else "warning",
            )
            _save_job(job)
        except Exception as exc:
            job.status = "failed"
            job.finished_at = utc_now()
            job.current_run_key = None
            job.current_workflow_id = None
            job.current_label = None
            job.error = str(exc) or "Eval job failed"
            _append_job_message(job, job.error, level="error")
            _save_job(job)

def create_job(request: InternalEvalRunRequest, *, uid: str, email: str | None) -> InternalEvalJob:
    # Validate paths before accepting the job so UI errors are immediate.
    _case_path(request.case_path)
    if request.compare_to:
        _result_path(request.compare_to)
    if request.document_source == "app":
        _validate_app_document_selection(request, uid=request.uid or uid)
    job = InternalEvalJob(
        id=f"eval_{uuid.uuid4().hex[:12]}",
        status="queued",
        requested_by_uid=uid,
        requested_by_email=email,
        request=request,
    )
    return _save_job(job)


def run_job_sync(job_id: str) -> None:
    _run_eval_job(job_id)


def get_job(job_id: str) -> InternalEvalJob:
    return _load_job(job_id)


def list_jobs(limit: int = 25) -> list[InternalEvalJob]:
    if not JOBS_DIR.exists():
        return []
    jobs: list[InternalEvalJob] = []
    paths = sorted(JOBS_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    for path in paths[: max(1, min(limit, 100))]:
        try:
            jobs.append(InternalEvalJob.model_validate(_json_load(path)))
        except Exception:
            continue
    return jobs


def compare_results(payload: InternalEvalCompareRequest) -> InternalEvalCompareResponse:
    current_path = _result_path(payload.current_result)
    baseline_path = _result_path(payload.baseline_result)
    current = load_eval_export(current_path)
    baseline = load_eval_export(baseline_path)
    comparison = compare_eval_exports(current, baseline, current_path=str(current_path), baseline_path=str(baseline_path))
    path: Path | None = None
    if payload.write:
        path = RESULTS_DIR / f"comparison__{slug(current.eval_id)}__{comparison.created_at.strftime('%Y%m%dT%H%M%SZ')}.json"
        write_comparison_export(comparison, path)
    return InternalEvalCompareResponse(
        comparison=comparison.model_dump(mode="json"),
        path=_relative(path) if path else None,
    )


def result_file_path(result_id: str) -> Path:
    return _result_path(result_id)
