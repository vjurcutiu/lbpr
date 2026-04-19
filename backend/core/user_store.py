from __future__ import annotations

import logging
from typing import Any, Optional

log = logging.getLogger("user_store")

USERS_COLLECTION = "users"


def _get_firestore_handles():
    try:
        from firebase_admin import firestore  # type: ignore
    except Exception:
        return None, None
    try:
        return firestore.client(), firestore
    except Exception:
        return None, None


def ensure_user_doc(
    uid: str,
    *,
    email: Optional[str] = None,
    name: Optional[str] = None,
    picture: Optional[str] = None,
    email_verified: Optional[bool] = None,
) -> None:
    uid = str(uid or "").strip()
    if not uid:
        return

    db, fs = _get_firestore_handles()
    if db is None or fs is None:
        return

    payload: dict[str, Any] = {
        "uid": uid,
        "updated_at": fs.SERVER_TIMESTAMP,
    }
    if email is not None:
        payload["email"] = str(email or "").strip() or None
    if name is not None:
        payload["name"] = str(name or "").strip() or None
    if picture is not None:
        payload["picture"] = str(picture or "").strip() or None
    if email_verified is not None:
        payload["email_verified"] = bool(email_verified)

    ref = db.collection(USERS_COLLECTION).document(uid)
    try:
        snap = ref.get()
        if not getattr(snap, "exists", False):
            payload["created_at"] = fs.SERVER_TIMESTAMP
        ref.set(payload, merge=True)
    except Exception:
        log.exception("ensure_user_doc_failed", uid=uid)


def load_user_doc(uid: str) -> dict[str, Any]:
    uid = str(uid or "").strip()
    if not uid:
        return {}

    db, _fs = _get_firestore_handles()
    if db is None:
        return {}

    try:
        snap = db.collection(USERS_COLLECTION).document(uid).get()
        return snap.to_dict() or {}
    except Exception:
        log.exception("load_user_doc_failed", uid=uid)
        return {}
