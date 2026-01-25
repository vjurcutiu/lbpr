from __future__ import annotations

import os
import io
import wave
import audioop
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

# StreamingRecognize: each StreamingRecognizeRequest.audio chunk is limited to 25 KB.
# Ref: https://docs.cloud.google.com/speech-to-text/docs/quotas#content_limits
STT_STREAMING_MAX_CHUNK_BYTES = 25 * 1024


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


def _build_speech_client(location: str):
    """Create a SpeechClient using the configured location + ADC/service-account fallback."""
    SpeechClient, cloud_speech, ClientOptions = _speech_client_and_types()
    endpoint = _endpoint_for_location(location)
    creds = _speech_credentials()
    if endpoint:
        client = SpeechClient(credentials=creds, client_options=ClientOptions(api_endpoint=endpoint))
    else:
        client = SpeechClient(credentials=creds)
    return client, cloud_speech


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


def _maybe_normalize_wav(audio_bytes: bytes, filename: Optional[str], content_type: Optional[str]) -> Tuple[bytes, Optional[dict]]:
    """Best-effort WAV normalization to formats supported by AutoDetectDecodingConfig.

    AutoDetectDecodingConfig supports WAV containers only for specific encodings
    (notably 16-bit PCM, mu-law, a-law). In practice many tools export WAV as
    24-bit PCM or 32-bit float, which results in STT INVALID_ARGUMENT.

    To make uploads more robust, we:
    - validate the WAV container is uncompressed
    - down-mix stereo WAV to mono (common STT requirement)
    - convert 8/24/32-bit integer PCM -> 16-bit PCM

    If we can't safely normalize (e.g. float WAV or >2 channels), we raise a
    clear 415 so the user can re-export.
    """
    ext = _file_ext(filename)
    ct = (content_type or "").lower().strip()
    is_wav = ext == ".wav" or ct in {"audio/wav", "audio/x-wav", "audio/wave"}
    if not is_wav:
        return audio_bytes, None

    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            nch = int(wf.getnchannels())
            sw = int(wf.getsampwidth())
            fr = int(wf.getframerate())
            nframes = int(wf.getnframes())
            comptype = (wf.getcomptype() or "").upper()
            compname = (wf.getcompname() or "").strip()
            frames = wf.readframes(nframes)
    except Exception as e:
        raise HTTPException(
            status_code=415,
            detail=(
                "We couldn't read this WAV file. Please convert it to an uncompressed PCM WAV (16-bit, mono) or FLAC and try again. "
                f"(Parser error: {e})"
            ),
        )

    info = {
        "container": "wav",
        "channels": nch,
        "sample_width_bytes": sw,
        "sample_rate_hz": fr,
        "frames": nframes,
        "duration_seconds": (float(nframes) / float(fr)) if fr else None,
        "comptype": comptype,
        "compname": compname,
        "normalized": False,
    }

    if comptype not in {"NONE", ""}:
        raise HTTPException(
            status_code=415,
            detail=(
                "This WAV appears to be compressed (not PCM). Please convert it to an uncompressed PCM WAV (16-bit, mono) or FLAC and try again."
            ),
        )

    changed = False

    # Down-mix stereo to mono. (We don't attempt >2 channels.)
    if nch == 2:
        try:
            frames = audioop.tomono(frames, sw, 0.5, 0.5)
        except Exception as e:
            raise HTTPException(
                status_code=415,
                detail=(
                    "This WAV has 2 channels but couldn't be down-mixed. Please export it as mono PCM WAV (16-bit) or FLAC and try again. "
                    f"(Down-mix error: {e})"
                ),
            )
        nch = 1
        changed = True
    elif nch != 1:
        raise HTTPException(
            status_code=415,
            detail="This WAV has more than 2 channels. Please export it as mono PCM WAV (16-bit) or FLAC and try again.",
        )

    # Convert integer PCM sample widths to 16-bit.
    if sw != 2:
        try:
            frames = audioop.lin2lin(frames, sw, 2)
        except Exception as e:
            # Common case: 32-bit float WAV is not integer PCM.
            raise HTTPException(
                status_code=415,
                detail=(
                    "This WAV isn't in a supported PCM integer format (often 32-bit float). Please export as 16-bit PCM WAV or FLAC and try again. "
                    f"(Convert error: {e})"
                ),
            )
        sw = 2
        changed = True

    if not changed:
        return audio_bytes, info

    out = io.BytesIO()
    with wave.open(out, "wb") as wo:
        wo.setnchannels(nch)
        wo.setsampwidth(sw)
        wo.setframerate(fr)
        wo.writeframes(frames)

    out_bytes = out.getvalue()
    info["normalized"] = True
    info["out_bytes_len"] = len(out_bytes)
    info["channels"] = nch
    info["sample_width_bytes"] = sw
    return out_bytes, info


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


