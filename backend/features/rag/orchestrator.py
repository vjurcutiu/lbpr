from __future__ import annotations
from typing import Dict, List
import os
import logging

from .embedder import embed_texts, embed_one  # existing module in your project
from .sparse import SparseEncoder
from .vectorstore import get_store

log = logging.getLogger("rag.orchestrator")

_store = get_store()
_sparse = SparseEncoder()

# Read toggle from env:
#   RAG_HYBRID_FUSION = "rrf" | "alpha"
#   RAG_HYBRID_ALPHA  = float in [0,1]
FUSION = (os.getenv("RAG_HYBRID_FUSION") or "rrf").lower()
ALPHA = float(os.getenv("RAG_HYBRID_ALPHA") or "0.5")


def ingest(dataset: str, doc_id: str, chunks: List[Dict], meta_base: Dict):
    """
    `chunks`: list of {"chunk_id", "text", "span": {"start":int, "end":int}}
    """
    texts = [c["text"] for c in chunks]
    vectors = embed_texts(texts)
    sparse_list = [_sparse.encode_doc(t) for t in texts]

    entries = []
    for c, v, sv in zip(chunks, vectors, sparse_list):
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

    log.info("ingest_upsert", extra={"dataset": dataset, "entries": len(entries)})
    _store.upsert_chunks(dataset, entries)


def query(dataset: str, query_text: str, k: int = 5):
    qvec = embed_one(query_text)
    qsparse = _sparse.encode_query(query_text)

    log.info(
        "query_start",
        extra={"dataset": dataset, "k": k, "fusion": FUSION, "alpha": ALPHA},
    )

    results = _store.query_hybrid(
        dataset, qvec, qsparse, k=k, fusion=FUSION, alpha=ALPHA
    )

    log.info("query_done", extra={"dataset": dataset, "found": len(results)})
    return results
