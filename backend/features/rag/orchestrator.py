from __future__ import annotations
from typing import Dict, List, Tuple
import os
import logging
import uuid

from .embedder import embed_texts, embed_one
from .sparse import SparseEncoder
from .vectorstore import get_store
from .chunker import simple_word_chunker
from .schemas import IngestRequest, IngestResponse, QueryRequest, QueryResponse, Source
from core.namespaces import pinecone_namespace

log = logging.getLogger("rag.orchestrator")

_store = get_store()
_sparse = SparseEncoder()

# Read toggle from env:
FUSION = (os.getenv("RAG_HYBRID_FUSION") or "rrf").lower()
ALPHA = float(os.getenv("RAG_HYBRID_ALPHA") or "0.5")


def _ingest_impl(dataset: str, doc_id: str, chunks: List[Dict], meta_base: Dict):
    """Low-level ingest: takes prepared chunks with 'text' and precomputed vectors."""
    texts = [c["text"] for c in chunks]
    log.info("ingest_embed_start", dataset=dataset, doc_id=doc_id, chunks=len(chunks))

    vectors = embed_texts(texts)
    dim = len(vectors[0]) if vectors else 0
    log.info("ingest_vectors_ready", dataset=dataset, doc_id=doc_id, dim=dim, chunks=len(chunks))

    sparse_list = []
    try:
        sparse_list = [_sparse.encode_doc(t) for t in texts]
        log.info("ingest_sparse_ready", dataset=dataset, doc_id=doc_id, chunks=len(sparse_list))
    except Exception as e:
        log.warning("ingest_sparse_failed", dataset=dataset, doc_id=doc_id, error=str(e))

    entries = []
    for c, v, sv in zip(chunks, vectors, sparse_list or [{} for _ in range(len(vectors))]):
        span = c.get("span") or {"start": 0, "end": 0}
        entries.append(
            {
                "chunk_id": c["chunk_id"],
                "doc_id": doc_id,
                "text": c["text"],
                "metadata": {
                    **(meta_base or {}),
                    "span_start": span.get("start", 0),
                    "span_end": span.get("end", 0),
                },
                "vector": v,
                "sparse": sv,
            }
        )

    log.info("ingest_upsert", dataset=dataset, entries=len(entries))
    _store.upsert_chunks(dataset, entries)


def ingest_request(req: IngestRequest, uid: str) -> IngestResponse:
    """High-level ingest that applies per-user namespace and chunking."""
    dataset_ns = pinecone_namespace(uid, req.dataset)
    doc_id = (req.doc_id or f"doc_{uuid.uuid4().hex[:12]}").strip()
    text = req.text or ""
    meta = dict(req.metadata or {})
    meta.setdefault("owner_uid", uid)

    log.info("ingest_start", dataset=req.dataset, dataset_ns=dataset_ns, uid=uid, text_chars=len(text), meta_keys=list(meta.keys()))

    chunks = simple_word_chunker(text) if text else []
    log.info("ingest_chunked", dataset=dataset_ns, doc_id=doc_id, chunks=len(chunks))

    _ingest_impl(dataset_ns, doc_id, chunks, meta)

    return IngestResponse(dataset=dataset_ns, doc_id=doc_id, chunk_ids=[c["chunk_id"] for c in chunks])


def query_request(req: QueryRequest, uid: str) -> QueryResponse:
    """High-level query that applies per-user namespace and hybrid search."""
    dataset_ns = pinecone_namespace(uid, req.dataset)

    qvec = embed_one(req.query)
    qsparse = {}
    try:
        qsparse = _sparse.encode_query(req.query)
    except Exception as e:
        log.warning("query_sparse_failed", dataset=dataset_ns, error=str(e))

    log.info("query_start", dataset=dataset_ns, k=req.k, fusion=FUSION, alpha=ALPHA)

    results: List[Tuple[float, Dict]] = _store.query_hybrid(
        dataset_ns, qvec, qsparse, k=req.k, fusion=FUSION, alpha=ALPHA
    )

    log.info("query_done", dataset=dataset_ns, found=len(results))

    sources: List[Source] = []
    if req.with_sources:
        for score, e in results:
            sources.append(
                Source(
                    doc_id=e.get("doc_id", ""),
                    chunk_id=e.get("chunk_id", ""),
                    score=float(score),
                    text=e.get("text", ""),
                    metadata=e.get("metadata", {}) or {},
                )
            )

    # NOTE: answer generation left simple (you can wire LLM here if desired)
    answer = "\n\n".join([s.text for s in sources]) or "(no results)"

    return QueryResponse(dataset=dataset_ns, query=req.query, answer=answer, sources=sources)
