from __future__ import annotations

import json
from copy import deepcopy
from io import BytesIO
from zipfile import ZipFile

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
    assert summarize['launcher']['fields'] == []

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
    assert run['title'].startswith('Summary:')
    assert 'Q1 Plan' in run['title']
    assert run['status'] in {'queued', 'completed'}
    assert run['result']['summary']
    assert run['result']['metadata']['source_files'][0]['name'] == 'Q1-plan.txt'
    assert run['result']['preview_markdown']
    assert run['result']['metadata']['summary_profile']['focus'] == 'key risks and decisions'
    assert 'audience' not in run['result']['metadata']['summary_profile']
    assert run['artifact']['id'].startswith('wf_art_')
    assert run['artifact']['file_name'].endswith('.md')
    assert 'default_layer' not in run['result']['metadata']['summary_profile']
    assert 'depth' not in run['result']['metadata']['summary_profile']
    assert 'summary_layers' not in run['result']['metadata']
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



def test_pro_workflow_catalog_and_fallback_run(auth_client, fake_business_metrics, inline_workflow_jobs, stub_workflow_sources):
    catalog = auth_client.get('/v1/workflows')
    assert catalog.status_code == 200, catalog.text
    workflow_ids = {item['workflow_id'] for item in catalog.json()}
    assert {
        'legal_contract_review',
        'legal_contract_risk_matrix',
        'legal_nda_review',
        'legal_msa_review',
        'legal_negotiation_brief',
        'legal_obligation_tracker',
    }.issubset(workflow_ids)

    legal = next(item for item in catalog.json() if item['workflow_id'] == 'legal_contract_review')
    assert legal['tier'] == 'pro'
    assert legal['pack_id'] == 'legal'
    assert legal['pack_label'] == 'Legal'
    assert legal['title'] == 'Contract Review'
    assert legal['launcher']['submit_label'] == 'Review contract'
    assert [field['key'] for field in legal['launcher']['fields']] == [
        'document_type',
        'review_mode',
        'counterparty_position',
        'risk_tolerance',
    ]

    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'legal_contract_review',
            'selection': {'file_ids': ['file-1'], 'folder_paths': [], 'current_folder': 'contracts'},
            'inputs': {
                'focus': 'approval risks and missing protections',
                'document_type': 'nda',
                'review_mode': 'approval',
                'counterparty_position': 'vendor',
                'risk_tolerance': 'conservative',
            },
        },
    )
    assert create.status_code == 202, create.text
    run = create.json()
    metadata = run['result']['metadata']
    assert run['workflow_id'] == 'legal_contract_review'
    assert run['title'].startswith('Contract Review:')
    assert run['capability'] == 'report'
    assert metadata['tier'] == 'pro'
    assert metadata['pack_id'] == 'legal'
    assert metadata['workflow_profile']['workflow_id'] == 'legal_contract_review'
    assert 'approval risks and missing protections' in metadata['focus']
    assert metadata['legal_profile']['document_type'] == 'nda'
    assert metadata['legal_profile']['review_mode'] == 'approval'
    assert metadata['legal_profile']['counterparty_position'] == 'vendor'
    assert metadata['legal_profile']['risk_tolerance'] == 'conservative'
    assert metadata['risk_items']
    assert metadata['clause_items']
    assert metadata['obligation_items']
    assert metadata['open_questions']
    assert metadata['approval_notes']
    assert 'Review profile' in run['result']['preview_markdown']
    assert run['artifact']['file_name'].endswith('.md')

    assert_call(
        fake_business_metrics.workflow_started_total.calls,
        amount=1,
        workflow_id='legal_contract_review',
        capability='report',
    )
    assert_call(
        fake_business_metrics.workflow_completed_total.calls,
        amount=1,
        workflow_id='legal_contract_review',
        capability='report',
    )


