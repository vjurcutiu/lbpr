# backend/features/rag/vectorstore.py
from __future__ import annotations
from typing import Dict, List, Tuple, Optional
import os
import logging

log = logging.getLogger("rag.vectorstore")

# ---- Store selector --------------------------------------------------------

def get_store():
    kind = (os.getenv("RAG_VECTORSTORE") or "pinecone").lower()
    if kind == "memory":
        return InMemoryVectorStore()

    # Pinecone variants
    dual = (os.getenv("RAG_HYBRID_DUAL_INDEX") or "0").lower() in ("1", "true", "yes", "y", "on")
    if dual:
        from .adapters.pinecone_dual_store import PineconeDualVectorStore
        log.info("vectorstore_init", extra={"kind": "pinecone_dual"})
        return PineconeDualVectorStore()
    else:
        from .adapters.pinecone_store import PineconeVectorStore
        log.info("vectorstore_init", extra={"kind": "pinecone_single"})
        return PineconeVectorStore()


# ---- In-memory fallback (good for local dev & tests) -----------------------

class InMemoryVectorStore:
    def __init__(self):
        self._data: Dict[str, List[Dict]] = {}
        log.info("vectorstore_init", extra={"kind": "memory"})

    def upsert_chunks(self, dataset: str, entries: List[Dict]):
        log.info("memory_upsert", extra={"dataset": dataset, "entries": len(entries)})
        self._data.setdefault(dataset, [])
        self._data[dataset].extend(entries)

    @staticmethod
    def _cosine(a: List[float], b: List[float]) -> float:
        return sum(x * y for x, y in zip(a, b))

    @staticmethod
    def _sparse_dot(q: Dict, d: Dict) -> float:
        # q,d are {"indices":[...], "values":[...]}
        qi = q.get("indices", [])
        qv = q.get("values", [])
        di = d.get("indices", [])
        dv = d.get("values", [])
        if not qi or not di:
            return 0.0
        dm = {i: v for i, v in zip(di, dv)}
        return sum(v * dm.get(i, 0.0) for i, v in zip(qi, qv))

    def query_dense(self, dataset: str, query_vec: List[float], k: int = 5):
        entries = self._data.get(dataset, [])
        scored = [(self._cosine(query_vec, e["vector"]), e) for e in entries]
        scored.sort(key=lambda t: t[0], reverse=True)
        return scored[:k]

    def query_sparse(self, dataset: str, q_sparse: Dict, k: int = 5):
        entries = self._data.get(dataset, [])
        scored = [(self._sparse_dot(q_sparse, e.get("sparse") or {}), e) for e in entries]
        scored.sort(key=lambda t: t[0], reverse=True)
        return scored[:k]

    @staticmethod
    def _rrf(ids_a: List[str], ids_b: List[str], k_out: int, k_rrf: int = 60):
        ranks: Dict[str, float] = {}
        for r, id_ in enumerate(ids_a, start=1):
            ranks[id_] = ranks.get(id_, 0.0) + 1.0 / (k_rrf + r)
        for r, id_ in enumerate(ids_b, start=1):
            ranks[id_] = ranks.get(id_, 0.0) + 1.0 / (k_rrf + r)
        return sorted(ranks.items(), key=lambda t: t[1], reverse=True)[:k_out]

    def query_hybrid(
        self,
        dataset: str,
        q_dense: List[float],
        q_sparse: Dict,
        k: int = 5,
        fusion: str = "rrf",
        alpha: float = 0.5,
    ):
        topd = self.query_dense(dataset, q_dense, k=max(k, 20))
        tops = self.query_sparse(dataset, q_sparse, k=max(k, 20))
        if fusion == "alpha":
            dense_ids = [f"{e['doc_id']}::{e['chunk_id']}" for _, e in topd]
            sparse_ids = [f"{e['doc_id']}::{e['chunk_id']}" for _, e in tops]
            id2rank_d = {id_: i + 1 for i, id_ in enumerate(dense_ids)}
            id2rank_s = {id_: i + 1 for i, id_ in enumerate(sparse_ids)}
            all_ids = set(dense_ids) | set(sparse_ids)
            fused = []
            for id_ in all_ids:
                rd = id2rank_d.get(id_, 9999)
                rs = id2rank_s.get(id_, 9999)
                score = alpha * (1 / rd) + (1 - alpha) * (1 / rs)
                fused.append((score, id_))
            fused.sort(key=lambda t: t[0], reverse=True)
            id2e = {f"{e['doc_id']}::{e['chunk_id']}": e for _, e in (topd + tops)}
            return [(s, id2e[i]) for s, i in fused[:k]]

        # RRF default
        dense_ids = [f"{e['doc_id']}::{e['chunk_id']}" for _, e in topd]
        sparse_ids = [f"{e['doc_id']}::{e['chunk_id']}" for _, e in tops]
        fused = self._rrf(dense_ids, sparse_ids, k=k)
        id2e = {f"{e['doc_id']}::{e['chunk_id']}": e for _, e in (topd + tops)}
        return [(score, id2e[id_]) for id_, score in fused]
