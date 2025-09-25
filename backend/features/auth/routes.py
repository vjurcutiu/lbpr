from fastapi import APIRouter, Depends, Response, Request
from features.auth.models import CreateSessionIn, EnvelopeOut, SessionOut
from features.auth.deps import get_current_user, get_auth_service
from features.auth.service import AuthService, cookie_settings, default_expiry
from core.config import settings

router = APIRouter(tags=["auth"])

@router.get("/session", response_model=EnvelopeOut)
def read_session(user: SessionOut = Depends(get_current_user)) -> EnvelopeOut:
    return EnvelopeOut(user=user)

@router.post("/auth/session")
def create_session(resp: Response, payload: CreateSessionIn, svc: AuthService = Depends(get_auth_service)):
    try:
        session_cookie = svc.create_session_cookie(payload.id_token, default_expiry())
    except Exception:
        # Avoid leaking details
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid ID token")

    resp.set_cookie(key=settings.COOKIE_NAME, value=session_cookie, **cookie_settings())
    return {"ok": True}

@router.post("/auth/logout")
def logout(resp: Response, req: Request, svc: AuthService = Depends(get_auth_service)):
    cookie = req.cookies.get(settings.COOKIE_NAME)
    if cookie:
        try:
            # check_revoked=False for speed; we revoke below anyway
            user = svc.verify_session_cookie(cookie, check_revoked=False)
            svc.revoke_user(user.uid)
        except Exception:
            pass
    resp.delete_cookie(settings.COOKIE_NAME, path=settings.COOKIE_PATH)
    return {"ok": True}
