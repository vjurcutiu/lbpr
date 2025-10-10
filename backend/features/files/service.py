
from __future__ import annotations

import io
import uuid
import logging
from typing import List, Optional

from fastapi import UploadFile
from firebase_admin import storage

from core.config import settings
from .schemas import FileItem, UploadResponse
from features.rag import orchestrator
from features.rag.schemas import IngestRequest

# NEW: tracker + optional OCR
from core import tracker as uptrack

log = logging.getLogger("files.service")

def _bucket():
    bucket_name = settings.FIREBASE_STORAGE_BUCKET or f"{settings.FIREBASE_PROJECT_ID}.appspot.com"
    log.debug("bucket_resolve", bucket=bucket_name)
    return storage.bucket(bucket_name)

def _user_prefix(uid: str) -> str:
    # Canonical user-based namespace prefix
    return f"u:{uid}"

def _object_path(uid: str, filename: str, file_id: Optional[str]=None) -> str:
    fid = file_id or str(uuid.uuid4())
    return f"{_user_prefix(uid)}/uploads/{fid}/{filename}"

def _hash_bytes(b: bytes) -> str:
    import hashlib as _hashlib
    return _hashlib.sha256(b).hexdigest()

def _ocr_image(data: bytes) -> Optional[str]:
    """Best-effort OCR for common images if pytesseract is available and OCR is enabled."""
    import os
    if os.getenv("OCR_ENABLE", "1") != "1":
        return None
    try:
        from PIL import Image  # type: ignore
        import pytesseract  # type: ignore
        img = Image.open(io.BytesIO(data))
        text = pytesseract.image_to_string(img)
        text = (text or "").strip()
        return text or None
    except Exception:
        return None

