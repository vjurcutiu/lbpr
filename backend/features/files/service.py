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
    bucket_name = settings.FIREBASE_STORAGE_BUCKET or f"{settings.FIREBASE_PROJECT_ID}.appspot.com"
    log.debug("bucket_resolve", extra={"bucket": bucket_name})
    return storage.bucket(bucket_name)

def _tenant_prefix(tenant_id: Optional[str]) -> str:
    return f"t:{tenant_id or 'demo'}"

def _object_path(tenant_id: Optional[str], filename: str, file_id: Optional[str]=None) -> str:
    fid = file_id or str(uuid.uuid4())
    return f"{_tenant_prefix(tenant_id)}/uploads/{fid}/{filename}"

def _hash_bytes(b: bytes) -> str:
    import hashlib as _hashlib
    return _hashlib.sha256(b).hexdigest()

def _extract_text(name: str, content_type: Optional[str], data: bytes) -> Optional[str]:
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

    blob.metadata = {
        "checksum": checksum,
        "original_name": file.filename,
        "tenant_id": tenant_id or "demo",
        "dataset": dataset,
        "content_type": file.content_type or "",
    }
    blob.upload_from_string(data, content_type=file.content_type or "application/octet-stream")

    text = _extract_text(file.filename, file.content_type, data)
    if text:
        try:
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
            log.warning("upload_ingest_error", extra={"object": object_name, "error": str(e)})

    log.info("upload_done", extra={"object": object_name})
    return UploadResponse(job_id=object_name)

def list_files(tenant_id: Optional[str]) -> List[FileItem]:
    bkt = _bucket()
    prefix = f"{_tenant_prefix(tenant_id)}/uploads/"
    log.info("list_start", extra={"prefix": prefix})
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
    """Generate a signed URL forcing a download 'Save As' dialog."""
    bkt = _bucket()
    blob = bkt.blob(file_id)
    exists = blob.exists()
    if not exists:
        log.warning("download_missing", extra={"file_id": file_id})
        raise FileNotFoundError("File not found")

    # Prefer the original filename from metadata; otherwise, last segment of path.
    filename = None
    try:
        md = blob.metadata or {}
        filename = (md.get("original_name") or file_id.split("/")[-1]).strip() or "download.bin"
    except Exception:
        filename = file_id.split("/")[-1] or "download.bin"

    # IMPORTANT: For GCS signed URLs, use response_disposition to force download.
    # See google.cloud.storage.blob.Blob.generate_signed_url docs.
    from datetime import timedelta
    disposition = f'attachment; filename="{filename}"'
    url = blob.generate_signed_url(
        expiration=timedelta(minutes=minutes),
        method="GET",
        response_disposition=disposition,
        # Optionally, hint the content type. It won't override stored metadata,
        # but helps when missing.
        response_type=blob.content_type or "application/octet-stream",
    )
    log.info("download_url_generated", extra={
        "file_id": file_id,
        "expires_min": minutes,
        "url_len": len(url) if url else 0,
        "disposition": disposition,
    })
    return url

def get_file_bytes(file_id: str) -> Tuple[bytes, str]:
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