def test_legal_pack_new_workflows_have_structured_fallbacks(auth_client, inline_workflow_jobs, stub_workflow_sources):
    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'legal_nda_review',
            'selection': {'file_ids': ['file-1'], 'folder_paths': [], 'current_folder': 'contracts'},
            'inputs': {
                'focus': 'residual knowledge and confidentiality term',
                'document_type': 'nda',
                'review_mode': 'legal_risk',
                'counterparty_position': 'partner',
                'risk_tolerance': 'balanced',
            },
        },
    )
    assert create.status_code == 202, create.text
    run = create.json()
    metadata = run['result']['metadata']
    assert run['workflow_id'] == 'legal_nda_review'
    assert run['title'].startswith('NDA Review:')
    assert metadata['legal_profile']['document_type'] == 'nda'
    assert metadata['legal_profile']['review_mode'] == 'legal_risk'
    assert metadata['risk_items'][0]['requires_human_review'] is True
    assert metadata['approval_notes']
    assert 'Risk matrix' in run['result']['preview_markdown']


def test_legal_metadata_normalizes_llm_output_and_synthesizes_fallback_items(auth_client, inline_workflow_jobs, monkeypatch):
    class _FakeUsage:
        prompt_tokens = 100
        completion_tokens = 50
        total_tokens = 150
        approximate = False

    class _FakeResponse:
        usage = _FakeUsage()
        operation = 'responses.create'
        text = json.dumps({
            'title': 'Fallback Language: Liability Cap',
            'summary': 'Drafted fallback language for a liability issue.',
            'bullets': ['Liability needs a tighter fallback.'],
            'next_actions': ['Review with legal before sending.'],
            'preview_markdown': '# Fallback Language\n\n## Proposed Language\nAdd a commercially reasonable liability cap.',
            'metadata': {
                'legal_profile': {
                    'document_type': 'Msa services',
                    'review_mode': 'Legal risk',
                    'risk_tolerance': 'Aggressive',
                    'custom_profile_note': 'preserve this extra profile metadata',
                },
                'risk_items': [
                    {
                        'risk': 'Uncapped liability exposure',
                        'severity': 'material',
                        'category': 'liability',
                        'impact': 'Could expand damages exposure beyond the intended deal value.',
                        'source': 'Limitation of liability section',
                        'recommendation': 'Add a liability cap tied to fees paid in the prior 12 months.',
                    }
                ],
                'clause_items': [
                    {
                        'clause': 'liability',
                        'position': 'No liability cap is visible.',
                        'recommendation': 'Add a cap and narrow uncapped carveouts.',
                    }
                ],
                'fallback_items': [],
                'open_questions': [],
                'approval_notes': [],
            },
        })

    class _FakeModel:
        def generate_with_usage(self, *, system: str, user: str, history=None):
            return _FakeResponse()

    def _fake_loader(uid, selection, **kwargs):
        docs = [
            WorkflowSourceFile(
                file_id='file-1',
                name='msa.txt',
                folder_path='contracts',
                content_type='text/plain',
                excerpt='The limitation of liability section does not show a clear aggregate cap.',
                full_text_chars=72,
                excerpt_chars=72,
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
        }

    monkeypatch.setattr(workflow_registry, 'OpenAIChat', _FakeModel)
    monkeypatch.setattr(workflow_service, '_load_source_documents', _fake_loader)

    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'legal_fallback_language',
            'selection': {'file_ids': ['file-1'], 'folder_paths': [], 'current_folder': 'contracts'},
            'inputs': {
                'focus': 'liability cap fallback',
                'document_type': 'msa_services',
                'review_mode': 'legal_risk',
                'counterparty_position': 'vendor',
                'risk_tolerance': 'balanced',
            },
        },
    )
    assert create.status_code == 202, create.text
    metadata = create.json()['result']['metadata']

    assert metadata['legal_profile']['document_type'] == 'msa_services'
    assert metadata['legal_profile']['review_mode'] == 'legal_risk'
    assert metadata['legal_profile']['risk_tolerance'] == 'balanced'
    assert metadata['legal_profile']['custom_profile_note'] == 'preserve this extra profile metadata'

    risk = metadata['risk_items'][0]
    assert risk['issue'] == 'Uncapped liability exposure'
    assert risk['severity'] == 'high'
    assert risk['clause_family'] == 'limitation_of_liability'
    assert risk['business_impact'] == 'Could expand damages exposure beyond the intended deal value.'
    assert risk['source_basis'] == 'Limitation of liability section'
    assert risk['recommended_change'] == 'Add a liability cap tied to fees paid in the prior 12 months.'
    assert risk['requires_human_review'] is True
    assert risk['support_status'] == 'supported'
    assert risk['source_support']
    assert risk['source_support'][0]['source_name'] == 'msa.txt'
    assert 'limitation of liability' in risk['source_support'][0]['excerpt'].lower()
    assert metadata['source_support_summary']['risk_items_supported'] >= 1

    fallback_item = metadata['fallback_items'][0]
    assert fallback_item['clause_family'] == 'limitation_of_liability'
    assert fallback_item['proposed_language'] == 'Add a liability cap tied to fees paid in the prior 12 months.'
    assert fallback_item['source_basis'] == 'Limitation of liability section'
    assert fallback_item['confidence'] == 'low'
    assert metadata['open_questions']
    assert metadata['approval_notes']



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



