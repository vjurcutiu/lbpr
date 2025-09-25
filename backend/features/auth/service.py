# features/auth/service.py
import datetime
from typing import Protocol
from features.auth.models import SessionOut
from core.config import settings

# ---- Contract (interface) ----
class AuthService(Protocol):
    def verify_id_token(self, id_token: str) -> SessionOut: ...
    def revoke_user(self, uid: str) -> None: ...

# ---- Firebase implementation ----
class FirebaseAuthService:
    def __init__(self):
        from firebase_admin import auth  # type: ignore
        self._auth = auth

    def verify_id_token(self, id_token: str) -> SessionOut:
        decoded = self._auth.verify_id_token(id_token)
        return SessionOut(
            uid=decoded["uid"],
            email=decoded.get("email"),
            name=decoded.get("name"),
            picture=decoded.get("picture"),
        )

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
