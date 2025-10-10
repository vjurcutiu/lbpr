from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.tracker import get_job, list_jobs, clear_jobs
from .schemas import Job, JobsResponse

# Auth deps (use same pattern as other features)
try:
    from features.auth.deps import get_current_user  # type: ignore
    from features.auth.models import SessionOut  # type: ignore
except Exception:  # fallback for local/dev
    def get_current_user():
        class _U: uid = "dev"
        return _U()  # type: ignore
    class SessionOut:  # type: ignore
        uid: str = "dev"

router = APIRouter(prefix="/v1/upload-tracker", tags=["Upload Tracker"])
log = logging.getLogger("upload.tracker.router")

class ClearResponse(BaseModel):
    removed: int

@router.get("/jobs", response_model=JobsResponse)
async def jobs(user: SessionOut = Depends(get_current_user)):
    try:
        items = await list_jobs(user.uid, limit=100)
        log.info("ut_api_list_jobs_ok", uid=user.uid, items=len(items))
        return JobsResponse(items=[Job(**it) for it in items])  # type: ignore[arg-type]
    except Exception as e:
        log.exception("ut_api_list_jobs_error", uid=getattr(user, "uid", "unknown"))
        raise HTTPException(status_code=400, detail="Failed to list jobs")

@router.get("/jobs/{job_id}", response_model=Job)
async def job(job_id: str, user: SessionOut = Depends(get_current_user)):
    try:
        m = await get_job(job_id)
        if not m:
            log.info("ut_api_get_job_missing", uid=user.uid, job_id=job_id)
            raise HTTPException(status_code=404, detail="Job not found")
        # (Optional) authz: ensure job belongs to user; else 404
        if m.get("uid") != user.uid:
            log.warning("ut_api_get_job_forbidden", uid=user.uid, job_uid=m.get("uid"), job_id=job_id)
            raise HTTPException(status_code=404, detail="Job not found")
        log.debug("ut_api_get_job_ok", uid=user.uid, job_id=job_id, phase=m.get("phase"), pct=m.get("pct"))
        return Job(**m)  # type: ignore[arg-type]
    except HTTPException:
        raise
    except Exception as e:
        log.exception("ut_api_get_job_error", uid=getattr(user, "uid", "unknown"), job_id=job_id)
        raise HTTPException(status_code=400, detail="Failed to get job")

# NEW: clear tracker entries
@router.delete("/jobs", response_model=ClearResponse)
async def clear(
    scope: Literal["done", "all"] = Query("done", description="What to clear: 'done' (default) or 'all'"),
    user: SessionOut = Depends(get_current_user)
):
    try:
        removed = await clear_jobs(user.uid, only_done=(scope == "done"))
        log.info("ut_api_clear_jobs_ok", uid=user.uid, scope=scope, removed=removed)
        return ClearResponse(removed=removed)
    except Exception:
        log.exception("ut_api_clear_jobs_error", uid=getattr(user, "uid", "unknown"), scope=scope)
        raise HTTPException(status_code=400, detail="Failed to clear tracker")
