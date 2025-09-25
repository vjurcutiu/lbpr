import datetime
from typing import Protocol, Optional
from features.auth.models import SessionOut
from core.config import settings

# ---- Contract (interface) ----
class AuthService(Protocol):
    def verify_session_cookie(self, cookie: str, check_revoked: bool) -> SessionOut: ...
    def create_session_cookie(self, id_token: str, expires_in: datetime.timedelta) -> str: ...
    def revoke_user(self, uid: str) -> None: ...

# ---- Firebase implementation ----
class FirebaseAuthService:
    def __init__(self):
        # Import here so tests can replace with stubs
        from firebase_admin import auth  # type: ignore
        self._auth = auth

    def verify_session_cookie(self, cookie: str, check_revoked: bool) -> SessionOut:
        decoded = self._auth.verify_session_cookie(cookie, check_revoked=check_revoked)
        return SessionOut(
            uid=decoded["uid"],
            email=decoded.get("email"),
            name=decoded.get("name"),
            picture=decoded.get("picture"),
        )

    def create_session_cookie(self, id_token: str, expires_in: datetime.timedelta) -> str:
        return self._auth.create_session_cookie(id_token, expires_in=expires_in)

    def revoke_user(self, uid: str) -> None:
        self._auth.revoke_refresh_tokens(uid)

# ---- Helpers shared by routes/deps ----
def cookie_settings() -> dict:
    return {
        "max_age": settings.SESSION_HOURS * 3600,
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "path": settings.COOKIE_PATH,
        **({"domain": settings.COOKIE_DOMAIN} if settings.COOKIE_DOMAIN else {}),
    }

def default_expiry() -> datetime.timedelta:
    return datetime.timedelta(hours=settings.SESSION_HOURS)
