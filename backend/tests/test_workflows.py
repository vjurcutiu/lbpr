from __future__ import annotations

from copy import deepcopy

import pytest

import core.business_metrics as business_metrics
from features.workflows import registry as workflow_registry
from features.workflows import service as workflow_service
from features.workflows.models import WorkflowSourceFile
from tests.telemetry_testkit import FakeBusinessInstruments, assert_call


class _FakeDocSnapshot:
    def __init__(self, ref, data):
        self.reference = ref
        self.id = ref._doc_id
        self._data = deepcopy(data) if data is not None else None
        self.exists = data is not None

    def to_dict(self):
        return deepcopy(self._data) if self._data is not None else {}


class _FakeQuery:
    def __init__(self, collection, *, order_field=None, descending=False, limit_n=None):
        self._collection = collection
        self._order_field = order_field
        self._descending = descending
        self._limit_n = limit_n

    def order_by(self, field, direction=None):
        return _FakeQuery(
            self._collection,
            order_field=field,
            descending=bool(direction == _FakeFirestoreModule.Query.DESCENDING),
            limit_n=self._limit_n,
        )

    def limit(self, n):
        return _FakeQuery(
            self._collection,
            order_field=self._order_field,
            descending=self._descending,
            limit_n=n,
        )

    def stream(self):
        items = list(self._collection._iter_docs())
        if self._order_field:
            items.sort(
                key=lambda item: item[1].get(self._order_field) or item[1].get("updated_at") or "",
                reverse=self._descending,
            )
        if self._limit_n is not None:
            items = items[: self._limit_n]
        return [_FakeDocSnapshot(self._collection.document(doc_id), data) for doc_id, data in items]


class _FakeDocumentRef:
    def __init__(self, db, path):
        self._db = db
        self._path = tuple(path)
        self._doc_id = str(path[-1])

    def collection(self, name):
        return _FakeCollectionRef(self._db, self._path + (name,))

    def set(self, data, merge=True):
        payload = deepcopy(data)
        if merge and self._path in self._db._docs:
            merged = deepcopy(self._db._docs[self._path])
            merged.update(payload)
            self._db._docs[self._path] = merged
        else:
            self._db._docs[self._path] = payload

    def get(self):
        return _FakeDocSnapshot(self, self._db._docs.get(self._path))

    def delete(self):
        self._db._docs.pop(self._path, None)


class _FakeCollectionRef(_FakeQuery):
    def __init__(self, db, path):
        self._db = db
        self._path = tuple(path)
        super().__init__(self)

    def document(self, doc_id):
        return _FakeDocumentRef(self._db, self._path + (doc_id,))

    def _iter_docs(self):
        prefix_len = len(self._path)
        for path, data in self._db._docs.items():
            if len(path) == prefix_len + 1 and path[:prefix_len] == self._path:
                yield str(path[-1]), deepcopy(data)


class _FakeDB:
    def __init__(self):
        self._docs = {}

    def collection(self, name):
        return _FakeCollectionRef(self, (name,))


class _FakeFirestoreModule:
    class Query:
        DESCENDING = "DESCENDING"

    def __init__(self, db):
        self._db = db

    def client(self):
        return self._db


@pytest.fixture(autouse=True)
def clear_workflow_run_state():
    workflow_service._RUNS_BY_UID.clear()
    workflow_service._ARTIFACTS_BY_UID.clear()
    yield
    workflow_service._RUNS_BY_UID.clear()
    workflow_service._ARTIFACTS_BY_UID.clear()


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


@pytest.fixture()
def fake_workflow_firestore(monkeypatch):
    db = _FakeDB()
    fs = _FakeFirestoreModule(db)
    monkeypatch.setattr(workflow_service, '_get_firestore_handles', lambda: (db, fs))
    return db



