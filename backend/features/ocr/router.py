from __future__ import annotations

import uuid
import logging
from typing import List, Optional, Literal

from fastapi import APIRouter, File, UploadFile, HTTPException, Query, Depends

from core import tracker as uptrack
from core.plan import sync_caps_and_plan
from core.config import settings
from core.pii import tokenize_text

from .schemas import OcrResponse
from . import service

# Auth deps
try:
    from features.auth.deps import get_current_user  # type: ignore
    from features.auth.models import SessionOut  # type: ignore
except Exception:  # fallback for local/dev
    def get_current_user():
        class _U:
            uid = "dev"
        return _U()  # type: ignore

    class SessionOut:  # type: ignore
        uid: str = "dev"


router = APIRouter(prefix="/v1/ocr", tags=["OCR"])
log = logging.getLogger("ocr.router")


@router.post("", response_model=OcrResponse)
async def ocr(
    file: UploadFile = File(..., description="Image file to OCR (PNG/JPG/WebP/etc.)"),
    languages: Optional[List[str]] = Query(default=None, description="Optional BCP-47 language hints (e.g. en,cs,it)") ,
    mode: Optional[Literal["document", "text"]] = Query(default=None, description="OCR mode: document (best for dense text) or text"),
    user: SessionOut = Depends(get_current_user),
):
    job_id = str(uuid.uuid4())
    try:
        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Empty image file.")

        if len(image_bytes) > int(settings.OCR_MAX_BYTES):
            raise HTTPException(status_code=413, detail=f"Image too large for OCR (max {settings.OCR_MAX_BYTES} bytes).")

        tracker_filename = file.filename or "image"
        if settings.PII_TOKENIZE_FILENAMES:
            try:
                tracker_filename = tokenize_text(user.uid, tracker_filename)
            except Exception:
                pass

        await uptrack.create_job(job_id=job_id, uid=user.uid, filename=tracker_filename, dataset="ocr", total_bytes=len(image_bytes))
        await sync_caps_and_plan(user.uid)
        await uptrack.set_phase(job_id, "receive", pct=10)
        await uptrack.incr_bytes(job_id, len(image_bytes))

        text = await service.ocr_image_bytes(
            uid=user.uid,
            job_id=job_id,
            image_bytes=image_bytes,
            language_hints=languages,
            mode=mode,
            charge_usage=True,
        )

        await uptrack.set_phase(job_id, "complete", pct=100)
        await uptrack.mark_done(job_id)

        return OcrResponse(job_id=job_id, text=text or "", mode=(mode or settings.OCR_MODE), language_hints=languages or [])
    except HTTPException as e:
        try:
            await uptrack.mark_error(job_id, str(e.detail))
        except Exception:
            pass
        raise
    except Exception as e:
        log.exception("ocr_error", uid=user.uid, error=str(e))
        try:
            await uptrack.mark_error(job_id, str(e))
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"OCR failed: {e}")
