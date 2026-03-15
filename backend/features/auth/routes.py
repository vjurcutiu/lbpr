# features/auth/routes.py
import os
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Response, Request, HTTPException

from features.auth.invites import invites
from features.auth.models import (
    CreateSessionIn,
    EnvelopeOut,
    SessionOut,
    MagicCreateIn,
    MagicCreateOut,
    MagicExchangeIn,
    MagicExchangeOut,
)
from features.auth.deps import get_current_user, get_auth_service
from features.auth.service import AuthService, cookie_settings
from features.auth.sessions import sessions
from core.config import settings
from core.business_metrics import record_auth_session_error, record_auth_session_success

router = APIRouter(tags=["auth"])


def _magic_create_http_enabled() -> bool:
    """Whether the HTTP endpoint for creating magic links is enabled.

    Recommended (Option A): keep this **disabled** and use the in-container
    CLI (backend/admin_magic_link.py) instead.
    """

    v = (os.getenv("MAGIC_LINK_HTTP_CREATE_ENABLED", "0") or "0").strip().lower()
    return v in {"1", "true", "yes", "on"}


def _require_admin_key(req: Request, *, require_configured: bool = False):
    """Admin-key guard for admin-only endpoints.

    Header:
      x-admin-key: <MAGIC_LINK_ADMIN_KEY>

    If require_configured=True and MAGIC_LINK_ADMIN_KEY is missing, raise 500
    to avoid accidentally exposing an unguarded admin endpoint.
    """

    admin_key = os.getenv("MAGIC_LINK_ADMIN_KEY", "").strip()
    if not admin_key:
        if require_configured:
            raise HTTPException(status_code=500, detail="MAGIC_LINK_ADMIN_KEY not configured")
        return
    if req.headers.get("x-admin-key") != admin_key:
        raise HTTPException(status_code=403, detail="Forbidden")


def _default_magic_ttl_seconds() -> int:
    try:
        return int(os.getenv("MAGIC_LINK_TTL_SECONDS", "86400"))
    except Exception:
        return 86400

@router.get("/session", response_model=EnvelopeOut)
def read_session(user: SessionOut = Depends(get_current_user)) -> EnvelopeOut:
    return EnvelopeOut(user=user)

@router.post("/auth/session")
def create_session(resp: Response, payload: CreateSessionIn, svc: AuthService = Depends(get_auth_service)):
    try:
        user = svc.verify_id_token(payload.id_token)
    except Exception:
        record_auth_session_error(reason="invalid_id_token")
        raise HTTPException(status_code=401, detail="Invalid ID token")

    # Enforce email verification for email/password accounts
    # If there's an email and it's not verified, block session creation
    if user.email and user.email_verified is False:
        record_auth_session_error(reason="email_unverified")
        raise HTTPException(status_code=403, detail="Please verify your email before signing in.")

    sid = sessions.create(user, ttl_seconds=cookie_settings()["max_age"])
    resp.set_cookie(settings.COOKIE_NAME, sid, **cookie_settings())
    record_auth_session_success()
    return {"ok": True}

@router.post("/auth/logout")
def logout(resp: Response, req: Request, svc: AuthService = Depends(get_auth_service)):
    sid = req.cookies.get(settings.COOKIE_NAME)
    if sid:
        # Revoke server-side session
        sessions.revoke(sid)
        # Optional: also revoke Firebase refresh tokens for defense-in-depth
        try:
            user = sessions.get_user(sid)
            if user:
                svc.revoke_user(user.uid)
        except Exception:
            pass

    cs = cookie_settings()
    resp.delete_cookie(settings.COOKIE_NAME, path=cs["path"], domain=cs.get("domain"), samesite=cs["samesite"])
    return {"ok": True}


# --- Magic-link (SMS) sign-in -------------------------------------------------


@router.post("/auth/magic/create", response_model=MagicCreateOut)
def create_magic_link(
    payload: MagicCreateIn,
    req: Request,
    svc: AuthService = Depends(get_auth_service),
) -> MagicCreateOut:
    """Create a one-time code and return a link (intended to be sent via SMS).

    Security:
    - By default, this HTTP endpoint is **disabled** (MAGIC_LINK_HTTP_CREATE_ENABLED=0)
      and you should use the in-container CLI (backend/admin_magic_link.py).
    - If you explicitly enable it, it requires `x-admin-key` and MAGIC_LINK_ADMIN_KEY
      must be configured.

    Provide either payload.uid or payload.phone_number.
    """

    if not _magic_create_http_enabled():
        # Fail closed: don't expose an admin provisioning endpoint to the internet.
        raise HTTPException(status_code=404, detail="Not found")

    _require_admin_key(req, require_configured=True)

    uid = (payload.uid or "").strip()
    phone = (payload.phone_number or "").strip()
    if not uid and not phone:
        raise HTTPException(status_code=400, detail="Provide uid or phone_number")

    if not uid:
        try:
            uid = svc.get_uid_by_phone_number(phone)
        except Exception:
            raise HTTPException(status_code=400, detail="Unknown phone number")

    ttl = int(payload.ttl_seconds or _default_magic_ttl_seconds())
    code, ttl_used = invites.create(uid, ttl_seconds=ttl)

    base = (payload.base_url or os.getenv("PUBLIC_APP_URL", "") or "").strip().rstrip("/")
    # Fall back to Origin for local/dev tooling if base isn't provided.
    if not base:
        origin = (req.headers.get("origin") or "").strip().rstrip("/")
        if origin:
            base = origin

    params = {"code": code}
    if payload.return_to:
        params["returnTo"] = payload.return_to

    path = f"/magic?{urlencode(params)}"
    link = f"{base}{path}" if base else path

    return MagicCreateOut(code=code, link=link, expires_in_seconds=ttl_used)


@router.post("/auth/magic/exchange", response_model=MagicExchangeOut)
def exchange_magic_code(
    payload: MagicExchangeIn,
    svc: AuthService = Depends(get_auth_service),
) -> MagicExchangeOut:
    """Exchange a one-time code for a Firebase custom token."""

    code = (payload.code or "").strip()
    uid = invites.consume(code)
    if not uid:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    try:
        custom_token = svc.create_custom_token(uid)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to create custom token")

    return MagicExchangeOut(custom_token=custom_token)
