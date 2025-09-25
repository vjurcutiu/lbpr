import pytest
from fastapi.testclient import TestClient
from main import create_app
from features.auth.deps import get_auth_service
from features.auth.models import SessionOut
import datetime

class StubAuthService:
    def __init__(self):
        self._store = {}
        self._last_cookie = "stub-cookie"

    def verify_session_cookie(self, cookie: str, check_revoked: bool) -> SessionOut:
        if cookie != self._last_cookie:
            raise ValueError("bad cookie")
        return SessionOut(uid="u123", email="u@x.tld", name="U", picture=None)

    def create_session_cookie(self, id_token: str, expires_in: datetime.timedelta) -> str:
        if id_token != "good-token":
            raise ValueError("bad token")
        self._last_cookie = "stub-cookie"
        return self._last_cookie

    def revoke_user(self, uid: str) -> None:
        self._store["revoked"] = uid

@pytest.fixture
def client():
    app = create_app()

    # Override auth service with stub
    app.dependency_overrides[get_auth_service] = lambda: StubAuthService()

    return TestClient(app)
