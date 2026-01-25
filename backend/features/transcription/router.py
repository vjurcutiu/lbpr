from __future__ import annotations

import uuid
import logging
from typing import List, Optional

from fastapi import APIRouter, File, UploadFile, HTTPException, Query, Depends

from core import tracker as uptrack
from core.plan import sync_caps_and_plan
from .schemas import TranscribeResponse
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

router = APIRouter(prefix="/v1/transcribe", tags=["Transcription"])
log = logging.getLogger("transcription.router")


@router.post("", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(..., description="Audio file to transcribe (short audio; inline recognize)"),
    languages: Optional[List[str]] = Query(default=None, description="Expected BCP-47 language codes, e.g. en-US,cs-CZ,it-IT"),
    model: Optional[str] = Query(default=None, description="Override model identifier, e.g. chirp_3"),
    diarization: Optional[bool] = Query(default=None, description="Enable speaker diarization"),
    min_speakers: Optional[int] = Query(default=None, ge=1, le=20),
    max_speakers: Optional[int] = Query(default=None, ge=1, le=20),
    user: SessionOut = Depends(get_current_user),
):
    job_id = str(uuid.uuid4())
    try:
        # read bytes
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file.")
        await uptrack.create_job(job_id=job_id, uid=user.uid, filename=file.filename or "audio", dataset="transcription", total_bytes=len(audio_bytes))
        await sync_caps_and_plan(user.uid)
        await uptrack.set_phase(job_id, "receive", pct=10)
        await uptrack.incr_bytes(job_id, len(audio_bytes))
        await uptrack.set_phase(job_id, "upload", pct=30)

        text, segments, detected, billed_seconds = await service.transcribe_bytes(
            uid=user.uid,
            job_id=job_id,
            audio_bytes=audio_bytes,
            language_codes=languages,
            model=model,
            diarization=bool(diarization) if diarization is not None else False,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )

        await uptrack.set_phase(job_id, "complete", pct=100)
        await uptrack.mark_done(job_id)

        return TranscribeResponse(
            job_id=job_id,
            text=text,
            segments=segments,
            detected_languages=detected,
            billed_seconds=billed_seconds,
            model=model or service.settings.STT_MODEL,
            location=service.settings.STT_LOCATION,
        )
    except HTTPException as e:
        try:
            await uptrack.mark_error(job_id, str(e.detail))
        except Exception:
            pass
        raise
    except Exception as e:
        log.exception("transcribe_error", error=str(e))
        try:
            await uptrack.mark_error(job_id, str(e))
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
