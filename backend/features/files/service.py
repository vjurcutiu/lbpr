# backend/features/files/service.py

from __future__ import annotations

import io
import logging
import os
import tempfile
import time
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
from core.background_jobs import submit_async as submit_background_job
from core.business_metrics import (
    record_file_upload_completed,
    record_file_upload_error,
    record_file_upload_started,
    record_ingest_completed,
    record_ingest_duration,
    record_ingest_error,
    record_ingest_started,
)

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


async def _ocr_image_google(uid: str, job_id: str, data: bytes, *, charge_usage: bool = True) -> Optional[str]:
    """OCR image via Google Cloud Vision (preferred)."""
    if not settings.OCR_ENABLE:
        return None
    try:
        from features.ocr import service as ocr_service  # lazy import
        return await ocr_service.ocr_image_bytes(uid=uid, job_id=job_id, image_bytes=data, charge_usage=charge_usage)
    except HTTPException:
        # Preserve status (e.g., 402 cap reached)
        raise
    except Exception as e:
        log.warning("ocr_google_skip", uid=uid, error=str(e))
        return None


async def _extract_text(uid: str, job_id: str, name: str, content_type: Optional[str], data: bytes, *, charge_usage: bool = True) -> Optional[str]:
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
            text = await _ocr_image_google(uid, job_id, data, charge_usage=charge_usage)
            if text:
                return text
            # optional local fallback
            return _ocr_image_local(data)
    except Exception as e:
        log.warning("extract_text_error", name=name, content_type=content_type, error=str(e))
        return None
    return None


async def _set_job_total_bytes(job_id: str, total_bytes: int) -> None:
    try:
        from core.redis_utils import get_client as _get_client  # type: ignore

        rds = await _get_client()
        await rds.hset(f"ut:job:{job_id}", mapping={"total_bytes": str(total_bytes), "pct": "100"})
        log.debug("upload_set_total_bytes", object=job_id, total_bytes=total_bytes)
    except Exception as e:
        log.warning("upload_set_total_bytes_failed", object=job_id, error=str(e))


async def _process_upload_job_async(
    *,
    uid: str,
    object_name: str,
    filename: str,
    dataset: str,
    folder_path: str,
    display_name: str,
    content_type: str,
    temp_path: str,
    sha256: str,
    total: int,
    accepted_at: float,
) -> None:
    bkt = _bucket()
    blob = bkt.blob(object_name)

    try:
        with open(temp_path, "rb") as fh:
            data = fh.read()

        await uptrack.set_phase(object_name, "extract", pct=30)
        text = await _extract_text(uid, object_name, filename, content_type, data)

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
                    record_file_upload_error(stage="limit", flow="upload")
                    log.warning("upload_tokens_exhausted_abort", uid=uid, object=object_name)
                    return
            except Exception:
                log.exception("usage_upload_tokens_error", uid=uid, object=object_name)

        tokenized_text = tokenize_text(uid, text) if text else text

        await uptrack.set_phase(object_name, "upload", pct=60)
        md = {
            "checksum": sha256,
            "owner_uid": uid,
            "dataset": dataset,
            "content_type": content_type or "",
            "original_name": filename,
            "display_name": display_name,
            "folder_path": folder_path,
            "initial_name": filename,
        }
        blob.metadata = md
        blob.upload_from_string(data, content_type=content_type or "application/octet-stream")
        await uptrack.set_phase(object_name, "upload", pct=75)
        log.info("upload_storage_ok", object=object_name, size=total)

        if text:
            try:
                from features.workflows import toolkit as workflow_toolkit

                workflow_toolkit.persist_chunk_artifact(
                    uid,
                    file_id=object_name,
                    text=text,
                    name=filename,
                    folder_path=folder_path,
                    content_type=content_type or "application/octet-stream",
                )
            except Exception as e:
                log.debug("workflow_chunk_artifact_upload_failed", uid=uid, object=object_name, error=str(e))

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
                content_type=str(blob.content_type or content_type or ""),
                dataset=dataset,
                checksum=sha256,
                created_at=getattr(blob, "time_created", None) or datetime.utcnow(),
            )
        except Exception as e:
            log.debug("files_index_upsert_failed", uid=uid, object=object_name, error=str(e))

        try:
            if tokenized_text:
                log.info("upload_extract_ok", object=object_name, chars=len(tokenized_text))
                await uptrack.set_phase(object_name, "embed", pct=85)
                ingest_t0 = time.perf_counter()
                record_ingest_started(flow="upload")
                try:
                    orchestrator.ingest_request(
                        IngestRequest(
                            dataset=dataset,
                            text=str(tokenized_text),
                            doc_id=object_name,
                            metadata={
                                "owner_uid": uid,
                                "source": "upload",
                                "title": filename,
                                "filename": filename,
                                "file_id": object_name,
                                "dataset": dataset,
                                "checksum": sha256,
                                "content_type": content_type or "",
                                "display_name": display_name,
                                "folder_path": folder_path,
                            },
                        ),
                        uid=uid,
                    )
                    await uptrack.set_phase(object_name, "upsert", pct=95)
                    record_ingest_completed(flow="upload")
                    record_ingest_duration(flow="upload", dur_ms=(time.perf_counter() - ingest_t0) * 1000, status="ok")
                    log.info("upload_ingest_ok", object=object_name)
                except Exception as e:
                    record_ingest_error(flow="upload", stage="orchestrator")
                    record_ingest_duration(flow="upload", dur_ms=(time.perf_counter() - ingest_t0) * 1000, status="error")
                    log.warning("upload_ingest_error", object=object_name, error=str(e))
            else:
                log.info(
                    "upload_text_skipped",
                    object=object_name,
                    reason="no extractable text",
                    ctype=content_type or "",
                    size=total,
                )
                await uptrack.set_phase(object_name, "upsert", pct=95)
        except Exception as e:
            await uptrack.mark_error(object_name, f"Extract/ingest error: {e}")
            record_file_upload_error(stage="extract_or_ingest", flow="upload")
            log.exception("upload_extract_error", object=object_name)
            return

        await uptrack.mark_done(object_name)
        record_file_upload_completed(flow="upload")
        log.info("upload_done", object=object_name, dur_ms=int((time.perf_counter() - accepted_at) * 1000))
    except HTTPException as exc:
        detail = getattr(exc, "detail", None) or str(exc) or "Upload failed"
        await uptrack.mark_error(object_name, str(detail))
        record_file_upload_error(stage="http_exception", flow="upload")
        log.warning("upload_background_http_error", object=object_name, detail=detail)
    except Exception as e:
        await uptrack.mark_error(object_name, f"Upload failed: {e}")
        record_file_upload_error(stage="background", flow="upload")
        log.exception("upload_background_error", object=object_name)
    finally:
        try:
            os.remove(temp_path)
        except FileNotFoundError:
            pass
        except Exception as e:
            log.debug("upload_tempfile_cleanup_failed", object=object_name, path=temp_path, error=str(e))



