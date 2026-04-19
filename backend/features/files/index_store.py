from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

log = logging.getLogger("files.index")

# Firestore layout (Phase 3)
#   users/{uid}/files/{fileDocId}
#   users/{uid}/folders/{folderDocId}

from core.user_store import USERS_COLLECTION

ROOT_COLLECTION = USERS_COLLECTION


def _doc_id(s: str) -> str:
    return hashlib.sha1((s or "").encode("utf-8")).hexdigest()


def normalize_folder_path(path: Optional[str]) -> str:
    """Normalize a folder path (no leading slash, no trailing slash)."""
    if not path:
        return ""
    p = str(path).strip().replace("\\", "/")
    while "//" in p:
        p = p.replace("//", "/")
    p = p.strip("/")
    if p in ("", "."):
        return ""

    parts = [seg for seg in p.split("/") if seg and seg != "."]
    if any(seg == ".." for seg in parts):
        raise ValueError("Invalid folder path")

    # Guardrails: keep paths reasonable (and avoid weird characters)
    if any("\x00" in seg for seg in parts):
        raise ValueError("Invalid folder path")
    if len(parts) > 64:
        raise ValueError("Folder path too deep")

    out = "/".join(parts)
    if len(out) > 1024:
        raise ValueError("Folder path too long")
    return out


def split_display_name(display_name: str) -> Tuple[str, str]:
    """Return (folder_path, base_name) from a display path like 'a/b/file.pdf'."""
    p = str(display_name or "").strip().replace("\\", "/")
    while "//" in p:
        p = p.replace("//", "/")
    p = p.strip("/")
    if not p:
        return "", ""

    if "/" not in p:
        return "", p

    folder, base = p.rsplit("/", 1)
    folder = normalize_folder_path(folder)
    base = base.strip()
    if base in ("", ".", ".."):
        raise ValueError("Invalid filename")
    if any(x in base for x in ("/", "\\", "\x00")):
        raise ValueError("Invalid filename")
    if len(base) > 255:
        raise ValueError("Filename too long")
    return folder, base


def build_display_name(folder_path: str, filename: str) -> str:
    folder_path = normalize_folder_path(folder_path)
    fn = (filename or "").strip().replace("\\", "/")
    fn = fn.split("/")[-1].strip()
    if not fn or fn in (".", ".."):
        raise ValueError("Invalid filename")
    if any(x in fn for x in ("/", "\\", "\x00")):
        raise ValueError("Invalid filename")
    if folder_path:
        return f"{folder_path}/{fn}"
    return fn


def parent_path(path: str) -> str:
    p = normalize_folder_path(path)
    if not p or "/" not in p:
        return ""
    return p.rsplit("/", 1)[0]


def _db():
    from firebase_admin import firestore  # type: ignore
    return firestore.client(), firestore


def folder_doc_id(uid: str, folder_path: str) -> str:
    # include uid salt so identical paths across users can't collide if you ever copy docs
    return _doc_id(f"{uid}:{normalize_folder_path(folder_path)}")


def file_doc_id(storage_path: str) -> str:
    return _doc_id(storage_path)


def ensure_folder_chain(uid: str, folder_path: str) -> List[str]:
    """Ensure all parents of folder_path exist in Firestore. Returns created paths (best-effort)."""
    folder_path = normalize_folder_path(folder_path)
    if not folder_path:
        return []

    db, fs = _db()
    created: List[str] = []

    parts = folder_path.split("/")
    acc = []
    for seg in parts:
        acc.append(seg)
        p = "/".join(acc)
        did = folder_doc_id(uid, p)
        ref = db.collection(ROOT_COLLECTION).document(uid).collection("folders").document(did)
        try:
            ref.set(
                {
                    "path": p,
                    "name": seg,
                    "parent_path": parent_path(p) or "",
                    "created_at_ts": fs.SERVER_TIMESTAMP,
                    "updated_at_ts": fs.SERVER_TIMESTAMP,
                },
                merge=True,
            )
            created.append(p)
        except Exception as e:
            log.debug("folder_chain_set_failed", extra={"uid": uid, "path": p, "error": str(e)})

    return created


def upsert_folder(uid: str, folder_path: str) -> Dict[str, Any]:
    folder_path = normalize_folder_path(folder_path)
    if not folder_path:
        raise ValueError("Folder path required")

    db, fs = _db()
    ensure_folder_chain(uid, folder_path)

    did = folder_doc_id(uid, folder_path)
    name = folder_path.split("/")[-1]
    data = {
        "path": folder_path,
        "name": name,
        "parent_path": parent_path(folder_path) or "",
        "created_at_ts": fs.SERVER_TIMESTAMP,
        "updated_at_ts": fs.SERVER_TIMESTAMP,
    }
    db.collection(ROOT_COLLECTION).document(uid).collection("folders").document(did).set(data, merge=True)
    return data