def test_workflow_run_rename_updates_run_and_artifact(auth_client, inline_workflow_jobs, stub_workflow_sources, fake_workflow_firestore):
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

    rename = auth_client.patch(f"/v1/workflows/runs/{run['id']}/title", json={'title': 'Client Brief: Launch Plan'})
    assert rename.status_code == 200, rename.text
    renamed = rename.json()
    assert renamed['title'] == 'Client Brief: Launch Plan'
    assert renamed['artifact']['file_name'] == 'client-brief-launch-plan.md'
    assert renamed['result']['preview_markdown'].startswith('# Client Brief: Launch Plan')

    artifact = auth_client.get(f'/v1/workflows/artifacts/{artifact_id}')
    assert artifact.status_code == 200, artifact.text
    artifact_payload = artifact.json()
    assert artifact_payload['title'] == 'Client Brief: Launch Plan'
    assert artifact_payload['file_name'] == 'client-brief-launch-plan.md'
    assert artifact_payload['content'].startswith('# Client Brief: Launch Plan')


def test_workflow_manual_edit_creates_new_saved_version(auth_client, inline_workflow_jobs, stub_workflow_sources, fake_workflow_firestore):
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
    base_version_id = run['active_version_id']

    edited_markdown = '# Edited client brief\n\nThis is the rewritten output.\n\n- Keep this point.'
    edit = auth_client.post(
        f"/v1/workflows/runs/{run['id']}/versions/{base_version_id}/edit",
        json={'content': edited_markdown},
    )
    assert edit.status_code == 200, edit.text
    edited = edit.json()

    assert edited['active_version_id'] != base_version_id
    assert edited['result']['preview_markdown'] == edited_markdown
    assert edited['result']['metadata']['manual_edit'] is True
    assert edited['result']['metadata']['parent_version_id'] == base_version_id
    assert len(edited['versions']) == 2
    active_version = next(item for item in edited['versions'] if item['id'] == edited['active_version_id'])
    assert active_version['kind'] == 'edit'
    assert active_version['parent_version_id'] == base_version_id
    assert active_version['artifact']['id'] == edited['artifact']['id']

    artifact = auth_client.get(f"/v1/workflows/artifacts/{edited['artifact']['id']}")
    assert artifact.status_code == 200, artifact.text
    artifact_payload = artifact.json()
    assert artifact_payload['content'] == edited_markdown
    assert artifact_payload['metadata']['version_id'] == edited['active_version_id']

    download = auth_client.get(f"/v1/workflows/artifacts/{edited['artifact']['id']}/download?format=txt")
    assert download.status_code == 200, download.text
    assert b'Edited client brief' in download.content
    assert b'rewritten output' in download.content