async def upload_file(
    uid: str,
    file: UploadFile,
    dataset: str = "default",
    folder: Optional[str] = None,
) -> UploadResponse:
    """Receive a single file and queue the expensive processing work in the shared background job pool."""

    upload_t0 = time.perf_counter()
    record_file_upload_started(flow="upload")

    raw_filename = file.filename or "file"
    raw_folder_path = index_store.normalize_folder_path(folder)

    if settings.PII_TOKENIZE_FILENAMES:
        filename = tokenize_text(uid, raw_filename)
        folder_path = tokenize_text(uid, raw_folder_path) if raw_folder_path else ""
    else:
        filename = raw_filename
        folder_path = raw_folder_path
    display_name = index_store.build_display_name(folder_path, filename)

    object_name = _object_path(uid, raw_filename)

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

    await uptrack.create_job(
        job_id=object_name,
        uid=uid,
        filename=filename,
        dataset=dataset,
        total_bytes=0,
    )

    import hashlib as _hashlib

    h = _hashlib.sha256()
    total = 0
    CHUNK = 1024 * 1024
    await uptrack.set_phase(object_name, "receive", pct=0)

    fd, temp_path = tempfile.mkstemp(prefix="lbpr-upload-", suffix=".bin")
    os.close(fd)
    try:
        with open(temp_path, "wb") as tmp:
            while True:
                buf = await file.read(CHUNK)
                if not buf:
                    break
                tmp.write(buf)
                h.update(buf)
                total += len(buf)
                await uptrack.incr_bytes(object_name, len(buf))
                if total % (5 * CHUNK) < CHUNK:
                    log.debug("upload_progress", object=object_name, bytes=total)

        sha256 = h.hexdigest()
        await _set_job_total_bytes(object_name, total)
        await uptrack.set_phase(object_name, "queued", pct=5)

        submit_background_job(
            f"upload:{object_name}",
            _process_upload_job_async,
            uid=uid,
            object_name=object_name,
            filename=filename,
            dataset=dataset,
            folder_path=folder_path,
            display_name=display_name,
            content_type=file.content_type or "application/octet-stream",
            temp_path=temp_path,
            sha256=sha256,
            total=total,
            accepted_at=upload_t0,
        )
        return UploadResponse(job_id=object_name)
    except Exception as e:
        try:
            os.remove(temp_path)
        except Exception:
            pass
        await uptrack.mark_error(object_name, f"Failed to queue upload: {e}")
        record_file_upload_error(stage="queue", flow="upload")
        log.exception("upload_queue_error", object=object_name)
        raise


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


