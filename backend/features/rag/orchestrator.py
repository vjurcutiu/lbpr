from __future__ import annotations

import logging
from typing import Dict, List, Tuple, Optional

log = logging.getLogger("rag.orchestrator")

# ... existing imports ...
# from .adapters.pinecone_store import PineconeStore
# from core.config import settings

def query_request(q, uid: str):
    # Existing: build q_dense (OpenAI embed) + q_sparse (BM25/SPLADE) as available
    dataset = q.dataset(uid)  # e.g. u:{uid}:{dataset}
    log.info("query_start", extra={"dataset": str(dataset), "k": q.k, "fusion": "rrf", "alpha": 0.5})

    # Decide/announce search mode
    sparse_flag = getattr(settings, "RAG_SPARSE_ENABLED", True)
    log.info("query_mode", extra={"sparse_enabled": bool(sparse_flag)})

    results = _store.query_hybrid(dataset, q.sparse, q.dense, k=q.k)
    # ... rest unchanged ...
    return results
