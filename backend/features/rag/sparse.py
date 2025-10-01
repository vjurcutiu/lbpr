from __future__ import annotations
from typing import Dict, Any, Tuple, List, Optional
import logging

log = logging.getLogger("rag.sparse")

try:
    # pinecone-text public preview (actively maintained)
    from pinecone_text.sparse import BM25Encoder
    from pinecone_text.hybrid import hybrid_convex_scale
except Exception as e:  # pragma: no cover
    BM25Encoder = None
    hybrid_convex_scale = None
    log.warning("pinecone-text not available: %s", e)


class SparseEncoder:
    """
    Thin wrapper around pinecone-text BM25.
    Uses MS MARCO–tuned defaults (no corpus fit needed).
    You can later fit per-tenant and persist via dump()/load().
    """

    def __init__(self):
        if BM25Encoder is None:
            raise RuntimeError(
                "pinecone-text not installed. Run: pip install pinecone-text"
            )
        # NOTE: .default() downloads defaults on first use; cache persists.
        self._bm25 = BM25Encoder.default()

    def encode_doc(self, text: str) -> Dict[str, List[float]]:
        """Return sparse vector dict: {'indices':[...], 'values':[...]}"""
        return self._bm25.encode_documents(text)

    def encode_query(self, text: str) -> Dict[str, List[float]]:
        return self._bm25.encode_queries(text)

    @staticmethod
    def scale_for_hybrid(
        dense_vec: List[float],
        sparse_vec: Dict[str, List[float]],
        alpha: float = 0.5,
    ) -> Tuple[List[float], Dict[str, List[float]]]:
        """
        Optional convex scaling for single-call hybrid queries.
        alpha ~ weight on dense (semantic) vs sparse (keyword).
        """
        if hybrid_convex_scale is None:
            return dense_vec, sparse_vec
        return hybrid_convex_scale(dense_vec, sparse_vec, alpha=alpha)
