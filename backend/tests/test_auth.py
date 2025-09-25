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
    assert data["user"]["uid"] == "u123"

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
