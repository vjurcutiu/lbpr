from __future__ import annotations

import io
import uuid
import hashlib
import logging
from typing import List, Optional, Dict, Any, Iterable, Tuple

from fastapi import UploadFile
from firebase_admin import storage

from core.config import settings
from .schemas import FileItem, UploadResponse
from features.rag import orchestrator
from features.rag.schemas import IngestRequest

TENANT_HEADER = "x-tenant-id"
log = logging.getLogger("files.service")

def _bucket():
    # Uses default app from core.firebase.init_firebase()
    bucket_name = settings.FIREBASE_STORAGE_BUCKET or f"{settings.FIREBASE_PROJECT_ID}.appspot.com"
    log.debug("bucket_resolve", extra={"bucket": bucket_name})
    return storage.bucket(bucket_name)

def _tenant_prefix(tenant_id: Optional[str]) -> str:
    return f"t:{tenant_id or 'demo'}"

def _object_path(tenant_id: Optional[str], filename: str, file_id: Optional[str]=None) -> str:
    # Store under t:{tenant}/uploads/{uuid}/{filename}
    fid = file_id or str(uuid.uuid4())
    return f"{_tenant_prefix(tenant_id)}/uploads/{fid}/{filename}"

def _hash_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def _extract_text(name: str, content_type: Optional[str], data: bytes) -> Optional[str]:
    """
    Best-effort text extraction:
    - For text/*, application/json, application/xml, csv, md: decode as utf-8
    - PDF via pypdf (if installed)
    - DOCX via python-docx (if installed)
    Other formats return None.
    """
    ct = (content_type or "").lower()
    name_lower = name.lower()
    try:
        # Simple text-ish types
        if ct.startswith("text/") or ct in {"application/json","application/xml"}:
            return data.decode("utf-8", errors="ignore")
        if ct == "text/markdown" or name_lower.endswith(".md") or name_lower.endswith(".markdown"):
            return data.decode("utf-8", errors="ignore")
        if name_lower.endswith((".txt", ".json", ".xml", ".csv")):
            return data.decode("utf-8", errors="ignore")

        # PDF (optional)
        if ct == "application/pdf" or name_lower.endswith(".pdf"):
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
                return text or None
            except Exception:
                return None

        # DOCX (optional)
        if ct in {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"} or name_lower.endswith(".docx"):
            try:
                import docx  # type: ignore
                f = io.BytesIO(data)
                d = docx.Document(f)  # type: ignore
                paragraphs = [para.text for para in d.paragraphs if para.text]
                return "\n".join(paragraphs) or None
            except Exception:
                return None

    except Exception:
        return None
    return None

def upload_file(tenant_id: Optional[str], file: UploadFile, dataset: str = "default") -> UploadResponse:
    # Read all bytes (<= 50MB expected by design invariants)
    data = file.file.read()
    size = len(data)
    if size > 50 * 1024 * 1024:
        raise ValueError("File too large (>50MB)")

    checksum = _hash_bytes(data)
    object_name = _object_path(tenant_id, file.filename)
    bkt = _bucket()
    blob = bkt.blob(object_name)

    log.info("upload_start", extra={
        "tenant": tenant_id or "demo",
        "object": object_name,
        "filename": file.filename,
        "ctype": file.content_type or "",
        "size": size,
        "checksum": checksum[:12],
    })

    # Upload with metadata
    blob.metadata = {
        "checksum": checksum,
        "original_name": file.filename,
        "tenant_id": tenant_id or "demo",
        "dataset": dataset,
        "content_type": file.content_type or "",
    }
    blob.upload_from_string(data, content_type=file.content_type or "application/octet-stream")

    # Try inline indexing for text-like files (best-effort)
    text = _extract_text(file.filename, file.content_type, data)
    if text:
        try:
            # Use tenant as a stand-in "uid" for per-user namespace
            uid = (tenant_id or "demo")
            orchestrator.ingest_request(
                IngestRequest(
                    dataset=dataset,
                    text=text,
                    metadata={"tenant_id": tenant_id or "demo", "source": "upload", "title": file.filename},
                ),
                uid=uid,
            )
            log.info("upload_ingest_ok", extra={"object": object_name, "chars": len(text)})
        except Exception as e:
            # Don't fail the upload if indexing fails
            log.warning("upload_ingest_error", extra={"object": object_name, "error": str(e)})

    # job_id can be the blob name for now (acts as a stable handle)
    log.info("upload_done", extra={"object": object_name})
    return UploadResponse(job_id=object_name)

def list_files(tenant_id: Optional[str]) -> List[FileItem]:
    bkt = _bucket()
    prefix = f"{_tenant_prefix(tenant_id)}/uploads/"
    log.info("list_start", extra={"prefix": prefix})
    items: List[FileItem] = []
    for blob in bkt.list_blobs(prefix=prefix):
        # Only leaf files (skip 'folder' markers)
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
    # Sort newest first
    items.sort(key=lambda x: x.created_at or "", reverse=True)
    log.info("list_ok", extra={"count": len(items)})
    return items

def delete_file(tenant_id: Optional[str], file_id: str) -> bool:
    bkt = _bucket()
    blob = bkt.blob(file_id)
    exists = blob.exists()
    log.info("delete_start", extra={"file_id": file_id, "exists": exists})
    if not exists:
        return False
    blob.delete()
    log.info("delete_ok", extra={"file_id": file_id})
    return True

def get_signed_download_url(file_id: str, minutes: int = 10) -> str:
    bkt = _bucket()
    blob = bkt.blob(file_id)
    exists = blob.exists()
    if not exists:
        log.warning("download_missing", extra={"file_id": file_id})
        raise FileNotFoundError("File not found")
    from datetime import timedelta
    url = blob.generate_signed_url(expiration=timedelta(minutes=minutes), method="GET")
    log.info("download_url_generated", extra={
        "file_id": file_id,
        "expires_min": minutes,
        "url_len": len(url) if url else 0,
    })
    return url

def get_file_bytes(file_id: str) -> Tuple[bytes, str]:
    """Fetch raw bytes and content-type for a stored file so the frontend can preview inline."""
    bkt = _bucket()
    blob = bkt.blob(file_id)
    exists = blob.exists()
    log.info("get_bytes_start", extra={"file_id": file_id, "exists": exists})
    if not exists:
        raise FileNotFoundError("File not found")
    data: bytes = blob.download_as_bytes()
    content_type: str = blob.content_type or (blob.metadata or {}).get("content_type") or "application/octet-stream"
    log.info("get_bytes_ok", extra={"file_id": file_id, "bytes": len(data), "content_type": content_type})
    return data, content_type
