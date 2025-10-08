from __future__ import annotations

import logging
from typing import List, Dict, Tuple, Optional
from pinecone.exceptions.exceptions import PineconeApiException

log = logging.getLogger("rag.pinecone")

class PineconeStore:
    def __init__(self, index, settings):
        self.index = index
        self.settings = settings
        # use env toggle; default True (hybrid), but will auto-fallback on 400 errors
        self._sparse_enabled = getattr(settings, "RAG_SPARSE_ENABLED", True)

    def _safe_query_sparse(self, dataset: str, q_sparse: Dict, k: int):
        if not self._sparse_enabled:
            log.info("pinecone_sparse_disabled", dataset=dataset, k=k)
            return []
        try:
            res = self.index.query(
                sparse_vector=q_sparse,
                top_k=k,
                include_metadata=True,
                namespace=str(dataset),
            )
            return res.matches or []
        except PineconeApiException as e:
            # Example: {"message":"Cannot query index with dense 'vector_type' with only sparse vector"}
            msg = getattr(e, "body", None) or str(e)
            if "only sparse vector" in msg or "with only sparse vector" in msg:
                log.warning("pinecone_sparse_unsupported", dataset=dataset, error=str(e))
                # Permanently disable further sparse attempts in this process
                self._sparse_enabled = False
                return []
            # Other API errors should still surface
            raise

    def query_sparse(self, dataset: str, q_sparse: Dict, k: int = 20):
        return self._safe_query_sparse(dataset, q_sparse, k)

    def query_dense(self, dataset: str, q_dense: List[float], k: int = 5):
        res = self.index.query(
            vector=q_dense,
            top_k=k,
            include_metadata=True,
            namespace=str(dataset),
        )
        return res.matches or []

    def query_hybrid(self, dataset: str, q_sparse: Optional[Dict], q_dense: Optional[List[float]], k: int = 5):
        # Always try dense; sparse may be disabled/unsupported.
        dense_matches = self.query_dense(dataset, q_dense, k=k) if q_dense is not None else []
        sparse_matches = self.query_sparse(dataset, q_sparse, k=max(k, 20)) if q_sparse is not None else []

        # Reciprocal Rank Fusion when both present, else return whichever exists
        if dense_matches and sparse_matches:
            return self._rrf_merge(dense_matches, sparse_matches, k=k)
        return dense_matches or sparse_matches or []

    @staticmethod
    def _rrf_merge(dense, sparse, k=5, k_rrf: int = 60):
        # Build rank maps
        rank_d = {m.id: i for i, m in enumerate(dense)}
        rank_s = {m.id: i for i, m in enumerate(sparse)}
        ids = set(rank_d) | set(rank_s)
        scored = []
        for _id in ids:
            rd = rank_d.get(_id, 1e9)
            rs = rank_s.get(_id, 1e9)
            score = 1.0 / (k_rrf + rd) + 1.0 / (k_rrf + rs)
            # pick any representative match (prefer dense)
            rep = next((m for m in dense if m.id == _id), None) or next((m for m in sparse if m.id == _id), None)
            scored.append((score, rep))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [m for _, m in scored[:k]]
