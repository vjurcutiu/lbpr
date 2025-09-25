# features/auth/deps.py
import os
from fastapi import Depends, HTTPException, Request
from features.auth.models import SessionOut
from features.auth.service import AuthService, FirebaseAuthService, FakeAuthService
from features.auth.sessions import sessions
from core.config import settings

def get_auth_service() -> AuthService:
    # Use fake automatically when running under pytest or when AUTH_FAKE=1
    if os.getenv("PYTEST_CURRENT_TEST") or os.getenv("AUTH_FAKE") == "1":
        return FakeAuthService()
    return FirebaseAuthService()

def get_current_user(req: Request, svc: AuthService = Depends(get_auth_service)) -> SessionOut:
    sid = req.cookies.get(settings.COOKIE_NAME)
    if not sid:
        raise HTTPException(status_code=401, detail="No session")
    user = sessions.get_user(sid)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user
