# backend/features/files/service.py

from __future__ import annotations

import io
import logging
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import UploadFile, HTTPException
from fastapi.concurrency import run_in_threadpool
from firebase_admin import storage

from core.config import settings
from .schemas import FileItem, UploadResponse, FolderItem
from . import index_store

from features.rag import orchestrator
from features.rag.schemas import IngestRequest

# Tracker + tokenizer + usage + plan sync
from core import tracker as uptrack
from core.tokenizer import count_tokens
from core.rate_limit import add_upload_tokens
from core.plan import sync_caps_and_plan

# PII pseudonymization (optional)
from core.pii import tokenize_text, detokenize_text, detokenize_many

log = logging.getLogger("files.service")


def _bucket():
    bucket_name = settings.FIREBASE_STORAGE_BUCKET or f"{settings.FIREBASE_PROJECT_ID}.appspot.com"
    log.debug("files_bucket_resolved", bucket=bucket_name)
    return storage.bucket(bucket_name)


def _user_prefix(uid: str) -> str:
    # Canonical user-based namespace prefix
    return f"u:{uid}"


def _assert_user_owns(uid: str, file_id: str) -> None:
    if not file_id.startswith(f"{_user_prefix(uid)}/"):
        raise PermissionError("Forbidden")


def _object_path(uid: str, filename: str, file_id: Optional[str] = None) -> str:
    fid = file_id or str(uuid.uuid4())
    # Keep storage object names free of user-provided strings (which may contain PII).
    # The user-facing filename is stored in metadata and Firestore.
    return f"{_user_prefix(uid)}/uploads/{fid}/content"


def _folder_marker_object(uid: str, folder_path: str) -> str:
    folder_path = index_store.normalize_folder_path(folder_path)
    return f"{_user_prefix(uid)}/uploads/.folders/{folder_path}/.keep"


def _is_folder_marker(blob_name: str, metadata: Optional[dict]) -> bool:
    if "/uploads/.folders/" in (blob_name or ""):
        return True
    md = metadata or {}
    if str(md.get("is_folder_marker") or "") in ("1", "true", "True"):
        return True
    return False


def _ocr_image_local(data: bytes) -> Optional[str]:
    """Best-effort local OCR for images (optional dev fallback).

    Enable with OCR_LOCAL_ENABLE=1 and ensure pytesseract + system tesseract are installed.
    """
    import os
    if os.getenv("OCR_LOCAL_ENABLE", "0") != "1":
        return None
    try:
        from PIL import Image  # type: ignore
        import pytesseract  # type: ignore
        img = Image.open(io.BytesIO(data))
        text = pytesseract.image_to_string(img)
        text = (text or "").strip()
        return text or None
    except Exception as e:
        log.debug("ocr_local_skip", reason=str(e))
        return None


async def _ocr_image_google(uid: str, job_id: str, data: bytes) -> Optional[str]:
    """OCR image via Google Cloud Vision (preferred)."""
    if not settings.OCR_ENABLE:
        return None
    try:
        from features.ocr import service as ocr_service  # lazy import
        return await ocr_service.ocr_image_bytes(uid=uid, job_id=job_id, image_bytes=data, charge_usage=True)
    except HTTPException:
        # Preserve status (e.g., 402 cap reached)
        raise
    except Exception as e:
        log.warning("ocr_google_skip", uid=uid, error=str(e))
        return None