def test_workflow_manual_edit_can_overwrite_active_version(auth_client, inline_workflow_jobs, stub_workflow_sources, fake_workflow_firestore):
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
    base_version_id = run['active_version_id']
    base_artifact_id = run['artifact']['id']

    edited_markdown = '# Overwritten client brief\n\nThis replaces the current version.'
    edit = auth_client.post(
        f"/v1/workflows/runs/{run['id']}/versions/{base_version_id}/edit",
        json={'content': edited_markdown, 'mode': 'overwrite'},
    )
    assert edit.status_code == 200, edit.text
    edited = edit.json()

    assert edited['active_version_id'] == base_version_id
    assert edited['result']['preview_markdown'] == edited_markdown
    assert len(edited['versions']) == 1
    active_version = edited['versions'][0]
    assert active_version['id'] == base_version_id
    assert active_version['kind'] == 'edit'
    assert active_version['parent_version_id'] is None
    assert active_version['artifact']['id'] == base_artifact_id
    assert edited['artifact']['id'] == base_artifact_id

    artifact = auth_client.get(f"/v1/workflows/artifacts/{base_artifact_id}")
    assert artifact.status_code == 200, artifact.text
    artifact_payload = artifact.json()
    assert artifact_payload['content'] == edited_markdown
    assert artifact_payload['metadata']['version_id'] == base_version_id


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
        return {'cap_workflow_tokens': 1000, 'workflow_tokens_used': 0}

    calls = []

    async def fake_add_workflow_tokens(uid: str, n_tokens: int, *, category: str = 'general', breakdown=None):
        calls.append((uid, n_tokens, category, dict(breakdown or {})))
        return True, n_tokens, 1000

    monkeypatch.setattr(workflow_registry, 'OpenAIChat', _FakeModel)
    monkeypatch.setattr(workflow_service, '_load_source_documents', _fake_loader)
    monkeypatch.setattr(workflow_service, 'sync_caps_and_plan', fake_sync_caps_and_plan)
    monkeypatch.setattr(workflow_service, 'usage_snapshot', fake_usage_snapshot)
    monkeypatch.setattr(workflow_service, 'add_workflow_tokens', fake_add_workflow_tokens)

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
    assert download.headers['content-type'].startswith('text/markdown')

    txt_download = auth_client.get(f'/v1/workflows/artifacts/{artifact_id}/download?format=txt')
    assert txt_download.status_code == 200, txt_download.text
    assert txt_download.headers['content-type'].startswith('text/plain')
    assert 'filename="summary-q1-plan.txt"' in txt_download.headers['content-disposition']
    assert b'Summary' in txt_download.content or b'Next steps' in txt_download.content

    docx_download = auth_client.get(f'/v1/workflows/artifacts/{artifact_id}/download?format=docx')
    assert docx_download.status_code == 200, docx_download.text
    assert docx_download.headers['content-type'].startswith('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    assert 'filename="summary-q1-plan.docx"' in docx_download.headers['content-disposition']
    assert docx_download.content[:4] == b'PK\x03\x04'

    pdf_download = auth_client.get(f'/v1/workflows/artifacts/{artifact_id}/download?format=pdf')
    assert pdf_download.status_code == 200, pdf_download.text
    assert pdf_download.headers['content-type'].startswith('application/pdf')
    assert 'filename="summary-q1-plan.pdf"' in pdf_download.headers['content-disposition']
    assert pdf_download.content.startswith(b'%PDF')

    fake_workflow_firestore._docs.pop(("users", "u_test", "workflow_artifacts", artifact_id), None)
    # Save again should recreate the artifact document and refresh the run summary.
    save_again = auth_client.post(f"/v1/workflows/runs/{run['id']}/artifact")
    assert save_again.status_code == 200, save_again.text
    recreated = save_again.json()
    assert recreated['id'] == artifact_id
    assert fake_workflow_firestore._docs[("users", "u_test", "workflow_artifacts", artifact_id)]['run_id'] == run['id']


def test_workflow_artifact_exports_strip_internal_notes_sections():
    artifact = workflow_service.WorkflowArtifact(
        id='wf_art_test',
        run_id='wf_run_test',
        workflow_id='summarize_documents',
        title='Client Summary',
        capability='summarize',
        file_name='client-summary.md',
        content="""# Client Summary

## Key points
- Ready for review

## Workflow notes
- Keep this internal

## Next actions
- Share with the client

## Source notes
- Internal only
""",
        metadata={},
    )

    markdown_download = workflow_service.export_artifact_for_download(artifact, target_format='markdown')
    markdown_text = markdown_download.content.decode('utf-8')
    assert 'Workflow notes' not in markdown_text
    assert 'Source notes' not in markdown_text
    assert 'Keep this internal' not in markdown_text
    assert 'Internal only' not in markdown_text
    assert 'Share with the client' in markdown_text

    txt_download = workflow_service.export_artifact_for_download(artifact, target_format='txt')
    txt_text = txt_download.content.decode('utf-8')
    assert 'Workflow notes' not in txt_text
    assert 'Source notes' not in txt_text
    assert 'Share with the client' in txt_text

    docx_download = workflow_service.export_artifact_for_download(artifact, target_format='docx')
    with ZipFile(BytesIO(docx_download.content)) as archive:
        document_xml = archive.read('word/document.xml').decode('utf-8')
    assert 'Workflow notes' not in document_xml
    assert 'Source notes' not in document_xml
    assert 'Keep this internal' not in document_xml
    assert 'Internal only' not in document_xml
    assert 'Share with the client' in document_xml


def test_workflow_artifact_downloads_use_customer_facing_clause_labels():
    artifact = workflow_service.WorkflowArtifact(
        id='wf_art_clause_labels',
        run_id='wf_run_clause_labels',
        workflow_id='legal_clause_extraction',
        title='Clause Review',
        capability='extract',
        file_name='clause-review.md',
        content="""# Clause Review

Focus areas: ip_ownership, data_protection, and limitation_of_liability.

| Clause family | current_position | recommended_position |
| --- | --- | --- |
| ip_ownership | Vendor owns custom work product. | Customer should own paid deliverables. |
| data_protection | Security language is light. | Add security controls. |
| limitation_of_liability | Cap excludes confidentiality. | Add narrow carveouts. |
""",
        metadata={},
    )

    markdown_download = workflow_service.export_artifact_for_download(artifact, target_format='markdown')
    markdown_text = markdown_download.content.decode('utf-8')
    assert 'ip_ownership' not in markdown_text
    assert 'data_protection' not in markdown_text
    assert 'limitation_of_liability' not in markdown_text
    assert 'clause_family' not in markdown_text
    assert 'Clause family' not in markdown_text
    assert 'current_position' not in markdown_text
    assert 'recommended_position' not in markdown_text
    assert 'IP Ownership' in markdown_text
    assert 'Data Protection' in markdown_text
    assert 'Limitation of Liability' in markdown_text
    assert 'Clause Type' in markdown_text
    assert 'Current Position' in markdown_text
    assert 'Recommended Position' in markdown_text

    txt_download = workflow_service.export_artifact_for_download(artifact, target_format='txt')
    txt_text = txt_download.content.decode('utf-8')
    assert 'ip_ownership' not in txt_text
    assert 'IP Ownership' in txt_text
    assert '| IP Ownership' in txt_text

    docx_download = workflow_service.export_artifact_for_download(artifact, target_format='docx')
    with ZipFile(BytesIO(docx_download.content)) as archive:
        document_xml = archive.read('word/document.xml').decode('utf-8')
    assert 'ip_ownership' not in document_xml
    assert 'data_protection' not in document_xml
    assert 'limitation_of_liability' not in document_xml
    assert 'clause_family' not in document_xml
    assert 'Clause family' not in document_xml
    assert 'current_position' not in document_xml
    assert 'recommended_position' not in document_xml
    assert 'IP Ownership' in document_xml
    assert 'Data Protection' in document_xml
    assert 'Limitation of Liability' in document_xml
    assert 'Clause Type' in document_xml
    assert 'Current Position' in document_xml
    assert 'Recommended Position' in document_xml

    pdf_download = workflow_service.export_artifact_for_download(artifact, target_format='pdf')
    assert pdf_download.content.startswith(b'%PDF')
    try:
        from pypdf import PdfReader
    except Exception:  # pragma: no cover - local dependency guard
        return
    reader = PdfReader(BytesIO(pdf_download.content))
    pdf_text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    assert 'Clause family' not in pdf_text
    assert 'Clause Type' in pdf_text
    assert 'Confidentialit y' not in pdf_text


def test_workflow_artifact_table_exports_keep_tables_and_landscape_layout():
    artifact = workflow_service.WorkflowArtifact(
        id='wf_art_table',
        run_id='wf_run_table',
        workflow_id='legal_risk_matrix',
        title='Risk Matrix',
        capability='extract',
        file_name='risk-matrix.md',
        content="""# Risk Matrix

Executive summary paragraph.

## Risk Matrix

| Issue | Severity | Source basis | Recommendation | Fallback position |
| --- | --- | --- | --- | --- |
| Return/destruction | High | On request, destroy or return confidential information. | Add a documented response owner and timeline. | Accept with internal deletion process. |
| Residuals | Medium | Residual knowledge language is broad. | Narrow residuals to unaided memory. | Escalate if source code is included. |

## Approval checklist
- Legal approval required
""",
        metadata={},
    )

    txt_download = workflow_service.export_artifact_for_download(artifact, target_format='txt')
    txt_text = txt_download.content.decode('utf-8')
    assert '| Issue              | Severity | Source basis' in txt_text
    assert '| Return/destruction | High' in txt_text

    docx_download = workflow_service.export_artifact_for_download(artifact, target_format='docx')
    with ZipFile(BytesIO(docx_download.content)) as archive:
        document_xml = archive.read('word/document.xml').decode('utf-8')
    assert '<w:tbl>' in document_xml
    assert 'w:orient="landscape"' in document_xml
    assert '<w:tblHeader w:val="true"/>' in document_xml
    assert '<w:cantSplit/>' in document_xml
    assert 'Return/destruction' in document_xml
    assert 'Residuals' in document_xml

    pdf_download = workflow_service.export_artifact_for_download(artifact, target_format='pdf')
    assert pdf_download.content.startswith(b'%PDF')
    try:
        from pypdf import PdfReader
    except Exception:  # pragma: no cover - local dependency guard
        return
    reader = PdfReader(BytesIO(pdf_download.content))
    assert any(float(page.mediabox.width) > float(page.mediabox.height) for page in reader.pages)


def test_workflow_preview_keeps_warnings_internal(auth_client, inline_workflow_jobs, stub_workflow_sources, monkeypatch):
    original_loader = workflow_service._load_source_documents

    def _loader_with_warning(uid, selection, **kwargs):
        docs, stats = original_loader(uid, selection, **kwargs)
        patched = dict(stats)
        patched['warnings'] = ['Used only part of the selection for internal workflow handling.']
        return docs, patched

    monkeypatch.setattr(workflow_service, '_load_source_documents', _loader_with_warning)

    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'summarize_documents',
            'selection': {'file_ids': ['file-1'], 'folder_paths': [], 'current_folder': ''},
            'inputs': {'focus': 'client-ready summary'},
        },
    )
    assert create.status_code == 202, create.text
    run = create.json()

    assert run['result']['metadata']['warnings'] == ['Used only part of the selection for internal workflow handling.']
    assert 'Workflow notes' not in run['result']['preview_markdown']
    assert 'internal workflow handling' not in run['result']['preview_markdown']

    artifact_id = run['artifact']['id']
    artifact = auth_client.get(f'/v1/workflows/artifacts/{artifact_id}')
    assert artifact.status_code == 200, artifact.text
    artifact_payload = artifact.json()
    assert 'Workflow notes' not in artifact_payload['content']
    assert 'internal workflow handling' not in artifact_payload['content']

    txt_download = auth_client.get(f'/v1/workflows/artifacts/{artifact_id}/download?format=txt')
    assert txt_download.status_code == 200, txt_download.text
    assert b'Workflow notes' not in txt_download.content
    assert b'internal workflow handling' not in txt_download.content


