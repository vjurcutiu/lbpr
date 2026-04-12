from __future__ import annotations

import logging
import math
import os
import tempfile
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

from fastapi import HTTPException

from core.config import settings
from core.business_metrics import record_openai_duration
from core.rate_limit import add_transcribe_seconds
from core import tracker as uptrack

try:
    from openai import OpenAI
except Exception as e:  # pragma: no cover
    OpenAI = None  # type: ignore
    _openai_import_err = e


log = logging.getLogger("transcription.service")

# OpenAI Audio API currently supports these upload formats.
SUPPORTED_EXTENSIONS = {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}
OPENAI_MAX_BYTES = 25 * 1024 * 1024


def _parse_language_codes(csv: str) -> List[str]:
    parts = [p.strip() for p in (csv or "").split(",")]
    return [p for p in parts if p]


def _primary_lang(code: str) -> str:
    """Convert BCP-47 (en-US) → primary language tag (en)."""
    code = (code or "").strip()
    if not code:
        return ""
    return code.split("-")[0].lower()


def _ext_from_filename(filename: Optional[str]) -> str:
    fn = (filename or "").strip().lower()
    if "." not in fn:
        return ""
    return fn.rsplit(".", 1)[-1]


def _effective_max_bytes() -> int:
    try:
        user_cap = int(getattr(settings, "STT_MAX_BYTES", OPENAI_MAX_BYTES) or OPENAI_MAX_BYTES)
    except Exception:
        user_cap = OPENAI_MAX_BYTES
    return max(1, min(user_cap, OPENAI_MAX_BYTES))


def _usage_seconds_from_openai(resp: object) -> int:
    """Best-effort extraction of billed seconds from OpenAI transcription responses.

    Priority:
      1) resp.usage.seconds (duration-billed models)
      2) resp.duration
      3) token-billed: resp.usage.input_token_details.audio_tokens → seconds (10 tokens/sec)
    """

    # 1) duration usage
    try:
        usage = getattr(resp, "usage", None)
        sec = getattr(usage, "seconds", None)
        if sec is None and isinstance(usage, dict):
            sec = usage.get("seconds")
        if sec is not None:
            return int(max(0, math.ceil(float(sec))))
    except Exception:
        pass

    # 2) explicit duration
    try:
        dur = getattr(resp, "duration", None)
        if dur is None and isinstance(resp, dict):
            dur = resp.get("duration")
        if dur is not None:
            return int(max(0, math.ceil(float(dur))))
    except Exception:
        pass

    # 3) audio tokens → seconds (approx 10 audio tokens per second for user audio)
    # See OpenAI docs: 1 audio token per 100ms for input audio.
    try:
        usage = getattr(resp, "usage", None)
        itd = getattr(usage, "input_token_details", None)
        if isinstance(usage, dict):
            itd = usage.get("input_token_details")
        audio_tokens = None
        if isinstance(itd, dict):
            audio_tokens = itd.get("audio_tokens")
        else:
            audio_tokens = getattr(itd, "audio_tokens", None)
        if audio_tokens is not None:
            return int(max(0, math.ceil(float(audio_tokens) / 10.0)))
    except Exception:
        pass

    return 0


@dataclass
class TranscribeResult:
    text: str
    segments: List[str]
    detected_languages: List[str]
    billed_seconds: int
    model: str
    location: str