def test_workflow_catalog_and_run_lifecycle(auth_client, fake_business_metrics, inline_workflow_jobs, stub_workflow_sources):
    catalog = auth_client.get('/v1/workflows')
    assert catalog.status_code == 200, catalog.text
    payload = catalog.json()
    workflow_ids = [item['workflow_id'] for item in payload]
    assert 'summarize_documents' in workflow_ids
    assert 'compare_documents' in workflow_ids
    summarize = next(item for item in payload if item['workflow_id'] == 'summarize_documents')
    assert summarize['launcher']['fields'][0]['key'] == 'audience'
    assert summarize['launcher']['fields'][1]['key'] == 'depth'

    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'summarize_documents',
            'selection': {
                'file_ids': ['file-1'],
                'folder_paths': ['contracts'],
                'current_folder': 'contracts',
            },
            'inputs': {'focus': 'key risks and decisions', 'audience': 'client', 'depth': 'concise'},
        },
    )
    assert create.status_code == 202, create.text
    run = create.json()
    assert run['workflow_id'] == 'summarize_documents'
    assert run['status'] in {'queued', 'completed'}
    assert run['result']['summary']
    assert run['result']['metadata']['source_files'][0]['name'] == 'Q1-plan.txt'
    assert run['result']['preview_markdown']
    assert run['result']['metadata']['summary_profile']['audience'] == 'client'
    assert run['artifact']['id'].startswith('wf_art_')
    assert run['artifact']['file_name'].endswith('.md')
    assert run['result']['metadata']['summary_profile']['depth'] == 'concise'
    assert run['result']['metadata']['summary_layers'][0]['key'] == 'snapshot'
    assert run['result']['metadata']['evidence_highlights'][0]['claim']
    assert run['result']['metadata']['suggested_actions'][0]['workflow_id'] == 'generate_report'

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



def test_workflow_runs_persist_in_firestore(auth_client, inline_workflow_jobs, stub_workflow_sources, fake_workflow_firestore):
    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'summarize_documents',
            'selection': {'file_ids': ['file-1'], 'folder_paths': ['contracts'], 'current_folder': 'contracts'},
            'inputs': {'focus': 'key risks and decisions'},
        },
    )
    assert create.status_code == 202, create.text
    run = create.json()

    stored = fake_workflow_firestore._docs[("users", "u_test", "workflow_runs", run['id'])]
    assert stored['workflow_id'] == 'summarize_documents'
    assert stored['status'] == 'completed'
    assert stored['updated_at_ts']
    assert stored['artifact']['id'].startswith('wf_art_')

    artifact_id = run['artifact']['id']
    artifact_doc = fake_workflow_firestore._docs[("users", "u_test", "workflow_artifacts", artifact_id)]
    assert artifact_doc['run_id'] == run['id']
    assert artifact_doc['file_name'].endswith('.md')

    workflow_service._RUNS_BY_UID.clear()

    listed = auth_client.get('/v1/workflows/runs')
    assert listed.status_code == 200, listed.text
    items = listed.json()['items']
    assert items and items[0]['id'] == run['id']
    assert items[0]['status'] == 'completed'

    fetched = auth_client.get(f"/v1/workflows/runs/{run['id']}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()['id'] == run['id']
    assert fetched.json()['result']['metadata']['source_files'][0]['chunk_ids'] == []
    assert fetched.json()['result']['metadata']['source_files'][0]['chunk_ids_omitted'] is True



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


def test_workflow_artifact_routes(auth_client, inline_workflow_jobs, stub_workflow_sources, fake_workflow_firestore):
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
    artifact_id = run['artifact']['id']

    artifact = auth_client.get(f'/v1/workflows/artifacts/{artifact_id}')
    assert artifact.status_code == 200, artifact.text
    artifact_payload = artifact.json()
    assert artifact_payload['run_id'] == run['id']
    assert artifact_payload['content']
    assert artifact_payload['file_name'].endswith('.md')

    download = auth_client.get(f'/v1/workflows/artifacts/{artifact_id}/download')
    assert download.status_code == 200, download.text
    assert 'attachment;' in download.headers['content-disposition']
    assert artifact_payload['content'].encode('utf-8') == download.content

    fake_workflow_firestore._docs.pop(("users", "u_test", "workflow_artifacts", artifact_id), None)
    # Save again should recreate the artifact document and refresh the run summary.
    save_again = auth_client.post(f"/v1/workflows/runs/{run['id']}/artifact")
    assert save_again.status_code == 200, save_again.text
    recreated = save_again.json()
    assert recreated['id'] == artifact_id
    assert fake_workflow_firestore._docs[("users", "u_test", "workflow_artifacts", artifact_id)]['run_id'] == run['id']