def rename_folder(uid: str, old_path: str, new_path: str) -> dict:
    """Rename (or move) a folder.

    This rewrites:
      - Firestore folder docs for the folder subtree
      - Firestore file docs for files within the folder subtree
      - Storage blob metadata (folder_path + display_name) for those files

    NOTE: Storage object names are not changed.
    """

    raw_old = index_store.normalize_folder_path(old_path)
    raw_new = index_store.normalize_folder_path(new_path)

    if not raw_old:
        raise ValueError("old_path required")
    if not raw_new:
        raise ValueError("new_path required")
    if raw_old == raw_new:
        return {
            "ok": True,
            "old_path": raw_old,
            "new_path": raw_new,
            "files_updated": 0,
            "folders_updated": 0,
        }
    if raw_new.startswith(raw_old + "/"):
        raise ValueError("new_path cannot be inside old_path")

    # Tokenize for storage/index if enabled.
    old_tok = tokenize_text(uid, raw_old) if settings.PII_TOKENIZE_FILENAMES else raw_old
    new_tok = tokenize_text(uid, raw_new) if settings.PII_TOKENIZE_FILENAMES else raw_new

    def _remap_subpath(cur: str) -> str:
        cur = index_store.normalize_folder_path(cur)
        if cur == old_tok:
            return new_tok
        if cur.startswith(old_tok + "/"):
            return new_tok + cur[len(old_tok) :]
        return cur

    # --- Collect files + folders (source of truth: Firestore; fallback: storage scan)
    try:
        file_rows = index_store.list_files_in_folder_tree(uid, old_tok, limit=20000)
    except Exception:
        file_rows = []

    try:
        folder_rows = index_store.list_folders_in_tree(uid, old_tok, limit=20000)
    except Exception:
        folder_rows = []

    bkt = _bucket()

    marker_exists = False
    try:
        marker_exists = bkt.blob(_folder_marker_object(uid, old_tok)).exists()
    except Exception:
        marker_exists = False

    if not file_rows and not folder_rows and not marker_exists:
        raise FileNotFoundError("Folder not found")

    if not file_rows:
        # Fallback: scan storage if index is empty/out of sync
        try:
            pref = f"{_user_prefix(uid)}/uploads/"
            for blob in bkt.list_blobs(prefix=pref):
                try:
                    blob.reload()
                    md = blob.metadata or {}
                    if _is_folder_marker(blob.name, md):
                        continue
                    file_rows.append(
                        {
                            "storage_path": blob.name,
                            "folder_path": str(md.get("folder_path") or ""),
                            "display_name": str(md.get("display_name") or ""),
                            "original_name": str(md.get("original_name") or ""),
                            "dataset": str(md.get("dataset") or "default"),
                            "checksum": str(md.get("checksum") or ""),
                        }
                    )
                except Exception:
                    continue
        except Exception:
            file_rows = []

    # --- Update file metadata for all files under old folder
    files_updated = 0
    for r in file_rows:
        try:
            cur_folder = str(r.get("folder_path") or "")
            if not (cur_folder == old_tok or cur_folder.startswith(old_tok + "/")):
                continue

            storage_path = str(r.get("storage_path") or r.get("id") or "")
            if not storage_path:
                continue

            blob = bkt.blob(storage_path)
            if not blob.exists():
                continue
            blob.reload()
            md = blob.metadata or {}

            # Determine base name (already tokenized if PII_TOKENIZE_FILENAMES)
            cur_display = str(r.get("display_name") or md.get("display_name") or "")
            cur_base = (
                (cur_display.split("/")[-1] if cur_display else "")
                or str(r.get("original_name") or md.get("original_name") or "")
            )
            cur_base = (cur_base or "").split("/")[-1]
            if not cur_base:
                continue

            new_folder = _remap_subpath(cur_folder)
            new_display = index_store.build_display_name(new_folder, cur_base)

            md["folder_path"] = new_folder
            md["display_name"] = new_display
            md["original_name"] = cur_base
            blob.metadata = md
            blob.patch()

            # Update Firestore index (best-effort)
            try:
                index_store.upsert_file(
                    uid,
                    storage_path=storage_path,
                    original_name=cur_base,
                    display_name=new_display,
                    folder_path=new_folder,
                    size=int(blob.size or 0),
                    content_type=str(blob.content_type or md.get("content_type") or ""),
                    dataset=str(md.get("dataset") or r.get("dataset") or "default"),
                    checksum=str(md.get("checksum") or r.get("checksum") or ""),
                    created_at=getattr(blob, "time_created", None) or datetime.utcnow(),
                )
            except Exception:
                pass

            files_updated += 1
        except Exception:
            continue

    # --- Update folder docs (subtree) + folder marker objects
    folders_updated = 0

    # Ensure target chain exists
    try:
        index_store.ensure_folder_chain(uid, new_tok)
    except Exception:
        pass

    # Rename subtree from deepest to shallowest to reduce temporary duplicates
    paths_to_rename: list[str] = []
    for fr in folder_rows:
        p = str(fr.get("path") or "")
        if not p:
            continue
        if p == old_tok or p.startswith(old_tok + "/"):
            paths_to_rename.append(p)
    paths_to_rename.sort(key=lambda x: len(x), reverse=True)

    for p in paths_to_rename:
        try:
            new_p = _remap_subpath(p)
            if not new_p or new_p == p:
                continue
            try:
                index_store.upsert_folder(uid, new_p)
            except Exception:
                pass
            try:
                index_store.delete_folder(uid, p)
            except Exception:
                pass

            # Best-effort move marker objects
            try:
                old_marker = bkt.blob(_folder_marker_object(uid, p))
                if old_marker.exists():
                    old_marker.delete()
            except Exception:
                pass
            try:
                marker = bkt.blob(_folder_marker_object(uid, new_p))
                marker.metadata = {
                    "owner_uid": uid,
                    "is_folder_marker": "1",
                    "display_name": f"{new_p}/",
                    "folder_path": new_p,
                }
                marker.upload_from_string(b"", content_type="application/octet-stream")
            except Exception:
                pass

            folders_updated += 1
        except Exception:
            continue

    # Also ensure the root folder itself exists even if Firestore list was empty
    if folders_updated == 0:
        try:
            index_store.upsert_folder(uid, new_tok)
            index_store.delete_folder(uid, old_tok)
            folders_updated = 1
        except Exception:
            pass

    return {
        "ok": True,
        "old_path": detokenize_text(uid, old_tok),
        "new_path": detokenize_text(uid, new_tok),
        "files_updated": int(files_updated),
        "folders_updated": int(folders_updated),
    }

