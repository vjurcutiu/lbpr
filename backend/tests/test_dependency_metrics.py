from __future__ import annotations

from types import SimpleNamespace

import pytest

import core.business_metrics as business_metrics
from tests.telemetry_testkit import FakeBusinessInstruments, assert_call


@pytest.fixture()
def fake_business_metrics(monkeypatch):
    fake = FakeBusinessInstruments()
    monkeypatch.setattr(business_metrics, "_INSTRUMENTS", fake)
    yield fake
    monkeypatch.setattr(business_metrics, "_INSTRUMENTS", None)


def test_openai_embedder_records_metrics_on_success(fake_business_metrics, monkeypatch):
    import features.rag.adapters.openai_embedder as openai_embedder

    class FakeEmbeddingsAPI:
        def create(self, **kwargs):
            return SimpleNamespace(data=[SimpleNamespace(embedding=[0.1, 0.2, 0.3])])

    class FakeClient:
        def __init__(self, api_key=None):
            self.embeddings = FakeEmbeddingsAPI()

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(openai_embedder, "OpenAI", FakeClient)

    embedder = openai_embedder.OpenAIEmbedder(model="text-embedding-3-small")
    vecs = embedder.embed_texts(["hello world"])

    assert len(vecs) == 1
    assert_call(fake_business_metrics.openai_call_total.calls, amount=1, operation="embeddings.create", status="ok")
    assert_call(fake_business_metrics.openai_duration_ms.calls, operation="embeddings.create", status="ok")


@pytest.mark.asyncio
async def test_transcription_records_openai_metrics_on_success(fake_business_metrics, monkeypatch):
    import features.transcription.service as service

    class FakeTranscriptionAPI:
        def create(self, **kwargs):
            return {"text": "hello world", "language": "en", "duration": 2.0}

    class FakeClient:
        def __init__(self, api_key=None):
            self.audio = SimpleNamespace(transcriptions=FakeTranscriptionAPI())

    async def noop_phase(*args, **kwargs):
        return None

    async def fake_add_transcribe_seconds(uid: str, seconds: int):
        return True, seconds, 300

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(service, "OpenAI", FakeClient)
    monkeypatch.setattr(service.uptrack, "set_phase", noop_phase)
    monkeypatch.setattr(service, "add_transcribe_seconds", fake_add_transcribe_seconds)

    text, segments, detected, billed_seconds, model = await service.transcribe_bytes(
        uid="u_test",
        job_id="job-1",
        audio_bytes=b"fake wav bytes",
        filename="note.wav",
        content_type="audio/wav",
        language_codes=["en-US"],
        model="gpt-4o-mini-transcribe",
        diarization=False,
    )

    assert text == "hello world"
    assert segments == ["hello world"]
    assert detected == ["en"]
    assert billed_seconds == 2
    assert model == "gpt-4o-mini-transcribe"
    assert_call(fake_business_metrics.openai_call_total.calls, amount=1, operation="audio.transcriptions.create", status="ok")
    assert_call(fake_business_metrics.openai_duration_ms.calls, operation="audio.transcriptions.create", status="ok")


def test_pinecone_store_query_dense_and_sparse_record_metrics(fake_business_metrics):
    import features.rag.adapters.pinecone_store as pinecone_store

    class FakeIndex:
        def query(self, **kwargs):
            return {
                "matches": [
                    {
                        "score": 0.99,
                        "metadata": {
                            "doc_id": "doc-1",
                            "chunk_id": "chunk-1",
                            "text": "hello",
                            "title": "Doc",
                        },
                    }
                ]
            }

    store = pinecone_store.PineconeVectorStore.__new__(pinecone_store.PineconeVectorStore)
    store._index_handle = lambda required_dim=None: FakeIndex()

    dense_hits = store.query_dense("dataset", [0.1, 0.2, 0.3], k=3)
    sparse_hits = store.query_sparse("dataset", {"indices": [1], "values": [0.8]}, k=3)

    assert dense_hits
    assert sparse_hits
    assert_call(fake_business_metrics.pinecone_operation_total.calls, amount=1, operation="query_dense", status="ok")
    assert_call(fake_business_metrics.pinecone_duration_ms.calls, operation="query_dense", status="ok")
    assert_call(fake_business_metrics.pinecone_operation_total.calls, amount=1, operation="query_sparse", status="ok")
    assert_call(fake_business_metrics.pinecone_duration_ms.calls, operation="query_sparse", status="ok")


def test_pinecone_dual_store_sparse_error_records_metric(fake_business_metrics, monkeypatch):
    import features.rag.adapters.pinecone_dual_store as dual_store

    class FakeSparseError(Exception):
        pass

    class FakeSparseIndex:
        def query(self, **kwargs):
            raise FakeSparseError("sparse index temporarily unavailable")

    store = dual_store.PineconeDualVectorStore.__new__(dual_store.PineconeDualVectorStore)
    store._dense_name = "lbpr-dense"
    store._sparse_name = "lbpr-sparse"
    store._sparse_idx = lambda: FakeSparseIndex()
    monkeypatch.setattr(dual_store, "PineconeApiException", FakeSparseError)

    hits = store.query_sparse("dataset", {"indices": [1], "values": [0.8]}, k=3)

    assert hits == []
    assert_call(fake_business_metrics.pinecone_operation_total.calls, amount=1, operation="query_sparse", status="error")
    assert_call(fake_business_metrics.pinecone_duration_ms.calls, operation="query_sparse", status="error")
