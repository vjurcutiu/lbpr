# features/auth/deps.py
from fastapi import Depends, HTTPException, Request
from features.auth.models import SessionOut
from features.auth.service import AuthService, FirebaseAuthService
from features.auth.sessions import sessions
from core.config import settings

def get_auth_service() -> AuthService:
    # In tests you can override this dependency
    return FirebaseAuthService()

def get_current_user(req: Request, svc: AuthService = Depends(get_auth_service)) -> SessionOut:
    sid = req.cookies.get(settings.COOKIE_NAME)
    if not sid:
        raise HTTPException(status_code=401, detail="No session")
    user = sessions.get_user(sid)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user