def _extract_text(name: str, content_type: Optional[str], data: bytes) -> Optional[str]:
    """Extract text from a variety of formats; falls back to OCR for images; skips heavy PDF OCR."""
    ct = (content_type or "").lower()
    name_lower = name.lower()
    try:
        if ct.startswith("text/") or ct in {"application/json","application/xml"}:
            return data.decode("utf-8", errors="ignore")
        if ct == "text/markdown" or name_lower.endswith(".md") or name_lower.endswith(".markdown"):
            return data.decode("utf-8", errors="ignore")
        if name_lower.endswith((".txt", ".json", ".xml", ".csv")):
            return data.decode("utf-8", errors="ignore")
        if ct == "application/pdf" or name_lower.endswith(".pdf"):
            # Try text-layer extraction first
            try:
                from pypdf import PdfReader  # type: ignore
                reader = PdfReader(io.BytesIO(data))
                pages = []
                for p in reader.pages:
                    try:
                        pages.append(p.extract_text() or "")
                    except Exception:
                        pages.append("")
                text = "\n".join(pages).strip()
                if text:
                    return text
            except Exception:
                pass
            # (Optional) OCR for scanned PDFs would require extra deps like pdf2image/poppler.
            # We intentionally skip heavy OCR here for portability.
            return None
        if ct in {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"} or name_lower.endswith(".docx"):
            try:
                import docx  # type: ignore
                f = io.BytesIO(data)
                d = docx.Document(f)  # type: ignore
                paragraphs = [para.text for para in d.paragraphs if para.text]
                return "\n".join(paragraphs) or None
            except Exception:
                return None
        # Images → OCR (best-effort)
        if ct.startswith("image/") or name_lower.endswith((".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif")):
            return _ocr_image(data)
    except Exception:
        return None
    return None

async def upload_file(uid: str, file: UploadFile, dataset: str = "default") -> UploadResponse:
    # We stream-read into memory to report progress precisely; then upload to Firebase once.
    filename = file.filename
    object_name = _object_path(uid, filename)
    bkt = _bucket()
    blob = bkt.blob(object_name)

    # Prepare job
    # We don't know total bytes before reading; attempt from UploadFile or fall back to 0.
    total_guess = 0
    try:
        info = await file.read(0)  # no-op to ensure file is ready (Starlette quirk)
    except Exception:
        pass
    # We'll compute total along the way.
    await uptrack.create_job(job_id=object_name, uid=uid, filename=filename or "file", dataset=dataset, total_bytes=int(total_guess))

    log.info("upload_start", user_uid=uid, object=object_name, filename=filename, ctype=file.content_type or "")

    # Read in chunks to compute checksum, bytes, and optional text
    sha256 = None
    import hashlib as _hashlib
    h = _hashlib.sha256()

    chunks: List[bytes] = []
    total = 0
    CHUNK = 1024 * 1024  # 1 MB
    await uptrack.set_phase(object_name, "receive", pct=0)

    while True:
        buf = await file.read(CHUNK)
        if not buf:
            break
        chunks.append(buf)
        h.update(buf)
        total += len(buf)
        await uptrack.incr_bytes(object_name, len(buf))

    sha256 = h.hexdigest()
    # Update the total_bytes now that we know it
    data = b"".join(chunks)
    # Update the 'total_bytes' field explicitly and recompute pct=100 for receive
    try:
        from core.redis_utils import get_client as _get_client  # type: ignore
        rds = await _get_client()
        await rds.hset(f"ut:job:{object_name}", mapping={"total_bytes": str(total), "pct": "100"})
    except Exception:
        pass

    # Upload to Firebase
    try:
        await uptrack.set_phase(object_name, "upload", pct=10)
        blob.metadata = {
            "checksum": sha256,
            "original_name": filename,
            "owner_uid": uid,
            "dataset": dataset,
            "content_type": file.content_type or "",
        }
        blob.upload_from_string(data, content_type=file.content_type or "application/octet-stream")
        await uptrack.set_phase(object_name, "upload", pct=25)
    except Exception as e:
        await uptrack.mark_error(object_name, f"Storage error: {e}")
        log.exception("upload_storage_error", extra={"object": object_name})
        raise

    # Text extraction (with OCR fallback for images)
    try:
        await uptrack.set_phase(object_name, "extract", pct=40)
        text = _extract_text(filename, file.content_type, data)
        if text:
            log.info("upload_text_extracted", object=object_name, chars=len(text), ctype=file.content_type or "")
            await uptrack.set_phase(object_name, "embed", pct=60)
            try:
                orchestrator.ingest_request(
                    IngestRequest(
                        dataset=dataset,
                        text=text,
                        metadata={"owner_uid": uid, "source": "upload", "title": filename},
                    ),
                    uid=uid,
                )
                await uptrack.set_phase(object_name, "upsert", pct=85)
                log.info("upload_ingest_ok", object=object_name, chars=len(text))
            except Exception as e:
                log.warning("upload_ingest_error", object=object_name, error=str(e))
        else:
            log.info("upload_text_skipped", object=object_name, reason="no extractable text", ctype=file.content_type or "", size=total)
            await uptrack.set_phase(object_name, "upsert", pct=85)
    except Exception as e:
        await uptrack.mark_error(object_name, f"Extract error: {e}")
        log.exception("upload_extract_error", extra={"object": object_name})
        raise

    await uptrack.mark_done(object_name)
    log.info("upload_done", object=object_name, size=total)
    return UploadResponse(job_id=object_name)

def list_files(uid: str) -> List[FileItem]:
    bkt = _bucket()
    prefix = f"{_user_prefix(uid)}/uploads/"
    log.info("list_start", prefix=prefix, user_uid=uid)
    items: List[FileItem] = []
    for blob in bkt.list_blobs(prefix=prefix):
        if blob.name.endswith("/"):
            continue
        name = (blob.metadata or {}).get("original_name")
        items.append(
            FileItem(
                id=blob.name,
                name=name or blob.name.split("/")[-1],
                size=blob.size or 0,
                created_at=(blob.time_created.isoformat() if getattr(blob, "time_created", None) else None),
                content_type=blob.content_type or (blob.metadata or {}).get("content_type"),
            )
        )
    items.sort(key=lambda x: x.created_at or "", reverse=True)
    log.info("list_ok", count=len(items), user_uid=uid)
    return items

def delete_file(file_id: str) -> bool:
    bkt = _bucket()
    blob = bkt.blob(file_id)
    exists = blob.exists()
    log.info("delete_start", file_id=file_id, exists=exists)
    if not exists:
        return False
    blob.delete()
    log.info("delete_ok", file_id=file_id)
    return True

def get_signed_download_url(file_id: str, minutes: int = 10) -> str:
    """Generate a signed URL forcing a download 'Save As' dialog."""
    from datetime import timedelta
    bkt = _bucket()
    blob = bkt.blob(file_id)
    if not blob.exists():
        log.warning("download_missing", file_id=file_id)
        raise FileNotFoundError("File not found")

    filename = None
    try:
        md = blob.metadata or {}
        filename = (md.get("original_name") or file_id.split("/")[-1])
    except Exception:
        filename = file_id.split("/")[-1]

    url = blob.generate_signed_url(
        expiration=timedelta(minutes=minutes),
        method="GET",
        response_disposition=f"attachment; filename*=UTF-8''{filename}",
    )
    return url

def get_file_bytes(file_id: str) -> tuple[bytes, str]:
    bkt = _bucket()
    blob = bkt.blob(file_id)
    if not blob.exists():
        log.warning("get_missing", file_id=file_id)
        raise FileNotFoundError("File not found")
    data = blob.download_as_bytes()
    ct = blob.content_type or (blob.metadata or {}).get("content_type") or "application/octet-stream"
    return data, ct
