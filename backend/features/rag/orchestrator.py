from __future__ import annotations
from typing import Dict, List, Optional, Tuple
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
_sparse: Optional[SparseEncoder] = None

FUSION = (os.getenv("RAG_HYBRID_FUSION") or "rrf").lower()
ALPHA = float(os.getenv("RAG_HYBRID_ALPHA") or "0.5")

def _get_sparse() -> Optional[SparseEncoder]:
    global _sparse
    if _sparse is not None:
        return _sparse
    try:
        _sparse = SparseEncoder()
        return _sparse
    except Exception as e:
        log.warning("sparse_encoder_init_failed", extra={"error": str(e)})
        return None

def _ingest_impl(dataset: str, doc_id: str, chunks: List[Dict], meta_base: Dict):
    texts = [c["text"] for c in chunks]
    vectors = embed_texts(texts)
    sparse_list = []
    sparse = _get_sparse()
    if sparse is not None:
        try:
            sparse_list = [sparse.encode_doc(t) for t in texts]
        except Exception as e:
            log.warning("ingest_sparse_failed", extra={"dataset": dataset, "doc_id": doc_id, "error": str(e)})
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
    _store.upsert_chunks(dataset, entries)

def ingest_request(req: IngestRequest, uid: str) -> IngestResponse:
    dataset_ns = pinecone_namespace(uid, req.dataset)
    doc_id = (req.doc_id or f"doc_{uuid.uuid4().hex[:12]}").strip()
    text = req.text or ""
    meta = dict(req.metadata or {})
    meta.setdefault("owner_uid", uid)
    chunks = simple_word_chunker(text) if text else []
    _ingest_impl(dataset_ns, doc_id, chunks, meta)
    return IngestResponse(dataset=dataset_ns, doc_id=doc_id, chunk_ids=[c["chunk_id"] for c in chunks])

def _dedupe_and_filter(results: List[Tuple[float, Dict]], *, k: int, exclude_doc_ids: List[str], per_doc: bool):
    excl = set(exclude_doc_ids or [])
    out: List[Tuple[float, Dict]] = []
    seen_docs = set()
    for score, e in results:
        did = e.get("doc_id", "")
        if did in excl:
            continue
        if per_doc and did in seen_docs:
            continue
        seen_docs.add(did)
        out.append((score, e))
        if len(out) >= k:
            break
    return out

def query_request(req: QueryRequest, uid: str) -> QueryResponse:
    dataset_ns = pinecone_namespace(uid, req.dataset)
    qvec = embed_one(req.query)
    qsparse = {}
    sparse = _get_sparse()
    if sparse is not None:
        try:
            qsparse = sparse.encode_query(req.query)
        except Exception as e:
            log.warning("query_sparse_failed", extra={"dataset": dataset_ns, "error": str(e)})
    filter_dict = {"doc_id": {"$in": [doc_id for doc_id in req.doc_ids if str(doc_id).strip()]}} if req.doc_ids else None
    results: List[Tuple[float, Dict]] = _store.query_hybrid(
        dataset_ns,
        qvec,
        qsparse,
        k=max(req.k, 20),
        fusion=FUSION,
        alpha=ALPHA,
        filter=filter_dict,
    )
    results = _dedupe_and_filter(results, k=req.k, exclude_doc_ids=req.exclude_doc_ids, per_doc=req.per_doc)
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
    answer = "\n\n".join([s.text for s in sources]) or "(no results)"
    return QueryResponse(dataset=dataset_ns, query=req.query, answer=answer, sources=sources)