def _without_sources_used_section(markdown: str) -> str:
    return workflow_registry._strip_markdown_source_sections(markdown)


def test_single_source_workflow_hides_source_name_from_body_but_keeps_sources_used(auth_client, inline_workflow_jobs, stub_workflow_sources):
    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'summarize_documents',
            'selection': {'file_ids': ['file-1'], 'folder_paths': [], 'current_folder': ''},
            'inputs': {'focus': 'client-ready summary'},
        },
    )
    assert create.status_code == 202, create.text
    run = create.json()
    result = run['result']

    assert result['metadata']['source_files'][0]['name'] == 'Q1-plan.txt'
    assert result['metadata']['single_source_workflow'] is True
    assert result['metadata']['source_file_count'] == 1
    assert 'Q1-plan.txt' not in result['summary']
    preview_body = _without_sources_used_section(result['preview_markdown'])
    assert 'Q1-plan.txt' not in preview_body
    assert 'Sources used' in result['preview_markdown']
    assert result['preview_markdown'].count('Q1-plan.txt') == 1
    assert all('Q1-plan.txt' not in item for item in result['bullets'])
    assert all(not item.get('sources') for item in result['metadata']['evidence_highlights'])



def test_single_source_llm_preview_strips_source_section_and_inline_label(auth_client, inline_workflow_jobs, monkeypatch):
    class _FakeUsage:
        prompt_tokens = 20
        completion_tokens = 10
        total_tokens = 30
        approximate = False

    class _FakeResponse:
        text = '''{
            "summary":"Done from Q1-plan.txt.",
            "bullets":["Legal review is needed (Q1-plan.txt)."],
            "next_actions":["Share the brief."],
            "preview_markdown":"# Done\\n\\n## Highlights\\n- Legal review is needed (Q1-plan.txt).\\n\\n## Sources used\\n- Q1-plan.txt\\n- Q1-plan.txt — retrieved evidence",
            "metadata":{}
        }'''
        usage = _FakeUsage()
        operation = 'responses.create'

    class _FakeModel:
        def generate_with_usage(self, *, system: str, user: str, history=None):
            assert 'The application will add the final Sources used section automatically.' in system
            return _FakeResponse()

    def _fake_loader(uid, selection, **kwargs):
        docs = [
            WorkflowSourceFile(
                file_id='file-1',
                name='Q1-plan.txt',
                folder_path='contracts',
                content_type='text/plain',
                excerpt='Legal review is needed before launch.',
                full_text_chars=38,
                excerpt_chars=38,
                truncated=False,
            ),
            WorkflowSourceFile(
                file_id='file-1',
                name='Q1-plan.txt — retrieved evidence',
                folder_path='contracts',
                content_type='text/plain',
                excerpt='Launch should wait for review.',
                full_text_chars=30,
                excerpt_chars=30,
                truncated=False,
                source_kind='retrieved',
            )
        ]
        return docs, {
            'selected_files': 1,
            'used_source_files': 1,
            'warnings': [],
            'skipped_source_files': [],
            'truncated_source_files': [],
            'max_source_files': 8,
        }

    monkeypatch.setattr(workflow_registry, 'OpenAIChat', _FakeModel)
    monkeypatch.setattr(workflow_service, '_load_source_documents', _fake_loader)

    create = auth_client.post(
        '/v1/workflows/runs',
        json={
            'workflow_id': 'draft_from_sources',
            'selection': {'file_ids': ['file-1'], 'folder_paths': [], 'current_folder': ''},
            'inputs': {'focus': 'client-ready draft'},
        },
    )
    assert create.status_code == 202, create.text
    result = create.json()['result']

    assert result['metadata']['single_source_workflow'] is True
    assert 'Q1-plan.txt' not in result['summary']
    assert 'Q1-plan.txt' not in result['bullets'][0]
    preview_body = _without_sources_used_section(result['preview_markdown'])
    assert 'Q1-plan.txt' not in preview_body
    assert 'retrieved evidence' not in result['preview_markdown']
    assert 'Sources used' in result['preview_markdown']
    assert result['preview_markdown'].count('Q1-plan.txt') == 1
