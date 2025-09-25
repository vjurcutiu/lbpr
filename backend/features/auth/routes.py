# features/auth/routes.py
from fastapi import APIRouter, Depends, Response, Request, HTTPException
from features.auth.models import CreateSessionIn, EnvelopeOut, SessionOut
from features.auth.deps import get_current_user, get_auth_service
from features.auth.service import AuthService, cookie_settings
from features.auth.sessions import sessions
from core.config import settings

router = APIRouter(tags=["auth"])

@router.get("/session", response_model=EnvelopeOut)
def read_session(user: SessionOut = Depends(get_current_user)) -> EnvelopeOut:
    return EnvelopeOut(user=user)

@router.post("/auth/session")
def create_session(resp: Response, payload: CreateSessionIn, svc: AuthService = Depends(get_auth_service)):
    try:
        user = svc.verify_id_token(payload.id_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid ID token")

    sid = sessions.create(user, ttl_seconds=cookie_settings()["max_age"])
    resp.set_cookie(settings.COOKIE_NAME, sid, **cookie_settings())
    # Match your test’s expectation:
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

    # IMPORTANT: delete cookie with the same attributes
    cs = cookie_settings()
    resp.delete_cookie(settings.COOKIE_NAME, path=cs["path"], domain=cs.get("domain"), samesite=cs["samesite"])
    return {"ok": True}