async def _extract_text(uid: str, job_id: str, name: str, content_type: Optional[str], data: bytes) -> Optional[str]:
    """Extract text from a variety of formats; falls back to OCR for images; skips heavy PDF OCR."""
    ct = (content_type or "").lower()
    name_lower = (name or "").lower()
    log.debug("extract_text_begin", name=name, content_type=content_type, size=len(data))
    try:
        if ct.startswith("text/") or ct in {"application/json", "application/xml"}:
            return data.decode("utf-8", errors="ignore")
        if ct == "text/markdown" or name_lower.endswith((".md", ".markdown")):
            return data.decode("utf-8", errors="ignore")
        if name_lower.endswith((".txt", ".json", ".xml", ".csv")):
            return data.decode("utf-8", errors="ignore")
        if ct == "application/pdf" or name_lower.endswith(".pdf"):
            # Try text-layer extraction first
            try:
                def _read_pdf() -> str:
                    from pypdf import PdfReader  # type: ignore
                    reader = PdfReader(io.BytesIO(data))
                    pages = []
                    for p in reader.pages:
                        try:
                            pages.append(p.extract_text() or "")
                        except Exception:
                            pages.append("")
                    return "\n".join(pages).strip()

                text = await run_in_threadpool(_read_pdf)
                if text:
                    return text
            except Exception as e:
                log.debug("pdf_textlayer_fail", error=str(e))
            # (Optional) OCR for scanned PDFs would require extra deps; skipped for portability.
            return None
        if ct in {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"} or name_lower.endswith(
            ".docx"
        ):
            try:
                def _read_docx() -> str:
                    import docx  # type: ignore
                    f = io.BytesIO(data)
                    d = docx.Document(f)  # type: ignore
                    paragraphs = [para.text for para in d.paragraphs if para.text]
                    return "\n".join(paragraphs)

                text = await run_in_threadpool(_read_docx)
                return text or None
            except Exception as e:
                log.debug("docx_extract_fail", error=str(e))
                return None
        # Images → OCR (best-effort)
        if ct.startswith("image/") or name_lower.endswith((".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif")):
            text = await _ocr_image_google(uid, job_id, data)
            if text:
                return text
            # optional local fallback
            return _ocr_image_local(data)
    except Exception as e:
        log.warning("extract_text_error", name=name, content_type=content_type, error=str(e))
        return None
    return None


