from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Request
from features.auth.deps import get_current_user
from features.auth.models import SessionOut
from features.auth.sessions import sessions
from .models import ProfileOut, ProfilePatchIn

router = APIRouter(tags=["profile"])

def _to_out(auth_user) -> ProfileOut:
    # auth_user is firebase_admin.auth.UserRecord
    return ProfileOut(
        uid=auth_user.uid,
        email=getattr(auth_user, "email", None),
        name=getattr(auth_user, "display_name", None),
        picture=getattr(auth_user, "photo_url", None),
    )

@router.get("/me", response_model=ProfileOut)
def get_me(user: SessionOut = Depends(get_current_user)) -> ProfileOut:
    # Load fresh data from Firebase to reflect any changes
    try:
        from firebase_admin import auth  # type: ignore
        rec = auth.get_user(user.uid)
        return _to_out(rec)
    except Exception as e:
        # Fallback to session info if Firebase hiccups
        return ProfileOut(uid=user.uid, email=user.email, name=user.name, picture=user.picture)

@router.patch("/me", response_model=ProfileOut)
def patch_me(
    req: Request,
    payload: ProfilePatchIn,
    user: SessionOut = Depends(get_current_user),
) -> ProfileOut:
    # Build update kwargs only for provided fields
    kwargs = {}
    if payload.email is not None:
        kwargs["email"] = payload.email
    if payload.name is not None:
        kwargs["display_name"] = payload.name
    if payload.password is not None:
        if len(payload.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
        kwargs["password"] = payload.password
    if payload.picture is not None:
        kwargs["photo_url"] = payload.picture

    if not kwargs:
        # No-op; return current
        from firebase_admin import auth  # type: ignore
        rec = auth.get_user(user.uid)
        return _to_out(rec)

    try:
        from firebase_admin import auth  # type: ignore
        rec = auth.update_user(user.uid, **kwargs)
    except Exception as e:
        # Expose a concise error
        raise HTTPException(status_code=400, detail=str(e))

    # Update the server-side session snapshot so /session reflects new values
    sid = req.cookies.get("fb_session")  # settings.COOKIE_NAME default is fb_session
    if sid:
        sessions.update_user(sid,
            email=rec.email or None,
            name=rec.display_name or None,
            picture=rec.photo_url or None,
        )

    return _to_out(rec)
