from __future__ import annotations

import os
import logging
from typing import List, Optional, Tuple

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from core.config import settings
from core import tracker as uptrack
from core.rate_limit import add_transcribe_seconds

log = logging.getLogger("transcription.service")


def _parse_language_codes(v: Optional[str]) -> List[str]:
    if not v:
        return []
    parts: List[str] = []
    for chunk in v.replace(" ", ",").split(","):
        c = (chunk or "").strip()
        if c:
            parts.append(c)
    out: List[str] = []
    seen = set()
    for c in parts:
        if c not in seen:
            out.append(c)
            seen.add(c)
    return out


def _speech_client_and_types():
    """Import speech libs lazily so normal API usage doesn't require them in tests."""
    try:
        from google.cloud.speech_v2 import SpeechClient  # type: ignore
        from google.cloud.speech_v2.types import cloud_speech  # type: ignore
        from google.api_core.client_options import ClientOptions  # type: ignore
        return SpeechClient, cloud_speech, ClientOptions
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Speech-to-Text client not installed: {e}")


def _speech_credentials():
    """Prefer ADC; fall back to the same service account JSON used by Firebase Admin."""
    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        return None
    try:
        from google.oauth2 import service_account  # type: ignore
        from core.firebase import choose_cred_path  # type: ignore
        cred_path = choose_cred_path()
        if cred_path and os.path.exists(cred_path):
            return service_account.Credentials.from_service_account_file(cred_path)
    except Exception:
        return None
    return None


def _endpoint_for_location(location: str) -> Optional[str]:
    loc = (location or "").strip()
    if not loc or loc.lower() == "global":
        return None
    return f"{loc}-speech.googleapis.com"


def _recognizer_name(project_id: str, location: str, recognizer_id: str) -> str:
    loc = (location or "global").strip() or "global"
    rid = (recognizer_id or "_").strip() or "_"
    return f"projects/{project_id}/locations/{loc}/recognizers/{rid}"


async def transcribe_bytes(
    *,
    uid: str,
    job_id: str,
    audio_bytes: bytes,
    language_codes: Optional[List[str]] = None,
    model: Optional[str] = None,
    diarization: bool = False,
    min_speakers: Optional[int] = None,
    max_speakers: Optional[int] = None,
) -> Tuple[str, List[str], List[str], int]:
    """Run a synchronous (Recognize) request. Intended for short audio."""
    SpeechClient, cloud_speech, ClientOptions = _speech_client_and_types()

    if len(audio_bytes) > int(settings.STT_MAX_BYTES):
        raise HTTPException(status_code=413, detail=f"Audio too large for inline transcribe (max {settings.STT_MAX_BYTES} bytes).")

    project_id = settings.FIREBASE_PROJECT_ID
    location = settings.STT_LOCATION
    model_id = model or settings.STT_MODEL

    endpoint = _endpoint_for_location(location)
    creds = _speech_credentials()
    if endpoint:
        client = SpeechClient(credentials=creds, client_options=ClientOptions(api_endpoint=endpoint))
    else:
        client = SpeechClient(credentials=creds)

    defaults = _parse_language_codes(settings.STT_DEFAULT_LANGUAGE_CODES)
    codes = (language_codes if (language_codes is not None and len(language_codes) > 0) else defaults) or defaults
    if not codes:
        raise HTTPException(status_code=400, detail="No language codes provided (and STT_DEFAULT_LANGUAGE_CODES is empty).")

    features_kwargs = {}
    if settings.STT_ENABLE_PUNCTUATION:
        features_kwargs["enable_automatic_punctuation"] = True

    diarization_on = diarization or settings.STT_ENABLE_DIARIZATION_DEFAULT
    if diarization_on:
        features_kwargs["diarization_config"] = cloud_speech.SpeakerDiarizationConfig(
            min_speaker_count=int(min_speakers or settings.STT_DIARIZATION_MIN_SPEAKERS),
            max_speaker_count=int(max_speakers or settings.STT_DIARIZATION_MAX_SPEAKERS),
        )

    config_kwargs = dict(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=codes,
        model=model_id,
    )
    if features_kwargs:
        config_kwargs["features"] = cloud_speech.RecognitionFeatures(**features_kwargs)

    config = cloud_speech.RecognitionConfig(**config_kwargs)

    request = cloud_speech.RecognizeRequest(
        recognizer=_recognizer_name(project_id, location, settings.STT_RECOGNIZER_ID),
        config=config,
        content=audio_bytes,
    )

    await uptrack.set_phase(job_id, "transcribe", pct=70)
    try:
        response = await run_in_threadpool(client.recognize, request=request)
    except Exception as e:
        log.exception("stt_recognize_error", uid=uid, error=str(e))
        raise HTTPException(status_code=502, detail=f"Speech-to-Text recognize failed: {e}")

    segments: List[str] = []
    detected: List[str] = []
    for res in getattr(response, "results", []) or []:
        try:
            if getattr(res, "alternatives", None):
                seg = (res.alternatives[0].transcript or "").strip()
                if seg:
                    segments.append(seg)
            lc = getattr(res, "language_code", "") or ""
            if lc and lc not in detected:
                detected.append(lc)
        except Exception:
            continue

    text = " ".join(segments).strip()

    billed_seconds = 0
    try:
        md = getattr(response, "metadata", None)
        dur = getattr(md, "total_billed_duration", None)
        if dur is not None:
            billed_seconds = int(round(float(getattr(dur, "seconds", 0)) + float(getattr(dur, "nanos", 0)) / 1e9))
    except Exception:
        billed_seconds = 0

    # Usage accounting (best-effort)
    try:
        if billed_seconds > 0:
            ok, _used, _cap = await add_transcribe_seconds(uid, billed_seconds)
            if not ok:
                raise HTTPException(status_code=402, detail="Transcription usage limit reached for this billing period.")
    except HTTPException:
        raise
    except Exception:
        log.exception("stt_usage_accounting_error", uid=uid)

    return text, segments, detected, billed_seconds
