from __future__ import annotations

import pytest

import core.business_metrics as business_metrics
from tests.telemetry_testkit import FakeBusinessInstruments, assert_call


@pytest.fixture()
def auth_client(client):
    resp = client.post('/auth/session', json={'id_token': 'good-token'})
    assert resp.status_code == 200
    return client


@pytest.fixture()
def fake_business_metrics(monkeypatch):
    fake = FakeBusinessInstruments()
    monkeypatch.setattr(business_metrics, '_INSTRUMENTS', fake)
    yield fake
    monkeypatch.setattr(business_metrics, '_INSTRUMENTS', None)


def test_workflow_catalog_and_run_lifecycle(auth_client, fake_business_metrics):
    catalog = auth_client.get('/v1/workflows')
    assert catalog.status_code == 200, catalog.text
    workflow_ids = [item['workflow_id'] for item in catalog.json()]
    assert 'summarize_documents' in workflow_ids
    assert 'compare_documents' in workflow_ids

    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'summarize_documents',
            'selection': {
                'file_ids': ['file-1'],
                'folder_paths': ['contracts'],
                'current_folder': 'contracts',
            },
            'inputs': {'focus': 'key risks and decisions'},
        },
    )
    assert create.status_code == 200, create.text
    run = create.json()
    assert run['workflow_id'] == 'summarize_documents'
    assert run['status'] == 'completed'
    assert run['result']['summary']
    assert 'key risks and decisions' in '\n'.join(run['result']['bullets'])

    listed = auth_client.get('/v1/workflows/runs')
    assert listed.status_code == 200, listed.text
    items = listed.json()['items']
    assert items and items[0]['id'] == run['id']

    fetched = auth_client.get(f"/v1/workflows/runs/{run['id']}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()['id'] == run['id']

    assert_call(
        fake_business_metrics.workflow_started_total.calls,
        amount=1,
        workflow_id='summarize_documents',
        capability='summarize',
    )
    assert_call(
        fake_business_metrics.workflow_completed_total.calls,
        amount=1,
        workflow_id='summarize_documents',
        capability='summarize',
    )
    assert_call(
        fake_business_metrics.workflow_duration_ms.calls,
        workflow_id='summarize_documents',
        capability='summarize',
        status='ok',
    )


def test_compare_requires_exactly_two_files(auth_client):
    resp = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'compare_documents',
            'selection': {'file_ids': ['file-1'], 'folder_paths': [], 'current_folder': ''},
            'inputs': {},
        },
    )
    assert resp.status_code == 400
    assert 'specific number of files' in resp.text
