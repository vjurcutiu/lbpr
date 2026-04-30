from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response

from core.config import settings
from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from . import service
from .schemas import (
    InternalEvalCaseSummary,
    InternalEvalCompareRequest,
    InternalEvalCompareResponse,
    InternalEvalJob,
    InternalEvalResultSummary,
    InternalEvalSelectionOptions,
    InternalEvalReviewPayload,
    InternalEvalReviewRecord,
    InternalEvalRunRequest,
    InternalEvalRunResponse,
)

router = APIRouter(prefix="/v1/internal/evals", tags=["internal-evals"])


def _admin_email_set() -> set[str]:
    raw = str(getattr(settings, "INTERNAL_EVAL_ADMIN_EMAILS", "") or "")
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


def require_internal_eval_admin(user: SessionOut = Depends(get_current_user)) -> SessionOut:
    if not getattr(settings, "ENABLE_INTERNAL_EVAL_UI", False):
        raise HTTPException(status_code=404, detail="Not found")

    admins = _admin_email_set()
    if not admins and settings.ENV == "dev":
        return user

    email = str(user.email or "").strip().lower()
    if email and email in admins:
        return user
    raise HTTPException(status_code=403, detail="Internal eval access is not enabled for this account")


@router.get("/status")
def get_internal_eval_status(user: SessionOut = Depends(require_internal_eval_admin)) -> dict[str, object]:
    return {
        "enabled": True,
        "user": {"uid": user.uid, "email": user.email},
        "dev_open_access": not _admin_email_set() and settings.ENV == "dev",
    }


@router.get("/cases", response_model=list[InternalEvalCaseSummary])
def list_eval_cases(user: SessionOut = Depends(require_internal_eval_admin)) -> list[InternalEvalCaseSummary]:
    return service.list_cases()




@router.get("/selection-options", response_model=InternalEvalSelectionOptions)
def list_eval_selection_options(
    uid: str | None = Query(None, description="Optional eval UID. Defaults to the current internal admin user."),
    user: SessionOut = Depends(require_internal_eval_admin),
) -> InternalEvalSelectionOptions:
    target_uid = (uid or user.uid or "").strip()
    if not target_uid:
        raise HTTPException(status_code=400, detail="UID is required")
    return service.list_selection_options(target_uid)


@router.get("/results", response_model=list[InternalEvalResultSummary])
def list_eval_results(
    limit: int = Query(50, ge=1, le=200),
    user: SessionOut = Depends(require_internal_eval_admin),
) -> list[InternalEvalResultSummary]:
    return service.list_results(limit=limit)


@router.get("/results/{result_id}")
def get_eval_result(result_id: str, user: SessionOut = Depends(require_internal_eval_admin)) -> dict:
    return service.get_result(result_id)


@router.get("/results/{result_id}/download")
def download_eval_result(result_id: str, user: SessionOut = Depends(require_internal_eval_admin)) -> Response:
    path = service.result_file_path(result_id)
    return Response(
        content=Path(path).read_text(encoding="utf-8"),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{Path(path).name}"'},
    )


@router.post("/runs", response_model=InternalEvalRunResponse, status_code=202)
def create_eval_run(
    payload: InternalEvalRunRequest,
    background_tasks: BackgroundTasks,
    user: SessionOut = Depends(require_internal_eval_admin),
) -> InternalEvalRunResponse:
    job = service.create_job(payload, uid=user.uid, email=user.email)
    background_tasks.add_task(service.run_job_sync, job.id)
    return InternalEvalRunResponse(job=job)


@router.get("/runs", response_model=list[InternalEvalJob])
def list_eval_jobs(
    limit: int = Query(25, ge=1, le=100),
    user: SessionOut = Depends(require_internal_eval_admin),
) -> list[InternalEvalJob]:
    return service.list_jobs(limit=limit)


@router.get("/runs/{job_id}", response_model=InternalEvalJob)
def get_eval_job(job_id: str, user: SessionOut = Depends(require_internal_eval_admin)) -> InternalEvalJob:
    return service.get_job(job_id)


@router.patch("/results/{result_id}/review", response_model=InternalEvalReviewRecord)
def save_eval_review(
    result_id: str,
    payload: InternalEvalReviewPayload,
    user: SessionOut = Depends(require_internal_eval_admin),
) -> InternalEvalReviewRecord:
    return service.save_review(result_id, payload, uid=user.uid, email=user.email)


@router.post("/compare", response_model=InternalEvalCompareResponse)
def compare_eval_results(
    payload: InternalEvalCompareRequest,
    user: SessionOut = Depends(require_internal_eval_admin),
) -> InternalEvalCompareResponse:
    return service.compare_results(payload)
