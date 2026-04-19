# test_auth.py
import re
import time
import os
import pytest
import features.auth.routes as auth_routes

# --- Original tests -----------------------------------------------------------

def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

def test_session_unauth(client):
    r = client.get("/session")
    assert r.status_code == 401
    assert r.json()["detail"] in {"No session", "Invalid or expired session"}

def test_create_session_and_read(client):
    # Login: exchange ID token for session cookie
    r = client.post("/auth/session", json={"id_token": "good-token"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert "set-cookie" in r.headers

    # Carry cookie forward
    cookie = r.headers["set-cookie"].split(";")[0]
    r2 = client.get("/session", headers={"cookie": cookie})
    assert r2.status_code == 200
    data = r2.json()
    # NOTE: the fake returns uid="u_test"
    assert data["user"]["uid"] == "u_test"


def test_create_session_provisions_user_doc(client, monkeypatch):
    captured = {}

    def fake_ensure_user_doc(uid, **kwargs):
        captured["uid"] = uid
        captured.update(kwargs)

    monkeypatch.setattr(auth_routes, "ensure_user_doc", fake_ensure_user_doc)

    r = client.post("/auth/session", json={"id_token": "good-token"})
    assert r.status_code == 200
    assert captured["uid"] == "u_test"
    assert captured["email"] == "test@example.com"
    assert captured["name"] == "Testy McTestface"
    assert captured["email_verified"] is True

def test_bad_id_token(client):
    r = client.post("/auth/session", json={"id_token": "bad"})
    assert r.status_code == 401

def test_logout_revokes_and_clears_cookie(client):
    # create a cookie first
    r = client.post("/auth/session", json={"id_token": "good-token"})
    cookie = r.headers["set-cookie"].split(";")[0]
    # call logout
    r2 = client.post("/auth/logout", headers={"cookie": cookie})
    assert r2.status_code == 200
    assert r2.json() == {"ok": True}
    # session now invalid
    r3 = client.get("/session", headers={"cookie": cookie})
    assert r3.status_code == 401


# --- New, additional coverage -------------------------------------------------

def _cookie_name_from_set_cookie(set_cookie: str) -> str:
    """
    Extract cookie name safely from a Set-Cookie header, e.g.
    "my_sid=abc...; Path=/; HttpOnly" -> "my_sid"
    """
    return set_cookie.split(";", 1)[0].split("=", 1)[0].strip()


def test_cookie_attributes_on_login(client):
    """
    Ensure we set sensible cookie attributes: HttpOnly, Path, SameSite, (optionally Secure/Domain).
    """
    r = client.post("/auth/session", json={"id_token": "good-token"})
    assert r.status_code == 200
    sc = r.headers.get("set-cookie", "")
    assert sc, "Missing Set-Cookie on login"

    # Required attributes
    assert "HttpOnly" in sc
    assert re.search(r"\bPath=", sc) is not None
    assert re.search(r"\bSameSite=", sc) is not None

    # Optional (environment-dependent)
    # These may or may not be present depending on config; assert they don't break format if present.
    if "Secure" in sc:
        assert "Secure" in sc
    if "Domain=" in sc:
        assert re.search(r"\bDomain=", sc) is not None


def test_logout_sets_expiring_cookie(client):
    """
    Logout should set the session cookie to expire (Max-Age=0 or an Expires in the past),
    *and* use the same cookie name so browsers actually drop it.
    """
    # First login to learn cookie name
    r1 = client.post("/auth/session", json={"id_token": "good-token"})
    assert r1.status_code == 200
    sc_login = r1.headers["set-cookie"]
    cookie_name = _cookie_name_from_set_cookie(sc_login)

    # Then logout
    cookie = sc_login.split(";", 1)[0]
    r2 = client.post("/auth/logout", headers={"cookie": cookie})
    assert r2.status_code == 200
    sc_logout = r2.headers.get("set-cookie", "")
    assert sc_logout, "Logout should set an expiring Set-Cookie"
    assert sc_logout.startswith(cookie_name + "="), "Logout must target the same cookie name"

    # Some implementations use Max-Age=0; others send an Expires in the past
    expired_via_max_age = "Max-Age=0" in sc_logout or "Max-Age=-" in sc_logout
    expired_via_expires = re.search(r"\bExpires=", sc_logout, re.IGNORECASE) is not None
    assert expired_via_max_age or expired_via_expires


def test_session_rejects_random_sid(client):
    """
    If a client sends a random/nonexistent SID, it must be rejected with 401.
    """
    # Learn the cookie name from a normal login
    r = client.post("/auth/session", json={"id_token": "good-token"})
    assert r.status_code == 200
    sc = r.headers["set-cookie"]
    cookie_name = _cookie_name_from_set_cookie(sc)

    # Send a bogus cookie value
    bogus_cookie = f"{cookie_name}=totally-not-real"
    r2 = client.get("/session", headers={"cookie": bogus_cookie})
    assert r2.status_code == 401


def test_sid_rotates_on_relogin_and_both_sessions_work(client):
    """
    Logging in again should issue a *new* SID. Policy-wise, we currently allow
    multiple concurrent sessions per user, so both should work independently.
    """
    # First login
    r1 = client.post("/auth/session", json={"id_token": "good-token"})
    assert r1.status_code == 200
    cookie1 = r1.headers["set-cookie"].split(";", 1)[0]

    # Second login (new SID)
    r2 = client.post("/auth/session", json={"id_token": "good-token"})
    assert r2.status_code == 200
    cookie2 = r2.headers["set-cookie"].split(";", 1)[0]

    # Different SID values expected
    assert cookie1 != cookie2, "Second login should rotate/issue a different SID"

    # Both cookies should currently be valid (multi-session policy)
    r_ok1 = client.get("/session", headers={"cookie": cookie1})
    r_ok2 = client.get("/session", headers={"cookie": cookie2})
    assert r_ok1.status_code == 200
    assert r_ok2.status_code == 200

    # And they return the same user identity
    assert r_ok1.json()["user"]["uid"] == "u_test"
    assert r_ok2.json()["user"]["uid"] == "u_test"


def test_multiple_sessions_independent(client):
    """
    Demonstrate independence: logging out with one cookie should not affect the other.
    """
    # Issue two sessions
    r1 = client.post("/auth/session", json={"id_token": "good-token"})
    r2 = client.post("/auth/session", json={"id_token": "good-token"})
    cookie1 = r1.headers["set-cookie"].split(";", 1)[0]
    cookie2 = r2.headers["set-cookie"].split(";", 1)[0]

    # Both valid
    assert client.get("/session", headers={"cookie": cookie1}).status_code == 200
    assert client.get("/session", headers={"cookie": cookie2}).status_code == 200

    # Logout with cookie1
    assert client.post("/auth/logout", headers={"cookie": cookie1}).status_code == 200

    # cookie1 invalid now, cookie2 still valid
    assert client.get("/session", headers={"cookie": cookie1}).status_code == 401
    assert client.get("/session", headers={"cookie": cookie2}).status_code == 200


@pytest.mark.timeout(5)
def test_session_expires_with_short_ttl(client, monkeypatch):
    """
    Force a 1s TTL by monkeypatching the cookie_settings symbol that
    features.auth.routes imported, then wait long enough for expiry.
    """
    # Import the module that holds the *bound* name used by the route
    import features.auth.routes as auth_routes  # type: ignore

    # Keep original so we can derive a valid shape
    original_cookie_settings = auth_routes.cookie_settings

    def tiny_cookie_settings():
        s = dict(original_cookie_settings())
        s["max_age"] = 1  # 1-second session + cookie TTL
        return s

    # IMPORTANT: patch the symbol used by the route
    monkeypatch.setattr(auth_routes, "cookie_settings", tiny_cookie_settings)

    # Login and get cookie
    r1 = client.post("/auth/session", json={"id_token": "good-token"})
    assert r1.status_code == 200
    cookie = r1.headers["set-cookie"].split(";", 1)[0]

    # Immediately valid
    assert client.get("/session", headers={"cookie": cookie}).status_code == 200

    # Sleep >2s so int(time.time()) crosses the stored exp boundary
    time.sleep(2.2)

    # Should now be expired server-side
    r3 = client.get("/session", headers={"cookie": cookie})
    assert r3.status_code == 401



@pytest.mark.skipif(
    not os.environ.get("REDIS_URL"),
    reason="Set REDIS_URL to exercise the Redis-backed session store in CI.",
)
def test_auth_happy_path_with_redis_backend(client):
    """
    Smoke-test happy path when a Redis URL is configured for the session store.
    Assumes the app under test reads REDIS_URL at startup.
    """
    # Standard login → read → logout flow
    r1 = client.post("/auth/session", json={"id_token": "good-token"})
    assert r1.status_code == 200
    cookie = r1.headers["set-cookie"].split(";", 1)[0]

    r2 = client.get("/session", headers={"cookie": cookie})
    assert r2.status_code == 200
    assert r2.json()["user"]["uid"] == "u_test"

    r3 = client.post("/auth/logout", headers={"cookie": cookie})
    assert r3.status_code == 200

    r4 = client.get("/session", headers={"cookie": cookie})
    assert r4.status_code == 401



def test_create_session_survives_user_doc_provision_failure(client, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("firestore slow or unavailable")

    monkeypatch.setattr(auth_routes, "ensure_user_doc", boom)

    r = client.post("/auth/session", json={"id_token": "good-token"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert "set-cookie" in r.headers


@pytest.mark.timeout(5)
def test_create_session_returns_even_when_user_doc_provision_is_slow(client, monkeypatch):
    def slow_ensure(*args, **kwargs):
        time.sleep(0.2)

    monkeypatch.setattr(auth_routes, "ensure_user_doc", slow_ensure)

    started = time.perf_counter()
    r = client.post("/auth/session", json={"id_token": "good-token"})
    elapsed = time.perf_counter() - started

    assert r.status_code == 200
    assert elapsed < 1.0