async def upload_file(
    uid: str,
    file: UploadFile,
    dataset: str = "default",
    folder: Optional[str] = None,
) -> UploadResponse:
    """Upload a single file; store folder/display_name metadata; index into Firestore (Phase 3)."""

    # Raw user-provided values (may contain PII)
    raw_filename = file.filename or "file"
    raw_folder_path = index_store.normalize_folder_path(folder)
    raw_display_name = index_store.build_display_name(raw_folder_path, raw_filename)

    # Stored values (tokenized when PII is enabled)
    if settings.PII_TOKENIZE_FILENAMES:
        filename = tokenize_text(uid, raw_filename)
        folder_path = tokenize_text(uid, raw_folder_path) if raw_folder_path else ""
    else:
        filename = raw_filename
        folder_path = raw_folder_path
    display_name = index_store.build_display_name(folder_path, filename)

    object_name = _object_path(uid, raw_filename)  # storage object path, used as stable doc_id
    bkt = _bucket()
    blob = bkt.blob(object_name)

    log.info(
        "upload_start",
        uid=uid,
        filename=filename,
        dataset=dataset,
        object=object_name,
        content_type=file.content_type,
        folder_path=folder_path,
        display_name=display_name,
    )

    # Prepare job
    total_guess = 0
    try:
        _ = await file.read(0)
    except Exception as e:
        log.debug("upload_file_read0_fail", error=str(e))

    await uptrack.create_job(
        job_id=object_name,
        uid=uid,
        filename=filename,
        dataset=dataset,
        total_bytes=int(total_guess),
    )

    # Read in chunks to compute checksum and bytes
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
        if total % (5 * CHUNK) < CHUNK:
            log.debug("upload_progress", object=object_name, bytes=total)

    sha256 = h.hexdigest()
    data = b"".join(chunks)

    # Update the 'total_bytes' now that we know it
    try:
        from core.redis_utils import get_client as _get_client  # type: ignore

        rds = await _get_client()
        await rds.hset(f"ut:job:{object_name}", mapping={"total_bytes": str(total), "pct": "100"})
        log.debug("upload_set_total_bytes", object=object_name, total_bytes=total, sha256=sha256)
    except Exception as e:
        log.warning("upload_set_total_bytes_failed", object=object_name, error=str(e))

    # Enforce limits BEFORE storing
    await uptrack.set_phase(object_name, "extract", pct=30)
    text = await _extract_text(uid, object_name, filename, file.content_type, data)

    if text:
        tokens = count_tokens(text or "")
        await sync_caps_and_plan(uid)
        try:
            ok, used, cap = await add_upload_tokens(uid, tokens)
            log.info(
                "usage_upload_tokens_add",
                uid=uid,
                object=object_name,
                filename=filename,
                dataset=dataset,
                tokens=tokens,
                allowed=ok,
                used_upload_tokens=used,
                cap_upload_tokens=cap,
            )
            if not ok:
                msg = f"Upload budget exceeded ({used}/{cap} tokens). Upgrade to continue."
                await uptrack.mark_error(object_name, msg)
                log.warning("upload_tokens_exhausted_abort", uid=uid, object=object_name)
                return UploadResponse(job_id=object_name)
        except Exception:
            log.exception("usage_upload_tokens_error", uid=uid, object=object_name)

    # Tokenize extracted text BEFORE it is sent to embedding/vector store.
    # We still do usage accounting on the raw extracted text above.
    tokenized_text = tokenize_text(uid, text) if text else text

    # Store in Firebase
    try:
        await uptrack.set_phase(object_name, "upload", pct=60)

        md = {
            "checksum": sha256,
            "owner_uid": uid,
            "dataset": dataset,
            "content_type": file.content_type or "",
            # Existing semantics: original_name is the filename clients should show
            "original_name": filename,
            # NEW semantics: display_name can include folders (virtual path)
            "display_name": display_name,
            "folder_path": folder_path,
            # Keep initial_name as a stable hint for later
            "initial_name": filename,
        }

        blob.metadata = md
        blob.upload_from_string(data, content_type=file.content_type or "application/octet-stream")
        await uptrack.set_phase(object_name, "upload", pct=75)
        log.info("upload_storage_ok", object=object_name, size=total)
    except Exception as e:
        await uptrack.mark_error(object_name, f"Storage error: {e}")
        log.exception("upload_storage_error", object=object_name)
        raise

    # Index metadata in Firestore (Phase 3)
    try:
        try:
            blob.reload()
        except Exception:
            pass
        index_store.upsert_file(
            uid,
            storage_path=object_name,
            original_name=filename,
            display_name=display_name,
            folder_path=folder_path,
            size=int(blob.size or total or 0),
            content_type=str(blob.content_type or file.content_type or ""),
            dataset=dataset,
            checksum=sha256,
            created_at=getattr(blob, "time_created", None) or datetime.utcnow(),
        )
    except Exception as e:
        log.debug("files_index_upsert_failed", uid=uid, object=object_name, error=str(e))

    # If we have text, embed & ingest (we already charged tokens above).
    try:
        if tokenized_text:
            log.info("upload_extract_ok", object=object_name, chars=len(tokenized_text))
            await uptrack.set_phase(object_name, "embed", pct=85)
            try:
                orchestrator.ingest_request(
                    IngestRequest(
                        dataset=dataset,
                        text=str(tokenized_text),
                        doc_id=object_name,  # stable per file
                        metadata={
                            "owner_uid": uid,
                            "source": "upload",
                            "title": filename,
                            "filename": filename,
                            "file_id": object_name,
                            "dataset": dataset,
                            "checksum": sha256,
                            "content_type": file.content_type or "",
                            # UI-oriented names (best-effort)
                            "display_name": display_name,
                            "folder_path": folder_path,
                        },
                    ),
                    uid=uid,
                )
                await uptrack.set_phase(object_name, "upsert", pct=95)
                log.info("upload_ingest_ok", object=object_name)
            except Exception as e:
                log.warning("upload_ingest_error", object=object_name, error=str(e))
        else:
            log.info(
                "upload_text_skipped",
                object=object_name,
                reason="no extractable text",
                ctype=file.content_type or "",
                size=total,
            )
            await uptrack.set_phase(object_name, "upsert", pct=95)
    except Exception as e:
        await uptrack.mark_error(object_name, f"Extract/ingest error: {e}")
        log.exception("upload_extract_error", object=object_name)
        raise

    await uptrack.mark_done(object_name)
    log.info("upload_done", object=object_name)

    return UploadResponse(job_id=object_name)


