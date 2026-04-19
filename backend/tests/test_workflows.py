from __future__ import annotations

import pytest

import core.business_metrics as business_metrics
from features.workflows import registry as workflow_registry
from features.workflows import service as workflow_service
from features.workflows.models import WorkflowSourceFile
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




@pytest.fixture()
def inline_workflow_jobs(monkeypatch):
    def _run_inline(job_name, fn, *args, **kwargs):
        fn(*args, **kwargs)
        class _Done:
            def result(self):
                return None
        return _Done()

    monkeypatch.setattr(workflow_service, 'submit_background_job', _run_inline)

@pytest.fixture()
def stub_workflow_sources(monkeypatch):
    monkeypatch.setattr(workflow_registry, 'OpenAIChat', None)

    def _fake_loader(uid, selection, **kwargs):
        docs = [
            WorkflowSourceFile(
                file_id='file-1',
                name='Q1-plan.txt',
                folder_path='contracts',
                content_type='text/plain',
                excerpt='The project requires legal review, budget confirmation, and a phased rollout before launch.',
                full_text_chars=98,
                excerpt_chars=98,
                truncated=False,
            )
        ]
        return docs, {
            'selected_files': 1,
            'used_source_files': 1,
            'warnings': [],
            'skipped_source_files': [],
            'truncated_source_files': [],
            'max_source_files': 8,
            'max_total_source_chars': 32000,
            'max_chars_per_file': 7000,
        }

    monkeypatch.setattr(workflow_service, '_load_source_documents', _fake_loader)


def test_workflow_catalog_and_run_lifecycle(auth_client, fake_business_metrics, inline_workflow_jobs, stub_workflow_sources):
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
    assert create.status_code == 202, create.text
    run = create.json()
    assert run['workflow_id'] == 'summarize_documents'
    assert run['status'] in {'queued', 'completed'}
    assert run['result']['summary']
    assert run['result']['metadata']['source_files'][0]['name'] == 'Q1-plan.txt'
    assert run['result']['preview_markdown']

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


def test_workflow_usage_accounting(auth_client, fake_business_metrics, inline_workflow_jobs, monkeypatch):
    class _FakeUsage:
        prompt_tokens = 120
        completion_tokens = 30
        total_tokens = 150
        approximate = False

    class _FakeResponse:
        text = '{"summary":"Done","bullets":["A"],"next_actions":["B"],"preview_markdown":"# Done","metadata":{}}'
        usage = _FakeUsage()
        operation = 'responses.create'

    class _FakeModel:
        def generate_with_usage(self, *, system: str, user: str, history=None):
            return _FakeResponse()

    def _fake_loader(uid, selection, **kwargs):
        docs = [
            WorkflowSourceFile(
                file_id='file-1',
                name='Q1-plan.txt',
                folder_path='contracts',
                content_type='text/plain',
                excerpt='The project requires legal review, budget confirmation, and a phased rollout before launch.',
                full_text_chars=98,
                excerpt_chars=98,
                truncated=False,
            )
        ]
        return docs, {
            'selected_files': 1,
            'used_source_files': 1,
            'warnings': [],
            'skipped_source_files': [],
            'truncated_source_files': [],
            'max_source_files': 8,
            'max_total_source_chars': 32000,
            'max_chars_per_file': 7000,
            'source_strategy': 'coverage_plus_targeted_rag',
        }

    async def fake_sync_caps_and_plan(uid: str):
        return {'plan': 'PRO'}

    async def fake_usage_snapshot(uid: str):
        return {'cap_file_processing_tokens': 1000, 'file_processing_tokens_used': 0}

    calls = []

    async def fake_add_file_processing_tokens(uid: str, n_tokens: int, *, category: str = 'general', breakdown=None):
        calls.append((uid, n_tokens, category, dict(breakdown or {})))
        return True, n_tokens, 1000

    monkeypatch.setattr(workflow_registry, 'OpenAIChat', _FakeModel)
    monkeypatch.setattr(workflow_service, '_load_source_documents', _fake_loader)
    monkeypatch.setattr(workflow_service, 'sync_caps_and_plan', fake_sync_caps_and_plan)
    monkeypatch.setattr(workflow_service, 'usage_snapshot', fake_usage_snapshot)
    monkeypatch.setattr(workflow_service, 'add_file_processing_tokens', fake_add_file_processing_tokens)

    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'summarize_documents',
            'selection': {'file_ids': ['file-1'], 'folder_paths': [], 'current_folder': ''},
            'inputs': {'focus': 'key risks and decisions'},
        },
    )
    assert create.status_code == 202, create.text
    run = create.json()
    assert run['status'] == 'completed'
    usage = run['result']['metadata']['usage_accounting']
    assert usage['billed_total_tokens'] == 342
    assert usage['rag_overhead_tokens'] == 192
    assert usage['llm_total_tokens'] == 150
    assert run['result']['metadata']['llm_usage']['total_tokens'] == 150
    assert calls == [
        ('u_test', 342, 'workflow', {'workflow_input_tokens': 120, 'workflow_output_tokens': 30, 'workflow_rag_overhead_tokens': 192})
    ]