async def transcribe_bytes(
    *,
    uid: str,
    job_id: str,
    audio_bytes: bytes,
    filename: Optional[str],
    content_type: Optional[str],
    language_codes: Optional[List[str]],
    model: Optional[str],
    diarization: bool,
    min_speakers: Optional[int] = None,  # kept for API compatibility
    max_speakers: Optional[int] = None,  # kept for API compatibility
) -> Tuple[str, List[str], List[str], int, str]:
    """Transcribe audio bytes using OpenAI's Audio API.

    Returns: (text, segments, detected_languages, billed_seconds, used_model)
    """

    if OpenAI is None:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"OpenAI SDK not installed/available: {_openai_import_err}")

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    # Validate size
    max_bytes = _effective_max_bytes()
    if len(audio_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Audio too large for transcription (max {max_bytes} bytes; OpenAI limit is {OPENAI_MAX_BYTES} bytes).",
        )

    # Validate extension (OpenAI supports a fixed set)
    ext = _ext_from_filename(filename)
    if ext and ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio format '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}.",
        )

    # Determine language
    defaults = _parse_language_codes(getattr(settings, "STT_DEFAULT_LANGUAGE_CODES", "") or "")
    lcs = [c for c in (language_codes or []) if (c or "").strip()] or defaults
    primary = _primary_lang(lcs[0]) if lcs else ""

    # Determine model
    used_model = (model or "").strip() or getattr(settings, "STT_MODEL", "gpt-4o-mini-transcribe")
    if diarization:
        used_model = (model or "").strip() or getattr(settings, "STT_MODEL_DIARIZE", "gpt-4o-transcribe-diarize")

    # Ensure API key is present
    api_key = getattr(settings, "OPENAI_API_KEY", None) or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")

    client = OpenAI(api_key=api_key)

    # Use a temp file to guarantee filename/extension for multipart.
    suffix = f".{ext}" if ext else ""
    text = ""
    segments: List[str] = []
    detected: List[str] = []
    billed_seconds = 0

    try:
        await uptrack.set_phase(job_id, "transcribe", pct=60)
    except Exception:
        pass

    try:
        with tempfile.NamedTemporaryFile(prefix="lbpr-audio-", suffix=suffix, delete=True) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            tmp.seek(0)

            # openai-python expects bytes, PathLike, io.IOBase, or a (filename, contents, media_type) tuple.
            # tempfile.NamedTemporaryFile returns a _TemporaryFileWrapper, so pass the underlying file handle via a tuple.
            upload_name = (filename or (f"audio{suffix}" if suffix else "audio"))
            file_param = (upload_name, tmp.file, (content_type or "application/octet-stream"))

            # For diarization, request diarized_json + auto chunking.
            if diarization:
                call_t0 = time.perf_counter()
                try:
                    resp = client.audio.transcriptions.create(
                        model=used_model,
                        file=file_param,
                        response_format="diarized_json",
                        chunking_strategy="auto",
                    )
                except Exception:
                    record_openai_duration(
                        operation="audio.transcriptions.create",
                        dur_ms=(time.perf_counter() - call_t0) * 1000,
                        status="error",
                    )
                    raise
                record_openai_duration(
                    operation="audio.transcriptions.create",
                    dur_ms=(time.perf_counter() - call_t0) * 1000,
                    status="ok",
                )
                # Response includes segments with speaker labels
                try:
                    segs = getattr(resp, "segments", None)
                    if segs is None and isinstance(resp, dict):
                        segs = resp.get("segments")
                    if isinstance(segs, list):
                        for s in segs:
                            try:
                                speaker = (s.get("speaker") if isinstance(s, dict) else getattr(s, "speaker", "")) or ""
                                t = (s.get("text") if isinstance(s, dict) else getattr(s, "text", "")) or ""
                                t = str(t).strip()
                                if not t:
                                    continue
                                if speaker:
                                    segments.append(f"{speaker}: {t}")
                                else:
                                    segments.append(t)
                            except Exception:
                                continue
                except Exception:
                    pass

                text = (getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else "") or "").strip()
                if not text and segments:
                    text = "\n".join(segments).strip()
                billed_seconds = _usage_seconds_from_openai(resp)

            else:
                # Prefer high quality transcribe models by default; request JSON.
                # Some response variants may not include duration; we derive seconds best-effort.
                kwargs = {
                    "model": used_model,
                    "file": file_param,
                    "response_format": "json",
                }
                # Provide language when we have it (helps performance on some models)
                if primary:
                    kwargs["language"] = primary
                call_t0 = time.perf_counter()
                try:
                    resp = client.audio.transcriptions.create(**kwargs)  # type: ignore[arg-type]
                except Exception:
                    record_openai_duration(
                        operation="audio.transcriptions.create",
                        dur_ms=(time.perf_counter() - call_t0) * 1000,
                        status="error",
                    )
                    raise
                record_openai_duration(
                    operation="audio.transcriptions.create",
                    dur_ms=(time.perf_counter() - call_t0) * 1000,
                    status="ok",
                )

                text = (getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else "") or "").strip()
                if text:
                    # naive segmentation (keep paragraphs/lines)
                    segments = [s.strip() for s in text.splitlines() if s.strip()] or [text]
                billed_seconds = _usage_seconds_from_openai(resp)

                # Detected language is only present in verbose variants; keep best-effort.
                lang = getattr(resp, "language", None)
                if lang is None and isinstance(resp, dict):
                    lang = resp.get("language")
                if isinstance(lang, str) and lang.strip():
                    detected.append(lang.strip())

    except HTTPException:
        raise
    except Exception as e:
        log.exception("openai_transcribe_failed", error=str(e))
        raise HTTPException(status_code=502, detail=f"Speech-to-text failed: {e}")
    finally:
        try:
            await uptrack.set_phase(job_id, "post", pct=85)
        except Exception:
            pass

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

    # Keep response fields consistent
    location = getattr(settings, "STT_LOCATION", "openai") or "openai"
    return text, segments, detected, billed_seconds, used_model