def _fileitem_from_index_row(row: dict) -> FileItem:
    storage_path = str(row.get("storage_path") or row.get("id") or "")
    display_name = str(row.get("display_name") or "")
    original_name = str(row.get("original_name") or "")

    name = display_name or original_name or (storage_path.split("/")[-1] if storage_path else "")
    folder_path = str(row.get("folder_path") or "")
    if not folder_path and display_name:
        try:
            folder_path, _ = index_store.split_display_name(display_name)
        except Exception:
            folder_path = ""

    created_at = row.get("created_at")
    if not created_at:
        ts = row.get("created_at_ts")
        if isinstance(ts, datetime):
            created_at = ts.isoformat()

    return FileItem(
        id=storage_path,
        name=name,
        size=int(row.get("size") or 0),
        created_at=str(created_at) if created_at else None,
        content_type=str(row.get("content_type") or "") or None,
        folder_path=folder_path or None,
        original_name=original_name or None,
    )


def _detokenize_fileitems(uid: str, items: List[FileItem]) -> List[FileItem]:
    """Detokenize file names/folder paths for user-facing API responses."""
    if not items:
        return items
    flat: List[str] = []
    for it in items:
        flat.append(it.name or "")
        flat.append(it.folder_path or "")
        flat.append(it.original_name or "")
    det = detokenize_many(uid, flat)
    i = 0
    for it in items:
        it.name = det[i] or it.name
        it.folder_path = det[i + 1] or it.folder_path
        it.original_name = det[i + 2] or it.original_name
        i += 3
    return items


def list_files(uid: str) -> List[FileItem]:
    """List files for a user.

    Phase 3: primary source is Firestore index.
    Fallback: Storage scan (and best-effort backfill).
    """

    # 1) Try Firestore index
    try:
        rows = index_store.list_files(uid, limit=5000)
        if rows:
            items = [_fileitem_from_index_row(r) for r in rows]
            log.info("files_list_ok", uid=uid, count=len(items), source="firestore")
            return _detokenize_fileitems(uid, items)
    except Exception as e:
        log.debug("files_list_firestore_failed", uid=uid, error=str(e))

    # 2) Fallback: scan Storage
    bkt = _bucket()
    prefix = f"{_user_prefix(uid)}/uploads/"
    log.debug("files_list_prefix", uid=uid, prefix=prefix)

    items: List[FileItem] = []
    backfill_rows: List[dict] = []

    for blob in bkt.list_blobs(prefix=prefix):
        if blob.name.endswith("/"):
            continue
        if _is_folder_marker(blob.name, blob.metadata):
            continue

        md = blob.metadata or {}
        display_name = (md.get("display_name") or "").strip()
        original_name = (md.get("original_name") or "").strip()
        name = display_name or original_name or blob.name.split("/")[-1]

        folder_path = (md.get("folder_path") or "").strip()
        if not folder_path and display_name:
            try:
                folder_path, _ = index_store.split_display_name(display_name)
            except Exception:
                folder_path = ""

        created_iso = blob.time_created.isoformat() if getattr(blob, "time_created", None) else None
        ct = blob.content_type or md.get("content_type")

        items.append(
            FileItem(
                id=blob.name,
                name=name,
                size=int(blob.size or 0),
                created_at=created_iso,
                content_type=str(ct) if ct else None,
                folder_path=folder_path or None,
                original_name=original_name or None,
            )
        )

        backfill_rows.append(
            {
                "storage_path": blob.name,
                "display_name": name,
                "original_name": original_name or name,
                "folder_path": folder_path,
                "size": int(blob.size or 0),
                "content_type": str(ct or ""),
                "dataset": str(md.get("dataset") or "default"),
                "checksum": str(md.get("checksum") or ""),
                "created_at_ts": getattr(blob, "time_created", None),
            }
        )

    items.sort(key=lambda x: x.created_at or "", reverse=True)

    # Backfill index best-effort
    try:
        if backfill_rows:
            index_store.backfill_from_storage(uid, backfill_rows)
    except Exception:
        pass

    log.info("files_list_ok", uid=uid, count=len(items), source="storage")
    return _detokenize_fileitems(uid, items)


def _detokenize_folderitems(uid: str, items: List[FolderItem]) -> List[FolderItem]:
    if not items:
        return items
    flat: List[str] = []
    for it in items:
        flat.append(it.path or "")
        flat.append(it.parent_path or "")
    det = detokenize_many(uid, flat)
    i = 0
    for it in items:
        it.path = det[i] or it.path
        it.parent_path = (det[i + 1] or it.parent_path) or None
        it.name = (it.path.split("/")[-1] if it.path else it.name)
        i += 2
    return items


