from __future__ import annotations

import os
import logging
from typing import List, Optional, Tuple, Iterable

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from core.config import settings
from core import tracker as uptrack
from core.rate_limit import add_transcribe_seconds

log = logging.getLogger("transcription.service")


# Cloud Speech-to-Text synchronous Recognize limits (inline content).
# Docs: 10 MiB or ~1 minute of audio (whichever comes first).
STT_SYNC_MAX_BYTES = 10 * 1024 * 1024

# StreamingRecognize: each StreamingRecognizeRequest.audio chunk is limited to 15 KB.
STT_STREAMING_MAX_CHUNK_BYTES = 15 * 1024


def _file_ext(filename: Optional[str]) -> str:
    fn = (filename or "").strip().lower()
    if not fn or "." not in fn:
        return ""
    return "." + fn.rsplit(".", 1)[-1]


def _looks_like_unsupported_container(filename: Optional[str], content_type: Optional[str]) -> Optional[str]:
    """Return a human hint if the file likely isn't directly supported by our STT settings.

    Speech-to-Text supports many encodings, but container/codec support can be finicky depending on model/region.
    We optionally early-reject the most common problematic uploads to avoid opaque INVALID_ARGUMENT errors.
    """
    ext = _file_ext(filename)
    ct = (content_type or "").lower().strip()

    if ext in {".m4a", ".mp4", ".aac", ".caf"} or ct in {"audio/mp4", "video/mp4", "audio/aac", "audio/x-m4a"}:
        return (
            "This looks like an M4A/MP4/AAC audio file. If Speech-to-Text rejects it, convert it to WAV/FLAC/MP3/OGG_OPUS/WEBM_OPUS and try again."
        )
    return None


def _hint_for_invalid_argument(*, audio_bytes_len: int, filename: Optional[str], content_type: Optional[str]) -> str:
    if audio_bytes_len > STT_SYNC_MAX_BYTES:
        return (
            f" Inline Recognize requests are limited to {STT_SYNC_MAX_BYTES} bytes (10 MiB) and ~1 minute of audio. "
            f"Your upload is {audio_bytes_len} bytes. We will attempt streaming transcription, but you may need batch/async transcription for very long files."
        )
    maybe = _looks_like_unsupported_container(filename, content_type)
    if maybe:
        return " " + maybe
    return (
        " Common causes: unsupported audio encoding/container, audio longer than ~1 minute for synchronous requests, "
        "or a model/region mismatch (e.g., if `chirp_3` isn't available for your project/location, try `chirp_2`)."
    )


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


def _chunk_audio(audio: bytes, chunk_bytes: int) -> Iterable[bytes]:
    size = len(audio)
    for i in range(0, size, chunk_bytes):
        yield audio[i : i + chunk_bytes]


def _billed_seconds_from_metadata(md) -> int:
    try:
        if md is None:
            return 0
        dur = getattr(md, "total_billed_duration", None)
        if dur is None:
            return 0
        return int(round(float(getattr(dur, "seconds", 0)) + float(getattr(dur, "nanos", 0)) / 1e9))
    except Exception:
        return 0


def _supports_diarization_for_model(model_id: str) -> bool:
    # Chirp 3 diarization is BatchRecognize-only per docs.
    m = (model_id or "").strip().lower()
    if m == "chirp_3":
        return False
    return True