def move_folder(uid: str, src_path: str, dest_parent_path: Optional[str] = None):
    """Move a folder recursively by updating folder index records and file metadata.

    Storage object names are NOT changed (only metadata / Firestore index), so RAG doc ids remain stable.

    Args:
        uid: current user id
        src_path: source folder path (user-visible)
        dest_parent_path: destination parent folder path (user-visible). None/"" means Root.
    """

    src_vis = index_store.normalize_folder_path(src_path)
    if not src_vis:
        raise ValueError("Source folder path required")

    dest_parent_vis = index_store.normalize_folder_path(dest_parent_path or "")

    base_vis = src_vis.split("/")[-1]
    new_root_vis = f"{dest_parent_vis}/{base_vis}" if dest_parent_vis else base_vis

    # Guardrails: prevent moving a folder into itself or its own descendants.
    if dest_parent_vis == src_vis or dest_parent_vis.startswith(src_vis + "/"):
        raise ValueError("Cannot move a parent folder into one of its children")

    if new_root_vis == src_vis:
        return {
            "ok": True,
            "from_path": src_vis,
            "to_path": new_root_vis,
            "moved_files": 0,
            "moved_folders": 0,
        }

    # If PII tokenization is enabled, the index and marker objects store tokenized paths.
    if settings.PII_TOKENIZE_FILENAMES:
        src_tok = tokenize_text(uid, src_vis) if src_vis else ""
        dest_parent_tok = tokenize_text(uid, dest_parent_vis) if dest_parent_vis else ""
    else:
        src_tok = src_vis
        dest_parent_tok = dest_parent_vis

    base_tok = (src_tok.split("/")[-1] if src_tok else "")
    new_root_tok = f"{dest_parent_tok}/{base_tok}" if dest_parent_tok else base_tok

    # 1) Collect subtree files (authoritative for non-empty folders)
    try:
        items = list_files(uid)
    except Exception:
        items = []

    files_to_move = []
    for f in items:
        fp = index_store.normalize_folder_path(getattr(f, "folder_path", None) or "")
        if fp == src_vis or fp.startswith(src_vis + "/"):
            files_to_move.append(f)

    # 2) Collect subtree folder records (best-effort, includes empty folders)
    try:
        folder_rows = index_store.list_folders(uid)
    except Exception:
        folder_rows = []

    existing_tok_paths: set[str] = set()
    for r in folder_rows:
        p = str(r.get("path") or "")
        if not p:
            continue
        if p == src_tok or p.startswith(src_tok + "/"):
            existing_tok_paths.add(p)

    # Determine whether the source folder exists in any of our sources.
    marker_exists = False
    try:
        bkt = _bucket()
        marker_exists = bkt.blob(_folder_marker_object(uid, src_tok)).exists()
    except Exception:
        marker_exists = False

    if not files_to_move and (src_tok not in existing_tok_paths) and not marker_exists:
        raise FileNotFoundError("Folder not found")

    # Track which folder paths exist in the file subtree so we can recreate folder records at the destination.
    subtree_folder_paths_vis: set[str] = set()

    moved_files = 0
    move_errors: List[str] = []
    for f in files_to_move:
        fp = index_store.normalize_folder_path(getattr(f, "folder_path", None) or "")
        suffix = fp[len(src_vis):]  # '' or '/...'
        new_fp_vis = new_root_vis + suffix
        base_name = (f.name or "").split("/")[-1]
        try:
            update_file(uid, f.id, folder=new_fp_vis, name=base_name)
            moved_files += 1
        except Exception as e:
            move_errors.append(str(e))

        # Collect prefixes for folder records.
        parts = new_fp_vis.split("/")
        acc = []
        for seg in parts:
            acc.append(seg)
            subtree_folder_paths_vis.add("/".join(acc))

    # If we couldn't move all files, stop before touching folder records.
    if move_errors:
        first = move_errors[0]
        raise ValueError(f"{len(move_errors)} file(s) failed to move. First error: {first}")

    moved_folders = 0

    # Ensure we always consider the source folder itself even if it wasn't explicitly created.
    existing_tok_paths.add(src_tok)

    # Also backfill from moved files (for the target location). This preserves structure when folders were derived.
    if subtree_folder_paths_vis:
        for p_vis in sorted(subtree_folder_paths_vis):
            try:
                p_tok = tokenize_text(uid, p_vis) if settings.PII_TOKENIZE_FILENAMES else p_vis
                index_store.upsert_folder(uid, p_tok)
            except Exception:
                pass

    # Create destination folder records for any existing folder docs in the subtree.
    for p_tok in sorted(existing_tok_paths, key=lambda x: (x.count("/"), x)):
        if p_tok == src_tok:
            suffix = ""
        else:
            suffix = p_tok[len(src_tok):]
        new_p_tok = new_root_tok + suffix
        try:
            index_store.upsert_folder(uid, new_p_tok)
            moved_folders += 1
        except Exception:
            pass

    # Delete old folder records after creating new ones.
    for p_tok in sorted(existing_tok_paths, key=lambda x: (-x.count("/"), x)):
        try:
            index_store.delete_folder(uid, p_tok)
        except Exception:
            pass

    # 3) Move folder marker objects in Storage (best-effort)
    try:
        bkt = _bucket()
        old_prefix = f"{_user_prefix(uid)}/uploads/.folders/{src_tok}/"
        new_prefix = f"{_user_prefix(uid)}/uploads/.folders/{new_root_tok}/"
        for blob in bkt.list_blobs(prefix=old_prefix):
            tail = blob.name[len(old_prefix):]
            new_name = new_prefix + tail
            try:
                bkt.copy_blob(blob, bkt, new_name)
                blob.delete()
            except Exception:
                continue
    except Exception:
        pass

    return {
        "ok": True,
        "from_path": src_vis,
        "to_path": new_root_vis,
        "moved_files": int(moved_files),
        "moved_folders": int(moved_folders),
    }


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
        from features.workflows import toolkit as workflow_toolkit

        workflow_toolkit.delete_chunk_artifact(uid, file_id)
    except Exception:
        pass

    try:
        index_store.delete_file(uid, file_id)
    except Exception:
        pass

    log.info("files_delete_ok", uid=uid, id=file_id)
    return True