def list_folders(uid: str) -> List[FolderItem]:
    """List folders for a user (includes empty folders via Firestore)."""

    out: List[FolderItem] = []

    # 1) Firestore source
    try:
        rows = index_store.list_folders(uid)
        for r in rows:
            p = str(r.get("path") or "")
            if not p:
                continue
            out.append(
                FolderItem(
                    path=p,
                    name=str(r.get("name") or p.split("/")[-1]),
                    parent_path=str(r.get("parent_path") or "") or None,
                    created_at=(
                        r.get("created_at")
                        or (r.get("created_at_ts").isoformat() if isinstance(r.get("created_at_ts"), datetime) else None)
                    ),
                )
            )
    except Exception as e:
        log.debug("folders_list_firestore_failed", uid=uid, error=str(e))

    if out:
        return _detokenize_folderitems(uid, out)

    # 2) Derive from files (best-effort) without detokenizing stored paths.
    seen = set()
    try:
        file_rows = index_store.list_files(uid, limit=5000)
    except Exception:
        file_rows = []
    for r in file_rows:
        fp = str(r.get("folder_path") or "").strip("/")
        if not fp:
            continue
        parts = fp.split("/")
        acc = []
        for seg in parts:
            acc.append(seg)
            p = "/".join(acc)
            if p in seen:
                continue
            seen.add(p)
            out.append(
                FolderItem(
                    path=p,
                    name=seg,
                    parent_path=(p.rsplit("/", 1)[0] if "/" in p else None),
                    created_at=None,
                )
            )

    # Also backfill to Firestore best-effort (store tokenized path)
    try:
        for f in out:
            index_store.upsert_folder(uid, f.path)
    except Exception:
        pass

    out.sort(key=lambda x: x.path)
    return _detokenize_folderitems(uid, out)


def create_folder(uid: str, path: str) -> FolderItem:
    raw_path = index_store.normalize_folder_path(path)
    if not raw_path:
        raise ValueError("Folder path required")

    folder_path = tokenize_text(uid, raw_path) if settings.PII_TOKENIZE_FILENAMES else raw_path

    index_store.upsert_folder(uid, folder_path)

    # Optional: create marker object so Storage-only deployments can still see empty folders if desired.
    try:
        bkt = _bucket()
        marker = bkt.blob(_folder_marker_object(uid, folder_path))
        marker.metadata = {
            "owner_uid": uid,
            "is_folder_marker": "1",
            "display_name": f"{folder_path}/",
            "folder_path": folder_path,
        }
        # 0-byte upload
        marker.upload_from_string(b"", content_type="application/octet-stream")
    except Exception as e:
        log.debug("folder_marker_create_failed", uid=uid, path=folder_path, error=str(e))

    visible_path = detokenize_text(uid, folder_path)
    return FolderItem(
        path=visible_path,
        name=visible_path.split("/")[-1],
        parent_path=(detokenize_text(uid, index_store.parent_path(folder_path) or "") or None),
    )