def list_folders(uid: str) -> List[Dict[str, Any]]:
    db, fs = _db()
    out: List[Dict[str, Any]] = []
    try:
        docs = (
            db.collection(ROOT_COLLECTION)
            .document(uid)
            .collection("folders")
            .order_by("path")
            .stream()
        )
        for d in docs:
            x = d.to_dict() or {}
            out.append(x)
    except Exception as e:
        log.debug("folders_list_failed", extra={"uid": uid, "error": str(e)})
    return out


def delete_folder(uid: str, folder_path: str) -> None:
    """Delete a folder record from Firestore (best-effort).

    Note: This only removes the folder record. It does NOT move/delete files.
    """
    folder_path = normalize_folder_path(folder_path)
    if not folder_path:
        return

    db, fs = _db()
    did = folder_doc_id(uid, folder_path)
    try:
        db.collection(ROOT_COLLECTION).document(uid).collection("folders").document(did).delete()
    except Exception as e:
        log.debug("folder_index_delete_failed", extra={"uid": uid, "path": folder_path, "error": str(e)})


def upsert_file(
    uid: str,
    *,
    storage_path: str,
    original_name: str,
    display_name: str,
    folder_path: str,
    size: int,
    content_type: str,
    dataset: str,
    checksum: str,
    created_at: Optional[datetime] = None,
) -> None:
    db, fs = _db()

    folder_path = normalize_folder_path(folder_path)
    display_name = build_display_name(folder_path, display_name.split("/")[-1]) if display_name else build_display_name(folder_path, original_name)

    if folder_path:
        ensure_folder_chain(uid, folder_path)

    did = file_doc_id(storage_path)
    ref = db.collection(ROOT_COLLECTION).document(uid).collection("files").document(did)

    created_at_ts = created_at if isinstance(created_at, datetime) else fs.SERVER_TIMESTAMP
    created_at_iso = created_at.isoformat() if isinstance(created_at, datetime) else None

    data = {
        "storage_path": storage_path,
        "display_name": display_name,
        "original_name": original_name,
        "folder_path": folder_path or "",
        "size": int(size or 0),
        "content_type": content_type or "",
        "dataset": dataset or "default",
        "checksum": checksum or "",
        "created_at_ts": created_at_ts,
        "created_at": created_at_iso,
        "updated_at_ts": fs.SERVER_TIMESTAMP,
    }

    ref.set(data, merge=True)


def list_files(uid: str, *, limit: int = 1000) -> List[Dict[str, Any]]:
    db, fs = _db()
    out: List[Dict[str, Any]] = []
    try:
        q = (
            db.collection(ROOT_COLLECTION)
            .document(uid)
            .collection("files")
            .order_by("created_at_ts", direction=fs.Query.DESCENDING)
            .limit(int(limit))
        )
        for d in q.stream():
            x = d.to_dict() or {}
            out.append(x)
    except Exception as e:
        log.debug("files_index_list_failed", extra={"uid": uid, "error": str(e)})
    return out


def delete_file(uid: str, storage_path: str) -> None:
    db, fs = _db()
    did = file_doc_id(storage_path)
    try:
        db.collection(ROOT_COLLECTION).document(uid).collection("files").document(did).delete()
    except Exception as e:
        log.debug("file_index_delete_failed", extra={"uid": uid, "storage_path": storage_path, "error": str(e)})




def list_files_in_folder_tree(uid: str, folder_path: str, *, limit: int = 20000) -> List[Dict[str, Any]]:
    """Return file index rows whose folder_path is the given folder or a descendant.

    Uses Firestore prefix-range queries when possible; falls back to listing and filtering.
    """
    folder_path = normalize_folder_path(folder_path)
    if not folder_path:
        raise ValueError("Folder path required")

    db, fs = _db()
    out: List[Dict[str, Any]] = []
    desc_prefix = folder_path + "/"

    try:
        # Exact matches
        q_eq = (
            db.collection(ROOT_COLLECTION)
            .document(uid)
            .collection("files")
            .where("folder_path", "==", folder_path)
            .limit(int(limit))
        )
        for d in q_eq.stream():
            out.append(d.to_dict() or {})

        # Descendants (boundary-safe by using trailing slash)
        q_pref = (
            db.collection(ROOT_COLLECTION)
            .document(uid)
            .collection("files")
            .where("folder_path", ">=", desc_prefix)
            .where("folder_path", "<", desc_prefix + "\uf8ff")
            .order_by("folder_path")
            .limit(int(limit))
        )
        for d in q_pref.stream():
            out.append(d.to_dict() or {})
        return out
    except Exception as e:
        log.debug("files_index_folder_query_failed", extra={"uid": uid, "folder_path": folder_path, "error": str(e)})

    # Fallback: list and filter
    try:
        rows = list_files(uid, limit=limit)
    except Exception:
        rows = []
    for r in rows:
        fp = str(r.get("folder_path") or "")
        if fp == folder_path or fp.startswith(desc_prefix):
            out.append(r)
    return out


