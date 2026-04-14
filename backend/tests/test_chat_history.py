from features.chat_history import service as chat_service


def test_chat_history_roundtrip_and_isolated_by_namespace(client):
    login = client.post('/auth/session', json={'id_token': 'good-token'})
    cookie = login.headers['set-cookie'].split(';', 1)[0]

    conv = client.post(
        '/v1/chat/conversations',
        json={'ns': 'u:u_test:default', 'id': 'conv-1', 'title': 'New chat', 'tenant_id': 'tenant_demo'},
        headers={'cookie': cookie},
    )
    assert conv.status_code == 200
    assert conv.json()['id'] == 'conv-1'

    msg1 = client.post(
        '/v1/chat/conversations/conv-1/messages',
        json={'ns': 'u:u_test:default', 'role': 'user', 'content': 'hello'},
        headers={'cookie': cookie},
    )
    assert msg1.status_code == 200

    msg2 = client.post(
        '/v1/chat/conversations/conv-1/messages',
        json={'ns': 'u:u_test:default', 'role': 'assistant', 'content': 'hi there'},
        headers={'cookie': cookie},
    )
    assert msg2.status_code == 200

    listed = client.get('/v1/chat/conversations?ns=u:u_test:default', headers={'cookie': cookie})
    assert listed.status_code == 200
    assert [row['id'] for row in listed.json()] == ['conv-1']

    messages = client.get('/v1/chat/conversations/conv-1/messages?ns=u:u_test:default', headers={'cookie': cookie})
    assert messages.status_code == 200
    assert [row['role'] for row in messages.json()] == ['user', 'assistant']
    assert [row['content'] for row in messages.json()] == ['hello', 'hi there']

    other_ns = client.get('/v1/chat/conversations?ns=u:u_test:other', headers={'cookie': cookie})
    assert other_ns.status_code == 200
    assert other_ns.json() == []


def test_chat_history_delete_conversation(client):
    login = client.post('/auth/session', json={'id_token': 'good-token'})
    cookie = login.headers['set-cookie'].split(';', 1)[0]

    create = client.post(
        '/v1/chat/conversations',
        json={'ns': 'u:u_test:default', 'id': 'conv-delete', 'title': 'Delete me', 'tenant_id': 'tenant_demo'},
        headers={'cookie': cookie},
    )
    assert create.status_code == 200

    delete = client.delete('/v1/chat/conversations/conv-delete?ns=u:u_test:default', headers={'cookie': cookie})
    assert delete.status_code == 200
    assert delete.json() == {'ok': True}

    missing = client.get('/v1/chat/conversations/conv-delete/messages?ns=u:u_test:default', headers={'cookie': cookie})
    assert missing.status_code == 404