def update_file(
    uid: str,
    file_id: str,
    *,
    display_name: Optional[str] = None,
    folder: Optional[str] = None,
    name: Optional[str] = None,
    dataset: Optional[str] = None,
) -> FileItem:
    """Rename and/or move a file by updating metadata + Firestore index.

    NOTE: This does NOT change the storage object path (so RAG doc_id stays stable).
    """

    _assert_user_owns(uid, file_id)

    bkt = _bucket()
    blob = bkt.blob(file_id)
    if not blob.exists():
        raise FileNotFoundError("File not found")

    blob.reload()
    md = blob.metadata or {}

    current_display = (md.get("display_name") or "").strip() or (md.get("original_name") or "").strip() or file_id.split("/")[-1]
    try:
        current_folder, current_base = index_store.split_display_name(current_display)
    except Exception:
        current_folder, current_base = (md.get("folder_path") or ""), current_display.split("/")[-1]

    if display_name:
        # Store tokenized display_name in metadata/index to keep PII out of other stores.
        dn = tokenize_text(uid, display_name) if settings.PII_TOKENIZE_FILENAMES else display_name
        new_folder, new_base = index_store.split_display_name(dn)
        if not new_base:
            raise ValueError("Invalid display_name")
    else:
        nf = index_store.normalize_folder_path(folder) if folder is not None else current_folder
        nb = (name or "").strip() if name is not None else current_base
        if settings.PII_TOKENIZE_FILENAMES:
            nf = tokenize_text(uid, nf) if nf else ""
            nb = tokenize_text(uid, nb) if nb else nb
        new_folder = nf
        new_base = nb

    new_display = index_store.build_display_name(new_folder, new_base)

    # Preserve original upload name for audits; update original_name for UI/download.
    if "initial_name" not in md:
        md["initial_name"] = md.get("original_name") or current_base

    md["display_name"] = new_display
    md["folder_path"] = new_folder
    md["original_name"] = new_base
    if dataset is not None:
        md["dataset"] = dataset

    blob.metadata = md
    blob.patch()

    # Update Firestore index
    try:
        index_store.upsert_file(
            uid,
            storage_path=file_id,
            original_name=new_base,
            display_name=new_display,
            folder_path=new_folder,
            size=int(blob.size or 0),
            content_type=str(blob.content_type or md.get("content_type") or ""),
            dataset=str(md.get("dataset") or "default"),
            checksum=str(md.get("checksum") or ""),
            created_at=getattr(blob, "time_created", None) or datetime.utcnow(),
        )
    except Exception as e:
        log.debug("files_index_update_failed", uid=uid, file_id=file_id, error=str(e))

    created_iso = blob.time_created.isoformat() if getattr(blob, "time_created", None) else None
    item = FileItem(
        id=file_id,
        name=new_display,
        size=int(blob.size or 0),
        created_at=created_iso,
        content_type=str(blob.content_type or md.get("content_type") or "") or None,
        folder_path=new_folder or None,
        original_name=new_base or None,
    )
    return _detokenize_fileitems(uid, [item])[0]


def delete_file(uid: str, file_id: str) -> bool:
    _assert_user_owns(uid, file_id)
    bkt = _bucket()
    blob = bkt.blob(file_id)
    exists = blob.exists()
    log.debug("files_delete_check", uid=uid, id=file_id, exists=exists)
    if not exists:
        return False

    blob.delete()

    try:
        index_store.delete_file(uid, file_id)
    except Exception:
        pass

    log.info("files_delete_ok", uid=uid, id=file_id)
    return True


def get_signed_download_url(uid: str, file_id: str, minutes: int = 10) -> str:
    """Generate a signed URL forcing a download 'Save As' dialog."""
    from datetime import timedelta

    _assert_user_owns(uid, file_id)

    bkt = _bucket()
    blob = bkt.blob(file_id)
    if not blob.exists():
        log.info("files_signed_url_missing", uid=uid, id=file_id)
        raise FileNotFoundError("File not found")

    filename = None
    try:
        md = blob.metadata or {}
        dn = md.get("display_name")
        if dn:
            filename = str(dn).split("/")[-1]
        if not filename:
            filename = (md.get("original_name") or file_id.split("/")[-1])
    except Exception:
        filename = file_id.split("/")[-1]

    filename = detokenize_text(uid, str(filename))

    url = blob.generate_signed_url(
        expiration=timedelta(minutes=minutes),
        method="GET",
        response_disposition=f"attachment; filename*=UTF-8''{filename}",
    )
    log.debug("files_signed_url_ok", uid=uid, id=file_id, minutes=minutes)
    return url


def get_file_bytes(uid: str, file_id: str) -> tuple[bytes, str]:
    _assert_user_owns(uid, file_id)

    bkt = _bucket()
    blob = bkt.blob(file_id)
    if not blob.exists():
        log.info("files_get_bytes_missing", uid=uid, id=file_id)
        raise FileNotFoundError("File not found")
    data = blob.download_as_bytes()
    ct = blob.content_type or (blob.metadata or {}).get("content_type") or "application/octet-stream"
    log.debug("files_get_bytes_ok", uid=uid, id=file_id, size=len(data), content_type=ct)
    return data, ct