async def _transcribe_streaming(
    *,
    uid: str,
    job_id: str,
    audio_bytes: bytes,
    filename: Optional[str],
    content_type: Optional[str],
    language_codes: List[str],
    model_id: str,
    features_kwargs: dict,
) -> Tuple[str, List[str], List[str], int]:
    """StreamingRecognize for longer-than-1-minute audio and to avoid inline payload limits.

    Each audio chunk must be <= 15 KB (server-enforced).
    """
    SpeechClient, cloud_speech, ClientOptions = _speech_client_and_types()

    project_id = settings.FIREBASE_PROJECT_ID
    location = settings.STT_LOCATION

    endpoint = _endpoint_for_location(location)
    creds = _speech_credentials()
    if endpoint:
        client = SpeechClient(credentials=creds, client_options=ClientOptions(api_endpoint=endpoint))
    else:
        client = SpeechClient(credentials=creds)

    config_kwargs = dict(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=language_codes,
        model=model_id,
    )
    if features_kwargs:
        config_kwargs["features"] = cloud_speech.RecognitionFeatures(**features_kwargs)

    recognition_config = cloud_speech.RecognitionConfig(**config_kwargs)
    streaming_config = cloud_speech.StreamingRecognitionConfig(config=recognition_config)

    config_request = cloud_speech.StreamingRecognizeRequest(
        recognizer=_recognizer_name(project_id, location, settings.STT_RECOGNIZER_ID),
        streaming_config=streaming_config,
    )

    chunk_bytes = int(getattr(settings, "STT_STREAMING_CHUNK_BYTES", 15000) or 15000)
    chunk_bytes = max(1024, min(chunk_bytes, STT_STREAMING_MAX_CHUNK_BYTES))

    def request_iter():
        yield config_request
        for chunk in _chunk_audio(audio_bytes, chunk_bytes):
            yield cloud_speech.StreamingRecognizeRequest(audio=chunk)

    await uptrack.set_phase(job_id, "transcribe", pct=70)

    def _run():
        segments: List[str] = []
        detected: List[str] = []
        billed_seconds = 0
        saw_any_final = False

        for resp in client.streaming_recognize(requests=request_iter()):
            billed_seconds = max(billed_seconds, _billed_seconds_from_metadata(getattr(resp, "metadata", None)))

            for res in getattr(resp, "results", []) or []:
                try:
                    is_final = bool(getattr(res, "is_final", False))
                    if is_final:
                        saw_any_final = True
                    if getattr(res, "alternatives", None):
                        seg = (res.alternatives[0].transcript or "").strip()
                        if seg and (is_final or not saw_any_final):
                            segments.append(seg)
                    lc = getattr(res, "language_code", "") or ""
                    if lc and lc not in detected:
                        detected.append(lc)
                except Exception:
                    continue

        text = " ".join(segments).strip()
        return text, segments, detected, billed_seconds

    try:
        text, segments, detected, billed_seconds = await run_in_threadpool(_run)
    except Exception as e:
        hint = ""
        try:
            from google.api_core.exceptions import InvalidArgument  # type: ignore
            if isinstance(e, InvalidArgument):
                hint = _hint_for_invalid_argument(audio_bytes_len=len(audio_bytes), filename=filename, content_type=content_type)
        except Exception:
            hint = _hint_for_invalid_argument(audio_bytes_len=len(audio_bytes), filename=filename, content_type=content_type)

        log.exception(
            "stt_streaming_error",
            uid=uid,
            error=str(e),
            filename=filename,
            content_type=content_type,
            bytes_len=len(audio_bytes),
            location=location,
            model=model_id,
            chunk_bytes=chunk_bytes,
        )
        raise HTTPException(status_code=502, detail=f"Speech-to-Text streaming failed: {e}.{hint}")

    return text, segments, detected, billed_seconds


