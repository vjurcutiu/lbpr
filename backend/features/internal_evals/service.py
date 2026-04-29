from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from internal.evals.compare import compare_eval_exports, load_eval_export, write_comparison_export
from internal.evals.export import slug, write_comparison_markdown, write_markdown_bundle
from internal.evals.runner import DEFAULT_RESULTS_DIR, DEFAULT_RUBRICS_DIR, load_eval_case, run_eval_case, write_eval_export
from internal.evals.schemas import WorkflowEvalExport

from .schemas import (
    InternalEvalCaseSummary,
    InternalEvalCompareRequest,
    InternalEvalCompareResponse,
    InternalEvalJob,
    InternalEvalResultSummary,
    InternalEvalReviewPayload,
    InternalEvalReviewRecord,
    InternalEvalRunRequest,
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


def _summarize_case(path: Path) -> InternalEvalCaseSummary:
    raw: dict[str, Any] = {}
    try:
        raw = _json_load(path)
    except Exception:
        raw = {}
    stat = path.stat()
    return InternalEvalCaseSummary(
        id=_relative(path),
        path=_relative(path),
        eval_id=raw.get("eval_id"),
        description=str(raw.get("description") or ""),
        workflow_count=len(raw.get("workflows") or []),
        mode=raw.get("mode"),
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
    )


def list_cases() -> list[InternalEvalCaseSummary]:
    if not CASES_DIR.exists():
        return []
    return [_summarize_case(path) for path in sorted(CASES_DIR.rglob("*.json"))]


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


def _apply_request_overrides(case, request: InternalEvalRunRequest):
    if request.prompt_version:
        case.default_prompt_version = request.prompt_version
    if request.workflow_version:
        case.default_workflow_version = request.workflow_version
    if request.notes:
        metadata = dict(case.metadata or {})
        metadata["run_notes"] = request.notes
        case.metadata = metadata
    return case


def _run_eval_job(job_id: str) -> None:
    with _RUN_LOCK:
        job = _load_job(job_id)
        job.status = "running"
        job.started_at = utc_now()
        _save_job(job)

        try:
            request = job.request
            uid = request.uid or job.requested_by_uid
            case_path = _case_path(request.case_path)
            case = _apply_request_overrides(load_eval_case(case_path), request)
            export = run_eval_case(uid, case, mode=request.mode, case_dir=case_path.parent, rubric_dir=RUBRICS_DIR)
            export_path = write_eval_export(export, RESULTS_DIR)
            markdown_path = write_markdown_bundle(export, RESULTS_DIR) if request.markdown else None

            comparison_path: Path | None = None
            comparison_markdown_path: Path | None = None
            if request.compare_to:
                baseline_path = _result_path(request.compare_to)
                baseline = load_eval_export(baseline_path)
                comparison = compare_eval_exports(export, baseline, current_path=str(export_path), baseline_path=str(baseline_path))
                comparison_path = RESULTS_DIR / f"comparison__{slug(export.eval_id)}__{comparison.created_at.strftime('%Y%m%dT%H%M%SZ')}.json"
                write_comparison_export(comparison, comparison_path)
                if request.markdown:
                    comparison_markdown_path = write_comparison_markdown(comparison, RESULTS_DIR)

            job.status = "completed"
            job.finished_at = utc_now()
            job.result_id = export_path.stem
            job.export_path = _relative(export_path)
            job.markdown_path = _relative(markdown_path) if markdown_path else None
            job.comparison_path = _relative(comparison_path) if comparison_path else None
            job.comparison_markdown_path = _relative(comparison_markdown_path) if comparison_markdown_path else None
            _save_job(job)
        except Exception as exc:
            job.status = "failed"
            job.finished_at = utc_now()
            job.error = str(exc) or "Eval job failed"
            _save_job(job)


def create_job(request: InternalEvalRunRequest, *, uid: str, email: str | None) -> InternalEvalJob:
    # Validate paths before accepting the job so UI errors are immediate.
    _case_path(request.case_path)
    if request.compare_to:
        _result_path(request.compare_to)
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
