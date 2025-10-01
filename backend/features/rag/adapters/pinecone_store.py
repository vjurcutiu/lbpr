from __future__ import annotations
from typing import Dict, List, Tuple, Optional
import os
import logging

log = logging.getLogger("rag.pinecone")

try:
    from pinecone import Pinecone, ServerlessSpec
except Exception as e:  # pragma: no cover
    Pinecone = None
    ServerlessSpec = None
    log.warning("pinecone sdk not available: %s", e)


def _pc():
    if Pinecone is None:
        raise RuntimeError("pinecone sdk not installed. pip install pinecone")
    return Pinecone(api_key=os.getenv("PINECONE_API_KEY"))


class PineconeVectorStore:
    def __init__(self):
        self._index_name = os.getenv("PINECONE_INDEX", "lbpr")
        self._dimension = int(os.getenv("RAG_EMBED_DIM", "512"))
        self._cloud = os.getenv("PINECONE_CLOUD", "aws")
        self._region = os.getenv("PINECONE_REGION", "us-east-1")
        self._index = None
        log.info("pinecone_store_init", extra={"index": self._index_name})

    # ---- index management --------------------------------------------------
    def _ensure_index(self, dimension: int):
        pc = _pc()
        if self._index_name not in [i["name"] for i in pc.list_indexes()]:
            log.info(
                "pinecone_create_index",
                extra={"index": self._index_name, "dim": dimension, "region": self._region},
            )
            pc.create_index(
                name=self._index_name,
                dimension=dimension,
                metric="cosine",
                spec=ServerlessSpec(cloud=self._cloud, region=self._region),
            )
        self._index = pc.Index(self._index_name)

    def _index_handle(self):
        if self._index is None:
            self._ensure_index(self._dimension)
        return self._index

    # ---- upsert -----------------------------------------------------------
    def upsert_chunks(self, dataset: str, entries: List[Dict]):
        if not entries:
            return
        idx = self._index_handle()
        ns = dataset
        vectors = []
        for e in entries:
            vec = {
                "id": f"{e['doc_id']}::{e['chunk_id']}",
                "values": e["vector"],
                "metadata": {
                    "doc_id": e["doc_id"],
                    "chunk_id": e["chunk_id"],
                    "text": e["text"],
                    **(e.get("metadata") or {}),
                },
            }
            if e.get("sparse"):
                # Pinecone expects 'sparse_values': {'indices': [...], 'values': [...]}
                vec["sparse_values"] = e["sparse"]
            vectors.append(vec)
        log.info("pinecone_upsert_start", extra={"namespace": ns, "count": len(vectors)})
        idx.upsert(vectors=vectors, namespace=ns)
        log.info("pinecone_upsert_done", extra={"namespace": ns, "count": len(vectors)})

    # ---- query helpers ----------------------------------------------------
    def _to_hits(self, res) -> List[Tuple[float, Dict]]:
        out: List[Tuple[float, Dict]] = []
        for m in res.get("matches", []) or []:
            md = m.get("metadata", {}) or {}
            out.append(
                (
                    float(m.get("score", 0.0)),
                    {
                        "chunk_id": md.get("chunk_id"),
                        "doc_id": md.get("doc_id"),
                        "text": md.get("text", ""),
                        "metadata": {
                            k: v for k, v in md.items() if k not in ("chunk_id", "doc_id", "text")
                        },
                        "vector": None,
                    },
                )
            )
        out.sort(key=lambda t: t[0], reverse=True)
        return out

    def query_dense(self, dataset: str, q_dense: List[float], k: int = 5):
        idx = self._index_handle()
        res = idx.query(vector=q_dense, top_k=k, include_metadata=True, namespace=str(dataset))
        return self._to_hits(res)

    def query_sparse(self, dataset: str, q_sparse: Dict, k: int = 5):
        idx = self._index_handle()
        res = idx.query(sparse_vector=q_sparse, top_k=k, include_metadata=True, namespace=str(dataset))
        return self._to_hits(res)

    def query_hybrid(
        self,
        dataset: str,
        q_dense: List[float],
        q_sparse: Dict,
        k: int = 5,
        fusion: str = "rrf",
        alpha: float = 0.5,
    ):
        idx = self._index_handle()

        if fusion == "alpha":
            # Single-call hybrid with convex scaling (recommended when you want strict weighting).
            # If you want *external* scaling (pinecone_text.hybrid), do it in caller; here we send both vectors.
            res = idx.query(
                vector=q_dense,
                sparse_vector=q_sparse,
                top_k=k,
                include_metadata=True,
                namespace=str(dataset),
            )
            return self._to_hits(res)

        # Default: two queries + RRF fusion (robust, simple, dependency-free).
        topd = self.query_dense(dataset, q_dense, k=max(k, 20))
        tops = self.query_sparse(dataset, q_sparse, k=max(k, 20))
        dense_ids = [f"{e['doc_id']}::{e['chunk_id']}" for _, e in topd]
        sparse_ids = [f"{e['doc_id']}::{e['chunk_id']}" for _, e in tops]

        def rrf(ids_a, ids_b, k_out, k_rrf=60):
            ranks = {}
            for r, id_ in enumerate(ids_a, 1):
                ranks[id_] = ranks.get(id_, 0.0) + 1.0 / (k_rrf + r)
            for r, id_ in enumerate(ids_b, 1):
                ranks[id_] = ranks.get(id_, 0.0) + 1.0 / (k_rrf + r)
            return sorted(ranks.items(), key=lambda t: t[1], reverse=True)[:k_out]

        fused = rrf(dense_ids, sparse_ids, k)
        id2e = {f"{e['doc_id']}::{e['chunk_id']}": e for _, e in (topd + tops)}
        return [(score, id2e[i]) for i, score in fused]
