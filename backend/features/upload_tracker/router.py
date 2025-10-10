
from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.tracker import get_job, list_jobs
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

@router.get("/jobs", response_model=JobsResponse)
async def jobs(user: SessionOut = Depends(get_current_user)):
    try:
        items = await list_jobs(user.uid, limit=100)
        return JobsResponse(items=[Job(**it) for it in items])  # type: ignore[arg-type]
    except Exception:
        log.exception("jobs_list_error")
        raise HTTPException(status_code=400, detail="Failed to list jobs")

@router.get("/jobs/{job_id}", response_model=Job)
async def job(job_id: str, user: SessionOut = Depends(get_current_user)):
    try:
        m = await get_job(job_id)
        if not m:
            raise HTTPException(status_code=404, detail="Job not found")
        # (Optional) authz: ensure job belongs to user; else 404
        if m.get("uid") != user.uid:
            raise HTTPException(status_code=404, detail="Job not found")
        return Job(**m)  # type: ignore[arg-type]
    except HTTPException:
        raise
    except Exception:
        log.exception("job_get_error", extra={"job_id": job_id})
        raise HTTPException(status_code=400, detail="Failed to get job")
