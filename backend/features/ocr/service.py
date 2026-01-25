from __future__ import annotations

import os
import logging
from typing import List, Optional, Literal

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from core.config import settings
from core import tracker as uptrack
from core.rate_limit import add_ocr_images

log = logging.getLogger("ocr.service")


def _parse_csv_list(v: Optional[str]) -> List[str]:
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


def _vision_client_and_types():
    """Import vision libs lazily so normal API usage doesn't require them in tests."""
    try:
        from google.cloud import vision  # type: ignore
        return vision
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vision client not installed: {e}")


def _vision_credentials():
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


async def ocr_image_bytes(
    *,
    uid: str,
    job_id: str,
    image_bytes: bytes,
    language_hints: Optional[List[str]] = None,
    mode: Optional[Literal["document", "text"]] = None,
    charge_usage: bool = True,
) -> str:
    """OCR an image using Google Cloud Vision.

    - Updates upload-tracker phases if a job_id is provided.
    - Enforces per-period OCR usage cap (ocr_images) when charge_usage=True.
    """

    if not settings.OCR_ENABLE:
        raise HTTPException(status_code=503, detail="OCR is disabled.")

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image.")

    if len(image_bytes) > int(settings.OCR_MAX_BYTES):
        raise HTTPException(status_code=413, detail=f"Image too large for OCR (max {settings.OCR_MAX_BYTES} bytes).")

    # Usage accounting (best-effort)
    if charge_usage:
        try:
            ok, _used, _cap = await add_ocr_images(uid, 1)
            if not ok:
                raise HTTPException(status_code=402, detail="OCR usage limit reached for this billing period.")
        except HTTPException:
            raise
        except Exception:
            log.exception("ocr_usage_accounting_error", uid=uid)

    # Tracker progress (best-effort)
    try:
        await uptrack.set_phase(job_id, "ocr", pct=70)
    except Exception:
        pass

    vision = _vision_client_and_types()
    creds = _vision_credentials()

    client = vision.ImageAnnotatorClient(credentials=creds)
    img = vision.Image(content=image_bytes)

    hints = (language_hints or [])
    if not hints:
        hints = _parse_csv_list(settings.OCR_DEFAULT_LANGUAGE_HINTS)

    ctx = vision.ImageContext(language_hints=hints) if hints else None
    use_mode: Literal["document", "text"] = mode or settings.OCR_MODE

    def _call():
        if use_mode == "text":
            return client.text_detection(image=img, image_context=ctx) if ctx else client.text_detection(image=img)
        return client.document_text_detection(image=img, image_context=ctx) if ctx else client.document_text_detection(image=img)

    try:
        response = await run_in_threadpool(_call)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("ocr_vision_error", uid=uid, error=str(e))
        raise HTTPException(status_code=502, detail=f"Vision OCR failed: {e}")

    # Vision API may populate an error field instead of raising.
    try:
        err = getattr(response, "error", None)
        if err and getattr(err, "message", None):
            raise HTTPException(status_code=502, detail=f"Vision OCR error: {err.message}")
    except HTTPException:
        raise
    except Exception:
        pass

    text = ""
    try:
        # document_text_detection
        fta = getattr(response, "full_text_annotation", None)
        if fta is not None and getattr(fta, "text", None):
            text = str(fta.text or "").strip()
    except Exception:
        text = ""

    if not text:
        # text_detection fallback
        try:
            anns = getattr(response, "text_annotations", None) or []
            if anns:
                text = str(getattr(anns[0], "description", "") or "").strip()
        except Exception:
            text = ""

    return text or ""