def delete_folder(uid: str, folder_path: str, *, recursive: bool = True) -> dict:
    """Delete a folder.

    When recursive=True, deletes all files in the folder tree, all folder marker objects,
    and all folder docs (the folder itself + descendants).

    Returns counts: deleted_files, deleted_folders, deleted_markers.
    """
    raw_path = index_store.normalize_folder_path(folder_path)
    if not raw_path:
        raise ValueError("Folder path required")

    # Stored form may be tokenized depending on config.
    stored_path = tokenize_text(uid, raw_path) if settings.PII_TOKENIZE_FILENAMES else raw_path

    deleted_files = 0
    deleted_markers = 0

    # Use Firestore as the source of truth for the folder tree (works even for empty folders).
    try:
        folder_rows = index_store.list_folders_in_tree(uid, stored_path, limit=20000)
    except Exception:
        folder_rows = []

    try:
        file_rows = index_store.list_files_in_folder_tree(uid, stored_path, limit=20000)
    except Exception:
        file_rows = []

    if not folder_rows and not file_rows:
        # Nothing to delete in Firestore.
        raise FileNotFoundError("Folder not found")

    if not recursive:
        # Non-recursive deletes are allowed only when empty (no files and no subfolders).
        if file_rows:
            raise ValueError("Folder not empty; use recursive=true")
        # Any descendant folder besides itself?
        desc_prefix = stored_path + "/"
        has_child_folder = any(str(r.get('path') or '').startswith(desc_prefix) for r in folder_rows)
        if has_child_folder:
            raise ValueError("Folder not empty; use recursive=true")

    # 1) Delete files in the tree
    if recursive and file_rows:
        for r in file_rows:
            sp = str(r.get("storage_path") or "").strip()
            if not sp:
                continue
            try:
                if delete_file(uid, sp):
                    deleted_files += 1
            except Exception as e:
                log.debug("folder_delete_file_failed", uid=uid, folder=stored_path, file_id=sp, error=str(e))

    # 2) Delete folder marker objects (optional)
    try:
        bkt = _bucket()
        marker_prefix = f"{_user_prefix(uid)}/uploads/.folders/{stored_path}/"
        for blob in bkt.list_blobs(prefix=marker_prefix):
            try:
                blob.delete()
                deleted_markers += 1
            except Exception:
                pass
    except Exception as e:
        log.debug("folder_delete_markers_failed", uid=uid, folder=stored_path, error=str(e))

    # 3) Delete folder docs (self + descendants)
    deleted_folders = 0
    try:
        deleted_folders = index_store.delete_folders_in_tree(uid, stored_path, limit=20000)
    except Exception as e:
        log.debug("folder_delete_folderdocs_failed", uid=uid, folder=stored_path, error=str(e))

    log.info(
        "folder_delete_ok",
        uid=uid,
        folder=stored_path,
        recursive=recursive,
        deleted_files=deleted_files,
        deleted_folders=deleted_folders,
        deleted_markers=deleted_markers,
    )

    return {
        "deleted_files": int(deleted_files),
        "deleted_folders": int(deleted_folders),
        "deleted_markers": int(deleted_markers),
    }



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


# ---------------------------- Clipboard paste ----------------------------


def _reduce_nested_paths(paths: List[str]) -> List[str]:
    """Remove nested folder roots so we don't process the same subtree multiple times."""
    norm = []
    for p in paths:
        p2 = index_store.normalize_folder_path(p)
        if p2:
            norm.append(p2)
    norm = sorted(set(norm), key=lambda x: (len(x), x))
    out: List[str] = []
    for p in norm:
        if any(p == o or p.startswith(o + "/") for o in out):
            continue
        out.append(p)
    return out


