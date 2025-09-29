
from __future__ import annotations

import io
import uuid
import hashlib
from typing import List, Optional, Dict, Any, Iterable

from fastapi import UploadFile
from firebase_admin import storage

from core.config import settings
from .schemas import FileItem, UploadResponse
from features.rag import orchestrator
from features.rag.schemas import IngestRequest

TENANT_HEADER = "x-tenant-id"

def _bucket():
    # Uses default app from core.firebase.init_firebase()
    bucket_name = settings.FIREBASE_STORAGE_BUCKET or f"{settings.FIREBASE_PROJECT_ID}.appspot.com"
    return storage.bucket(bucket_name)

def _tenant_prefix(tenant_id: Optional[str]) -> str:
    return f"t:{tenant_id or 'demo'}"

def _object_path(tenant_id: Optional[str], filename: str, file_id: Optional[str]=None) -> str:
    # Store under t:{tenant}/uploads/{uuid}-{filename}
    fid = file_id or str(uuid.uuid4())
    return f"{_tenant_prefix(tenant_id)}/uploads/{fid}/{filename}"

def _hash_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def _extract_text(name: str, content_type: Optional[str], data: bytes) -> Optional[str]:
    """
    Minimal extractor to keep dependencies light.
    - For text/*, application/json, application/xml: decode as utf-8
    - Markdown (.md): decode as utf-8
    - PDF/DOCX are not handled here (skipped)
    """
    ct = (content_type or "").lower()
    name_lower = name.lower()
    try:
        if ct.startswith("text/") or ct in {"application/json","application/xml"}:
            return data.decode("utf-8", errors="ignore")
        if ct == "text/markdown" or name_lower.endswith(".md") or name_lower.endswith(".markdown"):
            return data.decode("utf-8", errors="ignore")
        if name_lower.endswith(".txt") or name_lower.endswith(".json") or name_lower.endswith(".xml") or name_lower.endswith(".csv"):
            return data.decode("utf-8", errors="ignore")
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
            orchestrator.ingest(
                IngestRequest(
                    dataset=dataset,
                    text=text,
                    metadata={"tenant_id": tenant_id or "demo", "source": "upload", "title": file.filename},
                )
            )
        except Exception as e:
            # Don't fail the upload if indexing fails
            print(f"[files] Ingest failed for {file.filename}: {e}")

    # job_id can be the blob name for now (acts as a stable handle)
    return UploadResponse(job_id=object_name)

def list_files(tenant_id: Optional[str]) -> List[FileItem]:
    bkt = _bucket()
    prefix = f"{_tenant_prefix(tenant_id)}/uploads/"
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
    return items

def delete_file(tenant_id: Optional[str], file_id: str) -> bool:
    bkt = _bucket()
    blob = bkt.blob(file_id)
    if not blob.exists():
        return False
    blob.delete()
    return True

def get_signed_download_url(file_id: str, minutes: int = 10) -> str:
    bkt = _bucket()
    blob = bkt.blob(file_id)
    if not blob.exists():
        raise FileNotFoundError("File not found")
    from datetime import timedelta
    return blob.generate_signed_url(expiration=timedelta(minutes=minutes), method="GET")