async def _transcribe_recognize_inline(
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
    """Synchronous Recognize with inline audio bytes.

    This is recommended for uploaded files when within inline limits (<= 10 MiB and ~<= 1 minute).
    """
    _, cloud_speech, _ = _speech_client_and_types()

    project_id = settings.FIREBASE_PROJECT_ID
    location = settings.STT_LOCATION
    client, cloud_speech = _build_speech_client(location)

    config_kwargs = dict(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=language_codes,
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
            language_codes=language_codes,
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
    return text, segments, detected, billed_seconds


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

    Each audio chunk must be <= 25 KB (server-enforced).
    """
    project_id = settings.FIREBASE_PROJECT_ID
    location = settings.STT_LOCATION

    client, cloud_speech = _build_speech_client(location)

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
            language_codes=language_codes,
            location=location,
            model=model_id,
            chunk_bytes=chunk_bytes,
        )
        raise HTTPException(status_code=502, detail=f"Speech-to-Text streaming failed: {e}.{hint}")

    return text, segments, detected, billed_seconds


async def _transcribe_recognize_inline(
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
    """Synchronous Recognize for short audio (inline content).

    This is recommended for transcribing uploaded files when possible. StreamingRecognize is primarily
    meant for real-time audio.
    """
    project_id = settings.FIREBASE_PROJECT_ID
    location = settings.STT_LOCATION

    client, cloud_speech = _build_speech_client(location)

    config_kwargs = dict(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=language_codes,
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
            language_codes=language_codes,
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

    For uploaded files, we prefer synchronous Recognize when within inline limits (fast + recommended by Google).
    If inline recognize fails (often because the audio exceeds the ~1 minute limit), we fall back to streaming
    when enabled.
    """
    unsupported_hint = _looks_like_unsupported_container(filename, content_type)
    if unsupported_hint and not settings.STT_ALLOW_M4A_MP4:
        raise HTTPException(status_code=415, detail=unsupported_hint)

    model_id = model or settings.STT_MODEL

    # App-level safety cap (memory / abuse protection)
    if len(audio_bytes) > int(settings.STT_MAX_BYTES):
        raise HTTPException(status_code=413, detail=f"Audio too large for transcribe (max {int(settings.STT_MAX_BYTES)} bytes).")

    # Best-effort WAV normalization (24-bit/float WAV is a very common INVALID_ARGUMENT cause).
    wav_info: Optional[dict] = None
    try:
        audio_bytes, wav_info = _maybe_normalize_wav(audio_bytes, filename, content_type)
        if wav_info and wav_info.get("normalized"):
            log.info("stt_wav_normalized", uid=uid, filename=filename, info=wav_info)
    except HTTPException:
        # Pass through friendly 415 messages.
        raise

    defaults = _parse_language_codes(settings.STT_DEFAULT_LANGUAGE_CODES)

    # The UI uses a comma-separated input ("en-US,cs-CZ,it-IT"), but FastAPI will parse that as a
    # List[str] with a *single* element unless the query is repeated (?languages=en-US&languages=cs-CZ).
    # If we pass the unsplit value to STT it becomes an invalid BCP-47 language code -> INVALID_ARGUMENT.
    user_codes: List[str] = []
    if language_codes:
        # Support both formats: repeated query params OR a single comma/space-separated string.
        user_codes = _parse_language_codes(",".join([c for c in language_codes if c is not None]))

    codes = user_codes or defaults
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

    use_streaming = bool(getattr(settings, "STT_USE_STREAMING", True))

    # Hard limit for inline recognize payloads
    effective_inline_max = min(int(settings.STT_MAX_BYTES), STT_SYNC_MAX_BYTES)
    can_inline = len(audio_bytes) <= effective_inline_max

    if diar_tuple is not None:
        # Need cloud_speech types to set diarization config.
        _, cloud_speech, _ = _speech_client_and_types()
        features_kwargs["diarization_config"] = cloud_speech.SpeakerDiarizationConfig(
            min_speaker_count=diar_tuple[0],
            max_speaker_count=diar_tuple[1],
        )

    inline_error: Optional[HTTPException] = None
    if can_inline:
        try:
            text, segments, detected, billed_seconds = await _transcribe_recognize_inline(
                uid=uid,
                job_id=job_id,
                audio_bytes=audio_bytes,
                filename=filename,
                content_type=content_type,
                language_codes=codes,
                model_id=model_id,
                features_kwargs=features_kwargs,
            )
        except HTTPException as e:
            inline_error = e
            if not use_streaming:
                raise
            log.warning(
                "stt_inline_failed_fallback_to_streaming",
                uid=uid,
                error=str(e.detail),
                filename=filename,
                content_type=content_type,
                bytes_len=len(audio_bytes),
                location=settings.STT_LOCATION,
                model=model_id,
            )

    if not can_inline or inline_error is not None:
        if not use_streaming:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Audio too large for inline Recognize (max {effective_inline_max} bytes). "
                    "Enable streaming (STT_USE_STREAMING=true) or use batch/async transcription."
                ),
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