def _join_folder(parent: str, child: str) -> str:
    parent = index_store.normalize_folder_path(parent)
    child = index_store.normalize_folder_path(child)
    if not parent:
        return child
    if not child:
        return parent
    return index_store.normalize_folder_path(f"{parent}/{child}")


def _unique_filename(desired: str, existing: set[str]) -> str:
    """Return a unique filename (base name only) within a folder set."""
    desired = (desired or "").strip()
    if not desired:
        desired = "file"
    if desired not in existing:
        existing.add(desired)
        return desired

    # split extension
    base, ext = desired, ""
    if "." in desired and not desired.startswith("."):
        b, e = desired.rsplit(".", 1)
        if b:
            base, ext = b, "." + e

    cand = f"{base} (copy){ext}"
    if cand not in existing:
        existing.add(cand)
        return cand

    n = 2
    while True:
        cand = f"{base} (copy {n}){ext}"
        if cand not in existing:
            existing.add(cand)
            return cand
        n += 1


def _internalize(uid: str, s: str) -> str:
    s = index_store.normalize_folder_path(s)
    if settings.PII_TOKENIZE_FILENAMES:
        return tokenize_text(uid, s) if s else ""
    return s


def _internalize_filename(uid: str, s: str) -> str:
    fn = (s or "").strip().replace("\\", "/").split("/")[-1]
    if settings.PII_TOKENIZE_FILENAMES:
        return tokenize_text(uid, fn) if fn else fn
    return fn


def _folder_leaf(path: str) -> str:
    p = index_store.normalize_folder_path(path)
    if not p:
        return ""
    return p.split("/")[-1]


def _folder_in_subtree(folder_path: str, root: str) -> bool:
    if not root:
        return False
    return folder_path == root or folder_path.startswith(root + "/")


def _collect_existing_names(file_rows: List[dict]) -> dict[str, set[str]]:
    """Map folder_path -> set(original_name) from Firestore index rows."""
    out: dict[str, set[str]] = {}
    for r in file_rows:
        fp = str(r.get("folder_path") or "")
        on = str(r.get("original_name") or "")
        if not on:
            dn = str(r.get("display_name") or "")
            on = dn.split("/")[-1] if dn else ""
        out.setdefault(fp, set()).add(on)
    return out


def _folder_marker_create(uid: str, folder_path: str) -> None:
    """Best-effort create a 0-byte marker object for empty-folder visibility."""
    try:
        bkt = _bucket()
        marker = bkt.blob(_folder_marker_object(uid, folder_path))
        marker.metadata = {
            "owner_uid": uid,
            "is_folder_marker": "1",
            "display_name": f"{folder_path}/",
            "folder_path": folder_path,
        }
        marker.upload_from_string(b"", content_type="application/octet-stream")
    except Exception:
        return


def _folder_marker_delete(uid: str, folder_path: str) -> None:
    try:
        bkt = _bucket()
        marker = bkt.blob(_folder_marker_object(uid, folder_path))
        if marker.exists():
            marker.delete()
    except Exception:
        return


def _get_blob_metadata(uid: str, file_id: str) -> dict:
    _assert_user_owns(uid, file_id)
    bkt = _bucket()
    blob = bkt.blob(file_id)
    if not blob.exists():
        raise FileNotFoundError("File not found")
    blob.reload()
    return blob.metadata or {}


async def _copy_one_file(
    uid: str,
    *,
    src_id: str,
    dst_folder: str,
    dst_name: str,
    existing_names_by_folder: dict[str, set[str]],
) -> str:
    """Copy a single file into dst_folder with dst_name. Returns new storage_path."""
    _assert_user_owns(uid, src_id)
    bkt = _bucket()
    src_blob = bkt.blob(src_id)
    if not src_blob.exists():
        raise FileNotFoundError("File not found")
    src_blob.reload()
    md = src_blob.metadata or {}

    dataset = str(md.get("dataset") or "default")
    content_type = str(src_blob.content_type or md.get("content_type") or "application/octet-stream")
    checksum = str(md.get("checksum") or "")

    # Resolve unique name in destination folder
    dst_set = existing_names_by_folder.setdefault(dst_folder, set())
    unique_name = _unique_filename(dst_name, dst_set)
    dst_display = index_store.build_display_name(dst_folder, unique_name)

    new_object = _object_path(uid, unique_name)
    new_blob = bkt.copy_blob(src_blob, bkt, new_object)

    # Overwrite metadata with new UI/display semantics
    new_md = dict(md)
    new_md.update(
        {
            "owner_uid": uid,
            "dataset": dataset,
            "content_type": content_type,
            "checksum": checksum,
            "original_name": unique_name,
            "display_name": dst_display,
            "folder_path": dst_folder,
            "initial_name": md.get("initial_name") or md.get("original_name") or unique_name,
            "copied_from": src_id,
        }
    )
    new_blob.metadata = new_md
    try:
        new_blob.content_type = content_type
    except Exception:
        pass
    new_blob.patch()

    # Index Firestore
    try:
        index_store.upsert_file(
            uid,
            storage_path=new_object,
            original_name=unique_name,
            display_name=dst_display,
            folder_path=dst_folder,
            size=int(new_blob.size or 0),
            content_type=content_type,
            dataset=dataset,
            checksum=checksum,
            created_at=getattr(new_blob, "time_created", None) or datetime.utcnow(),
        )
    except Exception as e:
        log.debug("files_index_copy_upsert_failed", uid=uid, src_id=src_id, new_id=new_object, error=str(e))

    # Best-effort ingest so copies are searchable (no usage charge)
    try:
        data = src_blob.download_as_bytes()
        text = await _extract_text(uid, new_object, unique_name, content_type, data, charge_usage=False)
        if text:
            try:
                from features.workflows import toolkit as workflow_toolkit

                workflow_toolkit.persist_chunk_artifact(
                    uid,
                    file_id=new_object,
                    text=text,
                    name=unique_name,
                    folder_path=dst_folder,
                    content_type=content_type,
                )
            except Exception as e:
                log.debug("workflow_chunk_artifact_copy_failed", uid=uid, file_id=new_object, error=str(e))
        tokenized_text = tokenize_text(uid, text) if text else text
        if tokenized_text:
            orchestrator.ingest_request(
                IngestRequest(
                    dataset=dataset,
                    text=str(tokenized_text),
                    doc_id=new_object,
                    metadata={
                        "owner_uid": uid,
                        "source": "copy",
                        "title": unique_name,
                        "filename": unique_name,
                        "file_id": new_object,
                        "dataset": dataset,
                        "checksum": checksum,
                        "content_type": content_type,
                        "display_name": dst_display,
                        "folder_path": dst_folder,
                    },
                ),
                uid=uid,
            )
    except Exception as e:
        log.debug("copy_ingest_skipped", uid=uid, file_id=new_object, error=str(e))

    return new_object