async def transcribe_bytes(
    *,
    uid: str,
    job_id: str,
    audio_bytes: bytes,
    filename: Optional[str] = None,
    content_type: Optional[str] = None,
    language_codes: Optional[List[str]] = None,
    model: Optional[str] = None,
    diarization: bool = False,
    min_speakers: Optional[int] = None,
    max_speakers: Optional[int] = None,
) -> Tuple[str, List[str], List[str], int]:
    """Transcribe an audio upload.

    Default path is StreamingRecognize (more robust for >1 minute audio and avoids inline payload limits).
    """
    unsupported_hint = _looks_like_unsupported_container(filename, content_type)
    if unsupported_hint and not settings.STT_ALLOW_M4A_MP4:
        raise HTTPException(status_code=415, detail=unsupported_hint)

    # App-level safety cap (memory / abuse protection)
    if len(audio_bytes) > int(settings.STT_MAX_BYTES):
        raise HTTPException(status_code=413, detail=f"Audio too large for transcribe (max {int(settings.STT_MAX_BYTES)} bytes).")

    model_id = model or settings.STT_MODEL

    defaults = _parse_language_codes(settings.STT_DEFAULT_LANGUAGE_CODES)
    codes = (language_codes if (language_codes is not None and len(language_codes) > 0) else defaults) or defaults
    if not codes:
        raise HTTPException(status_code=400, detail="No language codes provided (and STT_DEFAULT_LANGUAGE_CODES is empty).")

    # Features (build without importing cloud_speech yet)
    features_kwargs = {}
    if settings.STT_ENABLE_PUNCTUATION:
        features_kwargs["enable_automatic_punctuation"] = True

    diarization_on = diarization or settings.STT_ENABLE_DIARIZATION_DEFAULT
    diar_tuple: Optional[Tuple[int, int]] = None
    if diarization_on:
        if not _supports_diarization_for_model(model_id):
            raise HTTPException(
                status_code=400,
                detail=f"Speaker diarization isn't supported for model '{model_id}' via Recognize/StreamingRecognize. Use BatchRecognize for diarization.",
            )
        diar_tuple = (
            int(min_speakers or settings.STT_DIARIZATION_MIN_SPEAKERS),
            int(max_speakers or settings.STT_DIARIZATION_MAX_SPEAKERS),
        )

    # Prefer streaming unless explicitly disabled.
    if bool(getattr(settings, "STT_USE_STREAMING", True)):
        if diar_tuple is not None:
            # Need cloud_speech types to set diarization config.
            _, cloud_speech, _ = _speech_client_and_types()
            features_kwargs["diarization_config"] = cloud_speech.SpeakerDiarizationConfig(
                min_speaker_count=diar_tuple[0],
                max_speaker_count=diar_tuple[1],
            )

        text, segments, detected, billed_seconds = await _transcribe_streaming(
            uid=uid,
            job_id=job_id,
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type,
            language_codes=codes,
            model_id=model_id,
            features_kwargs=features_kwargs,
        )
    else:
        SpeechClient, cloud_speech, ClientOptions = _speech_client_and_types()

        project_id = settings.FIREBASE_PROJECT_ID
        location = settings.STT_LOCATION

        endpoint = _endpoint_for_location(location)
        creds = _speech_credentials()
        if endpoint:
            client = SpeechClient(credentials=creds, client_options=ClientOptions(api_endpoint=endpoint))
        else:
            client = SpeechClient(credentials=creds)

        # Hard limit for inline recognize payloads
        effective_max = min(int(settings.STT_MAX_BYTES), STT_SYNC_MAX_BYTES)
        if len(audio_bytes) > effective_max:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Audio too large for inline Recognize (max {effective_max} bytes). "
                    "Enable streaming (STT_USE_STREAMING=true) or use batch/async transcription."
                ),
            )

        if diar_tuple is not None:
            features_kwargs["diarization_config"] = cloud_speech.SpeakerDiarizationConfig(
                min_speaker_count=diar_tuple[0],
                max_speaker_count=diar_tuple[1],
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
            hint = ""
            try:
                from google.api_core.exceptions import InvalidArgument  # type: ignore
                if isinstance(e, InvalidArgument):
                    hint = _hint_for_invalid_argument(audio_bytes_len=len(audio_bytes), filename=filename, content_type=content_type)
            except Exception:
                hint = _hint_for_invalid_argument(audio_bytes_len=len(audio_bytes), filename=filename, content_type=content_type)

            log.exception(
                "stt_recognize_error",
                uid=uid,
                error=str(e),
                filename=filename,
                content_type=content_type,
                bytes_len=len(audio_bytes),
                location=location,
                model=model_id,
            )
            raise HTTPException(status_code=502, detail=f"Speech-to-Text recognize failed: {e}.{hint}")

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
        billed_seconds = _billed_seconds_from_metadata(getattr(response, "metadata", None))

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
