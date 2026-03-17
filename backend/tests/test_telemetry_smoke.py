from __future__ import annotations

from datetime import datetime, timezone
import pytest
import core.business_metrics as business_metrics
from core.rate_limit import add_message, add_upload_tokens
from features.rag.schemas import IngestResponse, QueryResponse, Source
from tests.telemetry_testkit import FakeBusinessInstruments, assert_call


@pytest.fixture()
def fake_business_metrics(monkeypatch):
    fake = FakeBusinessInstruments()
    monkeypatch.setattr(business_metrics, "_INSTRUMENTS", fake)
    yield fake
    monkeypatch.setattr(business_metrics, "_INSTRUMENTS", None)


@pytest.fixture()
def auth_client(client):
    resp = client.post("/auth/session", json={"id_token": "good-token"})
    assert resp.status_code == 200
    return client


def test_auth_session_metrics_success_and_error(client, fake_business_metrics):
    ok = client.post("/auth/session", json={"id_token": "good-token"})
    assert ok.status_code == 200
    bad = client.post("/auth/session", json={"id_token": "bad"})
    assert bad.status_code == 401

    assert_call(fake_business_metrics.auth_session_success_total.calls, amount=1, method="id_token")
    assert_call(
        fake_business_metrics.auth_session_error_total.calls,
        amount=1,
        method="id_token",
        reason="invalid_id_token",
    )


def test_query_success_emits_chat_metrics(auth_client, fake_business_metrics, monkeypatch):
    import features.rag.router as rag_router

    async def fake_sync_caps_and_plan(uid: str):
        return None

    async def fake_add_message(uid: str):
        return True, 1, 10

    def fake_query_request(req, uid: str):
        return QueryResponse(
            dataset=req.dataset,
            query=req.query,
            answer="ok",
            sources=[
                Source(
                    doc_id="doc-1",
                    chunk_id="chunk-1",
                    score=0.99,
                    text="hello",
                    metadata={"title": "Doc"},
                )
            ],
        )

    monkeypatch.setattr(rag_router, "sync_caps_and_plan", fake_sync_caps_and_plan)
    monkeypatch.setattr(rag_router, "add_message", fake_add_message)
    monkeypatch.setattr(rag_router.orchestrator, "query_request", fake_query_request)

    resp = auth_client.post(
        "/features/rag/query",
        json={"dataset": "default", "query": "hello", "with_sources": True, "k": 5},
    )
    assert resp.status_code == 200, resp.text

    assert_call(fake_business_metrics.chat_started_total.calls, amount=1, flow="query")
    assert_call(fake_business_metrics.chat_completed_total.calls, amount=1, flow="query", with_sources="true")
    assert_call(fake_business_metrics.chat_duration_ms.calls, flow="query", status="ok")


def test_ingest_limit_emits_error_metrics(auth_client, fake_business_metrics, monkeypatch):
    import features.rag.router as rag_router

    async def fake_sync_caps_and_plan(uid: str):
        return None

    async def fake_add_upload_tokens(uid: str, n_tokens: int):
        return False, 100, 100

    monkeypatch.setattr(rag_router, "sync_caps_and_plan", fake_sync_caps_and_plan)
    monkeypatch.setattr(rag_router, "add_upload_tokens", fake_add_upload_tokens)
    monkeypatch.setattr(rag_router, "count_tokens", lambda text: 42)
    monkeypatch.setattr(rag_router, "tokenize_text", lambda uid, text: text)

    resp = auth_client.post(
        "/features/rag/ingest",
        json={"dataset": "default", "text": "hello world", "metadata": {}},
    )
    assert resp.status_code == 429, resp.text

    assert_call(fake_business_metrics.ingest_started_total.calls, amount=1, flow="api")
    assert_call(fake_business_metrics.ingest_error_total.calls, amount=1, flow="api", stage="limit")
    assert_call(fake_business_metrics.ingest_duration_ms.calls, flow="api", status="error")
    assert fake_business_metrics.ingest_completed_total.calls == []


