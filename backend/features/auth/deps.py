from fastapi import Depends, HTTPException, Request
from features.auth.models import SessionOut
from features.auth.service import AuthService, FirebaseAuthService
from core.config import settings

def get_auth_service() -> AuthService:
    # In tests you can override this dependency
    return FirebaseAuthService()

def get_current_user(
    req: Request,
    svc: AuthService = Depends(get_auth_service),
) -> SessionOut:
    cookie = req.cookies.get(settings.COOKIE_NAME)
    if not cookie:
        raise HTTPException(status_code=401, detail="No session")
    try:
        return svc.verify_session_cookie(cookie, check_revoked=True)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