def _move_one_file(
    uid: str,
    *,
    src_id: str,
    dst_folder: str,
    dst_name: str,
    existing_names_by_folder: dict[str, set[str]],
) -> None:
    """Move (cut) a single file by updating metadata + Firestore (storage path unchanged)."""
    _assert_user_owns(uid, src_id)
    bkt = _bucket()
    blob = bkt.blob(src_id)
    if not blob.exists():
        raise FileNotFoundError("File not found")
    blob.reload()
    md = blob.metadata or {}

    dataset = str(md.get("dataset") or "default")
    content_type = str(blob.content_type or md.get("content_type") or "application/octet-stream")
    checksum = str(md.get("checksum") or "")

    current_folder = str(md.get("folder_path") or "")
    current_name = str(md.get("original_name") or "")

    # Resolve unique name in destination folder (ignore self when staying in same folder)
    dst_set = existing_names_by_folder.setdefault(dst_folder, set())
    if dst_folder == current_folder and current_name:
        dst_set.discard(current_name)
    # Also remove from current folder set so subsequent moves into the same folder behave naturally
    if current_folder in existing_names_by_folder and current_name:
        existing_names_by_folder[current_folder].discard(current_name)

    unique_name = _unique_filename(dst_name, dst_set)
    dst_display = index_store.build_display_name(dst_folder, unique_name)

    if "initial_name" not in md:
        md["initial_name"] = md.get("original_name") or unique_name

    md["original_name"] = unique_name
    md["display_name"] = dst_display
    md["folder_path"] = dst_folder
    md["dataset"] = dataset
    md["content_type"] = content_type

    blob.metadata = md
    blob.patch()

    try:
        index_store.upsert_file(
            uid,
            storage_path=src_id,
            original_name=unique_name,
            display_name=dst_display,
            folder_path=dst_folder,
            size=int(blob.size or 0),
            content_type=content_type,
            dataset=dataset,
            checksum=checksum,
            created_at=getattr(blob, "time_created", None) or datetime.utcnow(),
        )
    except Exception as e:
        log.debug("files_index_move_upsert_failed", uid=uid, file_id=src_id, error=str(e))


