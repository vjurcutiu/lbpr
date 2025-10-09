from __future__ import annotations
from typing import Dict, List, Tuple, Optional
import os
import logging

log = logging.getLogger("rag.pinecone")

try:
    from pinecone import Pinecone, ServerlessSpec
    from pinecone.exceptions.exceptions import PineconeApiException  # type: ignore
except Exception as e:  # pragma: no cover
    Pinecone = None
    ServerlessSpec = None
    PineconeApiException = Exception  # type: ignore
    log.warning("pinecone sdk not available: %s", e)


def _pc():
    if Pinecone is None:
        raise RuntimeError("pinecone sdk not installed. pip install pinecone")
    return Pinecone(api_key=os.getenv("PINECONE_API_KEY"))


class PineconeVectorStore:
    def __init__(self):
        self._index_name = os.getenv("PINECONE_INDEX", "lbpr")
        # NOTE: Treat this as a *hint*. We'll still validate against actual vector dims at upsert time.
        self._dimension = int(os.getenv("RAG_EMBED_DIM", "512"))
        self._cloud = os.getenv("PINECONE_CLOUD", "aws")
        self._region = os.getenv("PINECONE_REGION", "us-east-1")
        self._index = None
        log.info("pinecone_store_init", index=self._index_name, cloud=self._cloud, region=self._region, dim_hint=self._dimension)

    # ---- index management --------------------------------------------------
    def _ensure_index(self, required_dim: int):
        pc = _pc()

        # Create if missing
        names = []
        try:
            names = [i["name"] for i in pc.list_indexes()]
        except Exception as e:
            log.exception("pinecone_list_indexes_error")
        if self._index_name not in names:
            dim_to_use = required_dim or self._dimension
            log.info("pinecone_create_index", index=self._index_name, dim=dim_to_use, region=self._region, cloud=self._cloud, metric="cosine", serverless=True)
            pc.create_index(
                name=self._index_name,
                dimension=dim_to_use,
                metric="cosine",
                spec=ServerlessSpec(cloud=self._cloud, region=self._region),
            )
        self._index = pc.Index(self._index_name)

        # Validate dimension using describe_index_stats (data plane) as it's widely available
        try:
            stats = self._index.describe_index_stats()
            idx_dim = int(stats.get("dimension") or 0)
            log.info("pinecone_index_stats", index=self._index_name, dimension=idx_dim, namespaces=list((stats.get("namespaces") or {}).keys()))
            if required_dim and idx_dim and idx_dim != required_dim:
                # Hard error — this is the #1 cause of silent upsert failures.
                log.error("pinecone_index_dim_mismatch", index=self._index_name, index_dim=idx_dim, embed_dim=required_dim)
                raise ValueError(
                    f"Pinecone index '{self._index_name}' dimension ({idx_dim}) does not match embedding size ({required_dim}). "
                    "Create a new index with the correct dimension or set RAG_EMBED_DIM accordingly."
                )
        except Exception as e:
            # Non-fatal: if stats call fails, proceed but at least log it.
            log.warning("pinecone_describe_index_stats_failed", index=self._index_name, error=str(e))

    def _index_handle(self, required_dim: Optional[int] = None):
        if self._index is None:
            self._ensure_index(required_dim or self._dimension)
        return self._index

    # ---- upsert -----------------------------------------------------------
    def upsert_chunks(self, dataset: str, entries: List[Dict]):
        if not entries:
            return

        # Determine vector dimension from first entry
        first_vec = entries[0].get("vector") or []
        vec_dim = len(first_vec) if isinstance(first_vec, (list, tuple)) else 0
        if vec_dim <= 0:
            log.error("pinecone_upsert_missing_vectors", namespace=dataset, count=len(entries))
            raise ValueError("Attempted to upsert without dense vectors")

        idx = self._index_handle(required_dim=vec_dim)
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
        log.info("pinecone_upsert_start", namespace=ns, count=len(vectors), index=self._index_name, dim=vec_dim)
        try:
            idx.upsert(vectors=vectors, namespace=ns)
            log.info("pinecone_upsert_done", namespace=ns, count=len(vectors))
        except Exception as e:
            # Add a super-detailed error to help diagnose
            ids_preview = [v["id"] for v in vectors[:3]]
            log.exception("pinecone_upsert_error", namespace=ns, index=self._index_name, dim=vec_dim, sample_ids=ids_preview)
            raise

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
        idx = self._index_handle(required_dim=len(q_dense or []))
        res = idx.query(vector=q_dense, top_k=k, include_metadata=True, namespace=str(dataset))
        return self._to_hits(res)

    def query_sparse(self, dataset: str, q_sparse: Dict, k: int = 5):
        idx = self._index_handle()
        try:
            res = idx.query(sparse_vector=q_sparse, top_k=k, include_metadata=True, namespace=str(dataset))
        except PineconeApiException as e:
            # ✅ FIX: gracefully handle dense-only indexes that reject sparse-only queries
            msg = getattr(e, "body", None) or str(e)
            if "Cannot query index with dense 'vector_type' with only sparse vector" in str(msg):
                log.warning(
                    "pinecone_sparse_query_unsupported",
                    namespace=str(dataset),
                    reason="index is dense-only",
                )
                return []
            raise
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
        idx = self._index_handle(required_dim=len(q_dense or []))

        if fusion == "alpha":
            # Single-call hybrid with convex scaling.
            res = idx.query(
                vector=q_dense,
                sparse_vector=q_sparse,
                top_k=k,
                include_metadata=True,
                namespace=str(dataset),
            )
            return self._to_hits(res)

        # Default: two queries + RRF fusion. (Sparse may be unsupported; then it just contributes 0.)
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
