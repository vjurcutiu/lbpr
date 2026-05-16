from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from core.config import settings
from core.user_store import USERS_COLLECTION, ensure_user_doc
from features.auth.deps import get_auth_service, get_current_user
from features.auth.models import SessionOut
from features.auth.service import AuthService, cookie_settings
from features.auth.sessions import sessions
from .account_deletion import AccountDeletionError, delete_account_data
from .models import DeleteAccountIn, DeleteAccountOut, ProfileOut, ProfileUpdateIn

log = logging.getLogger("profile")

router = APIRouter(tags=["profile"])


def _safe_str(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s = (s or "").strip()
    return s or None


def _get_firestore_client():
    try:
        from firebase_admin import firestore  # type: ignore
        return firestore
    except Exception:
        return None


def _load_profile_overrides(uid: str) -> Dict[str, Any]:
    """Return {name, picture} overrides from Firestore if present."""
    fs = _get_firestore_client()
    if not fs:
        return {}
    try:
        db = fs.client()
        snap = db.collection(USERS_COLLECTION).document(uid).get()
        data = snap.to_dict() or {}
        out: Dict[str, Any] = {}
        if data.get("name"):
            out["name"] = str(data.get("name")).strip()
        if data.get("picture"):
            out["picture"] = str(data.get("picture")).strip()
        return out
    except Exception:
        log.exception("profile_load_error", uid=uid)
        return {}


def _save_profile_overrides(uid: str, *, name: Optional[str], picture: Optional[str]) -> None:
    fs = _get_firestore_client()
    if not fs:
        return
    try:
        db = fs.client()
        payload: Dict[str, Any] = {"updated_at": fs.SERVER_TIMESTAMP}
        if name is not None:
            payload["name"] = name
        if picture is not None:
            payload["picture"] = picture
        db.collection(USERS_COLLECTION).document(uid).set(payload, merge=True)
    except Exception:
        log.exception("profile_save_error", uid=uid)


@router.get("/me", response_model=ProfileOut)
def read_me(user: SessionOut = Depends(get_current_user)) -> ProfileOut:
    """Return the current user's profile (uid/email from session; name/picture with Firestore overrides)."""
    ensure_user_doc(user.uid, email=user.email, name=user.name, picture=user.picture, phone_number=user.phone_number, email_verified=user.email_verified)
    overrides = _load_profile_overrides(user.uid)
    return ProfileOut(
        uid=user.uid,
        email=user.email,
        name=overrides.get("name") or user.name,
        picture=overrides.get("picture") or user.picture,
        phone_number=user.phone_number,
    )


@router.patch("/me", response_model=ProfileOut)
def update_me(req: Request, payload: ProfileUpdateIn, user: SessionOut = Depends(get_current_user)) -> ProfileOut:
    """Update display name / picture. Email changes are NOT accepted here."""
    name = _safe_str(payload.name)
    picture = _safe_str(payload.picture)

    # Persist in Firestore (best-effort)
    _save_profile_overrides(user.uid, name=name, picture=picture)

    # Update the in-memory/redis session so UI reflects immediately
    try:
        sid = req.cookies.get(settings.COOKIE_NAME)
        if sid:
            sessions.update_user(sid, name=name, picture=picture)
    except Exception:
        log.exception("session_update_failed", uid=user.uid)

    # Compose response merging updated fields with current session
    new_name = name if name is not None else user.name
    new_picture = picture if picture is not None else user.picture
    return ProfileOut(uid=user.uid, email=user.email, name=new_name, picture=new_picture, phone_number=user.phone_number)


@router.post("/me/delete-account", response_model=DeleteAccountOut)
def delete_me(
    req: Request,
    resp: Response,
    payload: DeleteAccountIn,
    user: SessionOut = Depends(get_current_user),
    auth_svc: AuthService = Depends(get_auth_service),
) -> DeleteAccountOut:
    confirmation = (payload.confirm_text or "").strip().upper()
    if confirmation != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm account deletion.")

    sid = req.cookies.get(settings.COOKIE_NAME)
    try:
        summary = delete_account_data(user.uid, auth_svc=auth_svc, current_sid=sid)
    except AccountDeletionError as exc:
        log.exception("account_delete_failed", uid=user.uid, summary=exc.summary.to_dict())
        raise HTTPException(status_code=500, detail="Account deletion did not complete. Please try again or contact support.") from exc
    except Exception as exc:
        log.exception("account_delete_failed", uid=user.uid)
        raise HTTPException(status_code=500, detail="Account deletion did not complete. Please try again or contact support.") from exc

    cs = cookie_settings()
    resp.delete_cookie(settings.COOKIE_NAME, path=cs["path"], domain=cs.get("domain"), samesite=cs["samesite"])
    return DeleteAccountOut(ok=True, **summary)