async def paste(
    uid: str,
    *,
    op: str,
    destination: str,
    folders: Optional[List[str]] = None,
    files: Optional[List[str]] = None,
):
    """Paste clipboard contents (recursive folders/files).

    op='copy' duplicates blobs and re-ingests into RAG without charging usage.
    op='move' updates folder/name metadata (storage ids unchanged).
    """

    op = (op or "").strip().lower()
    if op not in {"copy", "move"}:
        raise ValueError("Invalid op; expected 'copy' or 'move'")

    dest_raw = index_store.normalize_folder_path(destination)
    dest = tokenize_text(uid, dest_raw) if settings.PII_TOKENIZE_FILENAMES and dest_raw else (dest_raw or "")

    folder_roots_raw = _reduce_nested_paths(folders or [])
    if any(not p for p in folder_roots_raw):
        folder_roots_raw = [p for p in folder_roots_raw if p]

    folder_roots = [tokenize_text(uid, p) if settings.PII_TOKENIZE_FILENAMES else p for p in folder_roots_raw]

    file_ids = [str(x) for x in (files or []) if str(x or "").strip()]
    # Deduplicate file ids
    file_ids = sorted(set(file_ids))
    for fid in file_ids:
        _assert_user_owns(uid, fid)

    # Prevent move into itself/descendant (backend guard)
    if op == "move" and dest:
        for src in folder_roots:
            if dest == src or dest.startswith(src + "/"):
                raise ValueError("Cannot move a folder into itself")

    # Fetch index rows
    file_rows = []
    folder_rows = []
    try:
        file_rows = index_store.list_files(uid, limit=5000)
    except Exception:
        file_rows = []
    try:
        folder_rows = index_store.list_folders(uid)
    except Exception:
        folder_rows = []

    existing_names_by_folder = _collect_existing_names(file_rows)

    # Build folder subtree lists (tokenized/internal)
    folder_subtrees: dict[str, List[str]] = {r: [] for r in folder_roots}
    for fr in folder_rows:
        p = str(fr.get("path") or "")
        if not p:
            continue
        for root in folder_roots:
            if _folder_in_subtree(p, root):
                folder_subtrees.setdefault(root, []).append(p)

    # Ensure each root includes itself even if it's not in Firestore yet
    for root in folder_roots:
        if root and root not in folder_subtrees.get(root, []):
            folder_subtrees.setdefault(root, []).append(root)

    # Collect files under folder selections
    files_under_folders: List[dict] = []
    seen_storage: set[str] = set()
    for r in file_rows:
        sp = str(r.get("storage_path") or "")
        if not sp:
            continue
        fp = str(r.get("folder_path") or "")
        for root in folder_roots:
            if root and _folder_in_subtree(fp, root):
                if sp in seen_storage:
                    break
                seen_storage.add(sp)
                files_under_folders.append(r)
                break

    # Add explicitly selected files (even if not in index rows)
    for fid in file_ids:
        if fid in seen_storage:
            continue
        seen_storage.add(fid)
        # synth row with blob metadata
        try:
            md = _get_blob_metadata(uid, fid)
        except Exception:
            md = {}
        files_under_folders.append(
            {
                "storage_path": fid,
                "folder_path": str(md.get("folder_path") or ""),
                "original_name": str(md.get("original_name") or fid.split("/")[-1]),
                "display_name": str(md.get("display_name") or md.get("original_name") or fid.split("/")[-1]),
            }
        )

    created_folders = 0
    created_files = 0

    # Create destination folder docs for folder selections
    dest_folders_to_create: set[str] = set()

    # For each selected folder root, paste as a child folder into destination
    root_to_destroot: dict[str, str] = {}
    for root in folder_roots:
        leaf = _folder_leaf(root)
        if not leaf:
            continue
        root_to_destroot[root] = _join_folder(dest, leaf)

    for root, subfolders in folder_subtrees.items():
        dest_root = root_to_destroot.get(root)
        if not dest_root:
            continue
        for sf in subfolders:
            rel = ""
            if sf != root:
                rel = sf[len(root) + 1 :] if sf.startswith(root + "/") else ""
            dst_sf = _join_folder(dest_root, rel)
            if dst_sf:
                dest_folders_to_create.add(dst_sf)

    # Ensure parent chain for file-only paste when destination is set
    if dest:
        dest_folders_to_create.add(dest)

    # Create all dest folders best-effort (and marker objects)
    for fp in sorted(dest_folders_to_create, key=lambda x: (len(x), x)):
        try:
            index_store.upsert_folder(uid, fp)
            _folder_marker_create(uid, fp)
            created_folders += 1
        except Exception:
            continue

    # Perform copy/move operations for files
    for r in files_under_folders:
        src_id = str(r.get("storage_path") or r.get("id") or "")
        if not src_id:
            continue

        src_folder = str(r.get("folder_path") or "")
        src_name = str(r.get("original_name") or "")
        if not src_name:
            dn = str(r.get("display_name") or "")
            src_name = dn.split("/")[-1] if dn else src_id.split("/")[-1]

        # Decide destination folder
        dst_folder = dest

        # If file came from a moved/copied folder subtree, keep relative structure
        for root in folder_roots:
            if root and _folder_in_subtree(src_folder, root):
                dest_root = root_to_destroot.get(root) or dest
                rel = ""
                if src_folder != root:
                    rel = src_folder[len(root) + 1 :] if src_folder.startswith(root + "/") else ""
                dst_folder = _join_folder(dest_root, rel)
                break

        if op == "copy":
            try:
                await _copy_one_file(
                    uid,
                    src_id=src_id,
                    dst_folder=dst_folder,
                    dst_name=src_name,
                    existing_names_by_folder=existing_names_by_folder,
                )
                created_files += 1
            except Exception as e:
                log.debug("paste_copy_file_failed", uid=uid, src_id=src_id, error=str(e))
                continue
        else:
            try:
                _move_one_file(
                    uid,
                    src_id=src_id,
                    dst_folder=dst_folder,
                    dst_name=src_name,
                    existing_names_by_folder=existing_names_by_folder,
                )
            except Exception as e:
                log.debug("paste_move_file_failed", uid=uid, src_id=src_id, error=str(e))
                continue

    # Cleanup folder docs/markers on move (best-effort)
    if op == "move" and folder_roots:
        try:
            # delete folder docs for each moved subtree
            for root in folder_roots:
                # delete descendants first
                desc = [p for p in folder_subtrees.get(root, []) if p]
                desc.sort(key=lambda x: len(x), reverse=True)
                for p in desc:
                    try:
                        index_store.delete_folder(uid, p)
                        _folder_marker_delete(uid, p)
                    except Exception:
                        pass
        except Exception:
            pass

    from .schemas import PasteResponse
    return PasteResponse(ok=True, created_folders=int(created_folders), created_files=int(created_files))