def test_upload_success_emits_upload_and_ingest_metrics(auth_client, fake_business_metrics, monkeypatch):
    import features.files.service as files_service

    class FakeBlob:
        def __init__(self, name: str):
            self.name = name
            self.metadata = {}
            self.size = 0
            self.content_type = ""
            self.time_created = datetime.now(timezone.utc)

        def upload_from_string(self, data: bytes, content_type: str = "application/octet-stream"):
            self.size = len(data)
            self.content_type = content_type

        def reload(self):
            return None

    class FakeBucket:
        def blob(self, name: str):
            return FakeBlob(name)

    async def noop_async(*args, **kwargs):
        return None

    async def fake_add_upload_tokens(uid: str, n_tokens: int):
        return True, n_tokens, 1000

    def fake_ingest_request(req, uid: str):
        return IngestResponse(dataset=req.dataset, doc_id=req.doc_id or "doc-1", chunk_ids=["chunk-1", "chunk-2"])

    monkeypatch.setattr(files_service, "_bucket", lambda: FakeBucket())
    async def fake_extract_text(uid: str, job_id: str, filename: str, content_type: str, data: bytes):
        return "hello world"

    monkeypatch.setattr(files_service, "_extract_text", fake_extract_text)
    monkeypatch.setattr(files_service, "sync_caps_and_plan", noop_async)
    monkeypatch.setattr(files_service, "add_upload_tokens", fake_add_upload_tokens)
    monkeypatch.setattr(files_service, "count_tokens", lambda text: 2)
    monkeypatch.setattr(files_service, "tokenize_text", lambda uid, text: text)
    monkeypatch.setattr(files_service.index_store, "upsert_file", lambda *args, **kwargs: None)
    monkeypatch.setattr(files_service.orchestrator, "ingest_request", fake_ingest_request)
    monkeypatch.setattr(files_service.uptrack, "create_job", noop_async)
    monkeypatch.setattr(files_service.uptrack, "set_phase", noop_async)
    monkeypatch.setattr(files_service.uptrack, "incr_bytes", noop_async)
    monkeypatch.setattr(files_service.uptrack, "mark_error", noop_async)
    monkeypatch.setattr(files_service.uptrack, "mark_done", noop_async)

    resp = auth_client.post(
        "/v1/files?dataset=default",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 202, resp.text

    assert_call(fake_business_metrics.file_upload_started_total.calls, amount=1, flow="upload")
    assert_call(fake_business_metrics.file_upload_completed_total.calls, amount=1, flow="upload")
    assert_call(fake_business_metrics.ingest_started_total.calls, amount=1, flow="upload")
    assert_call(fake_business_metrics.ingest_completed_total.calls, amount=1, flow="upload")
    assert_call(fake_business_metrics.ingest_duration_ms.calls, flow="upload", status="ok")


@pytest.mark.asyncio
async def test_add_message_allowed_records_usage(fake_business_metrics, monkeypatch):
    import core.rate_limit as rate_limit

    async def fake_load_meta(uid: str):
        return {"plan": "pro", "cap_messages": "10", "free_no_refresh": "0", "billing_anchor_ts": "0"}

    async def fake_check_and_add(uid: str, metric: str, inc: int, cap: int, pstart: int, pend: int, period_id: str):
        return True, 3

    monkeypatch.setattr(rate_limit, "_load_meta", fake_load_meta)
    monkeypatch.setattr(rate_limit, "_check_and_add", fake_check_and_add)

    ok, used, cap = await add_message("u_test")
    assert ok is True
    assert used == 3
    assert cap == 10
    assert_call(fake_business_metrics.messages_used_total.calls, amount=1, plan="pro")
    assert fake_business_metrics.plan_limit_hit_total.calls == []


@pytest.mark.asyncio
async def test_add_upload_tokens_limit_records_plan_limit(fake_business_metrics, monkeypatch):
    import core.rate_limit as rate_limit

    async def fake_load_meta(uid: str):
        return {"plan": "free", "cap_upload_tokens": "100", "free_no_refresh": "1", "billing_anchor_ts": "0"}

    async def fake_check_and_add(uid: str, metric: str, inc: int, cap: int, pstart: int, pend: int, period_id: str):
        return False, 100

    monkeypatch.setattr(rate_limit, "_load_meta", fake_load_meta)
    monkeypatch.setattr(rate_limit, "_check_and_add", fake_check_and_add)

    ok, used, cap = await add_upload_tokens("u_test", 25)
    assert ok is False
    assert used == 100
    assert cap == 100
    assert_call(fake_business_metrics.plan_limit_hit_total.calls, amount=1, metric="upload_tokens", plan="free")
    assert fake_business_metrics.upload_tokens_used_total.calls == []