def list_folders_in_tree(uid: str, folder_path: str, *, limit: int = 20000) -> List[Dict[str, Any]]:
    """Return folder index rows whose path is the given folder or a descendant."""
    folder_path = normalize_folder_path(folder_path)
    if not folder_path:
        raise ValueError("Folder path required")

    db, fs = _db()
    out: List[Dict[str, Any]] = []
    desc_prefix = folder_path + "/"

    try:
        q_eq = (
            db.collection(ROOT_COLLECTION)
            .document(uid)
            .collection("folders")
            .where("path", "==", folder_path)
            .limit(int(limit))
        )
        for d in q_eq.stream():
            out.append(d.to_dict() or {})

        q_pref = (
            db.collection(ROOT_COLLECTION)
            .document(uid)
            .collection("folders")
            .where("path", ">=", desc_prefix)
            .where("path", "<", desc_prefix + "\uf8ff")
            .order_by("path")
            .limit(int(limit))
        )
        for d in q_pref.stream():
            out.append(d.to_dict() or {})
        return out
    except Exception as e:
        log.debug("folders_index_tree_query_failed", extra={"uid": uid, "folder_path": folder_path, "error": str(e)})

    # Fallback: list and filter
    try:
        rows = list_folders(uid)
    except Exception:
        rows = []
    for r in rows:
        p = str(r.get("path") or "")
        if p == folder_path or p.startswith(desc_prefix):
            out.append(r)
    return out


def delete_folders_in_tree(uid: str, folder_path: str, *, limit: int = 20000) -> int:
    """Delete folder docs for the given folder path and all descendants. Returns count deleted."""
    folder_path = normalize_folder_path(folder_path)
    if not folder_path:
        raise ValueError("Folder path required")

    db, fs = _db()
    count = 0
    desc_prefix = folder_path + "/"

    # Delete exact + descendants using the same boundary-safe approach
    try:
        # Exact doc id can be computed, but deleting via query keeps it robust.
        q_eq = (
            db.collection(ROOT_COLLECTION)
            .document(uid)
            .collection("folders")
            .where("path", "==", folder_path)
            .limit(int(limit))
        )
        for d in q_eq.stream():
            try:
                d.reference.delete()
                count += 1
            except Exception:
                pass

        q_pref = (
            db.collection(ROOT_COLLECTION)
            .document(uid)
            .collection("folders")
            .where("path", ">=", desc_prefix)
            .where("path", "<", desc_prefix + "\uf8ff")
            .order_by("path")
            .limit(int(limit))
        )
        for d in q_pref.stream():
            try:
                d.reference.delete()
                count += 1
            except Exception:
                pass
    except Exception as e:
        log.debug("folders_tree_delete_failed", extra={"uid": uid, "folder_path": folder_path, "error": str(e)})
        # Fallback: list and delete by computed doc id
        try:
            rows = list_folders_in_tree(uid, folder_path, limit=limit)
        except Exception:
            rows = []
        for r in rows:
            p = str(r.get("path") or "")
            if not p:
                continue
            try:
                did = folder_doc_id(uid, p)
                db.collection(ROOT_COLLECTION).document(uid).collection("folders").document(did).delete()
                count += 1
            except Exception:
                pass

    return count


def backfill_from_storage(uid: str, items: Iterable[Dict[str, Any]]) -> None:
    """Best-effort index backfill when Firestore is empty."""
    for it in items:
        try:
            upsert_file(
                uid,
                storage_path=str(it.get("storage_path") or it.get("id") or ""),
                original_name=str(it.get("original_name") or it.get("name") or ""),
                display_name=str(it.get("display_name") or it.get("name") or ""),
                folder_path=str(it.get("folder_path") or ""),
                size=int(it.get("size") or 0),
                content_type=str(it.get("content_type") or ""),
                dataset=str(it.get("dataset") or "default"),
                checksum=str(it.get("checksum") or ""),
                created_at=it.get("created_at_ts") if isinstance(it.get("created_at_ts"), datetime) else None,
            )
        except Exception:
            continue


def delete_folder(uid: str, folder_path: str) -> None:
    """Delete a folder doc by its path (best-effort).

    Note: This only removes the folder record. It does NOT move/delete files.
    """
    db, fs = _db()
    p = normalize_folder_path(folder_path)
    if not p:
        return
    did = folder_doc_id(uid, p)
    try:
        db.collection(ROOT_COLLECTION).document(uid).collection('folders').document(did).delete()
    except Exception as e:
        log.debug('folder_index_delete_failed', extra={'uid': uid, 'path': p, 'error': str(e)})
