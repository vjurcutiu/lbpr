from typing import Protocol

from core.config import settings
from features.auth.models import SessionOut


class AuthService(Protocol):
    def verify_id_token(self, id_token: str) -> SessionOut: ...
    def revoke_user(self, uid: str) -> None: ...
    def delete_user(self, uid: str) -> None: ...
    def create_custom_token(self, uid: str) -> str: ...
    def get_uid_by_phone_number(self, phone_number: str) -> str: ...


class FirebaseAuthService:
    def __init__(self):
        from firebase_admin import auth  # type: ignore
        self._auth = auth

    def verify_id_token(self, id_token: str) -> SessionOut:
        decoded = self._auth.verify_id_token(id_token)
        # email_verified is present on Firebase ID tokens; default to False
        ev = bool(decoded.get("email_verified", False))
        return SessionOut(
            uid=decoded["uid"],
            email=decoded.get("email"),
            name=decoded.get("name"),
            picture=decoded.get("picture"),
            email_verified=ev,
        )

    def revoke_user(self, uid: str) -> None:
        self._auth.revoke_refresh_tokens(uid)

    def delete_user(self, uid: str) -> None:
        self._auth.delete_user(uid)

    def create_custom_token(self, uid: str) -> str:
        """Create a Firebase custom token for the given UID."""
        tok = self._auth.create_custom_token(uid)
        # firebase_admin returns bytes
        if isinstance(tok, bytes):
            return tok.decode("utf-8")
        return str(tok)

    def get_uid_by_phone_number(self, phone_number: str) -> str:
        user = self._auth.get_user_by_phone_number(phone_number)
        return user.uid


# --- deterministic fake for tests ---
class FakeAuthService:
    def verify_id_token(self, id_token: str) -> SessionOut:
        if id_token != "good-token":
            raise ValueError("bad token")
        return SessionOut(uid="u_test", email="test@example.com", name="Testy McTestface", picture=None, email_verified=True)

    def revoke_user(self, uid: str) -> None:
        return  # no-op in tests

    def delete_user(self, uid: str) -> None:
        return  # no-op in tests

    def create_custom_token(self, uid: str) -> str:
        # Deterministic and obviously fake.
        return f"fake-custom-token::{uid}"

    def get_uid_by_phone_number(self, phone_number: str) -> str:
        # Minimal fake: always resolve to the same UID.
        return "u_test"


def cookie_settings() -> dict:
    return {
        "max_age": settings.SESSION_HOURS * 3600,
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "path": settings.COOKIE_PATH,
        **({"domain": settings.COOKIE_DOMAIN} if settings.COOKIE_DOMAIN else {}),
    }
