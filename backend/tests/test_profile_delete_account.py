import features.profile.routes as profile_routes
from features.auth.sessions import sessions


def test_delete_account_requires_delete_confirmation(client):
    login = client.post('/auth/session', json={'id_token': 'good-token'})
    cookie = login.headers['set-cookie'].split(';', 1)[0]

    res = client.post('/me/delete-account', json={'confirm_text': 'nope'}, headers={'cookie': cookie})
    assert res.status_code == 400
    assert 'Type DELETE' in res.json()['detail']


def test_delete_account_success_clears_cookie_and_session(client, monkeypatch):
    login = client.post('/auth/session', json={'id_token': 'good-token'})
    cookie = login.headers['set-cookie'].split(';', 1)[0]
    sid = cookie.split('=', 1)[1]

    def fake_delete_account_data(uid: str, *, auth_svc, current_sid=None):
        assert uid == 'u_test'
        assert current_sid == sid
        sessions.revoke(current_sid)
        return {
            'storage_objects_deleted': 3,
            'firestore_docs_deleted': 7,
            'pinecone_namespaces_deleted': 2,
            'redis_keys_deleted': 4,
            'sessions_revoked': 1,
        }

    monkeypatch.setattr(profile_routes, 'delete_account_data', fake_delete_account_data)

    res = client.post('/me/delete-account', json={'confirm_text': 'DELETE'}, headers={'cookie': cookie})
    assert res.status_code == 200
    assert res.json() == {
        'ok': True,
        'storage_objects_deleted': 3,
        'firestore_docs_deleted': 7,
        'pinecone_namespaces_deleted': 2,
        'redis_keys_deleted': 4,
        'sessions_revoked': 1,
    }
    assert 'set-cookie' in res.headers
    assert 'Max-Age=0' in res.headers['set-cookie'] or 'Expires=' in res.headers['set-cookie']

    assert client.get('/session', headers={'cookie': cookie}).status_code == 401
