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
            'stripe_subscriptions_canceled': 1,
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
        'stripe_subscriptions_canceled': 1,
        'storage_objects_deleted': 3,
        'firestore_docs_deleted': 7,
        'pinecone_namespaces_deleted': 2,
        'redis_keys_deleted': 4,
        'sessions_revoked': 1,
    }
    assert 'set-cookie' in res.headers
    assert 'Max-Age=0' in res.headers['set-cookie'] or 'Expires=' in res.headers['set-cookie']

    assert client.get('/session', headers={'cookie': cookie}).status_code == 401



def test_delete_account_cancels_stripe_subscriptions_from_api(monkeypatch):
    from features.profile import account_deletion as deletion

    monkeypatch.setenv('STRIPE_API_KEY', 'sk_test_123')

    monkeypatch.setattr(deletion, '_collect_stripe_targets', lambda uid: ('cus_123', ['sub_firestore']))

    calls = []

    def fake_request(method, path, *, params=None, data=None):
        calls.append((method, path, params, data))
        if method == 'GET' and path == '/v1/subscriptions':
            return {
                'data': [
                    {'id': 'sub_api_active', 'status': 'active'},
                    {'id': 'sub_api_canceled', 'status': 'canceled'},
                ],
                'has_more': False,
            }
        if method == 'DELETE' and path in {'/v1/subscriptions/sub_firestore', '/v1/subscriptions/sub_api_active'}:
            return {'id': path.rsplit('/', 1)[-1], 'status': 'canceled'}
        raise AssertionError(f'unexpected Stripe request: {(method, path, params, data)}')

    monkeypatch.setattr(deletion, '_stripe_request', fake_request)

    canceled = deletion._cancel_stripe_billing('u_test')
    assert canceled == 2
    assert calls[0] == ('GET', '/v1/subscriptions', {'customer': 'cus_123', 'status': 'all', 'limit': 100}, None)


def test_delete_account_blocks_when_stripe_key_missing_for_active_subscription(monkeypatch):
    from features.profile import account_deletion as deletion

    monkeypatch.delenv('STRIPE_API_KEY', raising=False)
    monkeypatch.setattr(deletion.settings, 'STRIPE_API_KEY', None)
    monkeypatch.setattr(deletion, '_collect_stripe_targets', lambda uid: ('cus_123', []))

    try:
        deletion._cancel_stripe_billing('u_test')
        raise AssertionError('expected RuntimeError')
    except RuntimeError as exc:
        assert 'STRIPE_API_KEY' in str(exc)
