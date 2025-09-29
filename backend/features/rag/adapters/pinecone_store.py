# Pinecone Vector Store Adapter
# Uses the pinecone SDK (`pip install pinecone-client` or `pinecone`)
# Required env: PINECONE_API_KEY, PINECONE_INDEX. Optional: PINECONE_CLOUD, PINECONE_REGION
# The adapter will auto-create the index if it does not exist, inferring the dimension
# from the first vector you upsert (or via RAG_EMBED_DIM env override).

from __future__ import annotations

import os
import time
from typing import Dict, List, Tuple, Optional

try:
    # Newer SDK import
    from pinecone import Pinecone, ServerlessSpec
except Exception:
    Pinecone = None  # type: ignore
    ServerlessSpec = None  # type: ignore

class PineconeVectorStore:
    def __init__(
        self,
        index_name: Optional[str] = None,
        cloud: Optional[str] = None,
        region: Optional[str] = None,
    ):
        if Pinecone is None:
            raise RuntimeError("Pinecone SDK not installed. Install `pinecone-client>=4` or `pinecone`.")
        api_key = os.getenv("PINECONE_API_KEY")
        if not api_key:
            raise RuntimeError("PINECONE_API_KEY is not set")
        self.pc = Pinecone(api_key=api_key)

        self.index_name = index_name or os.getenv("PINECONE_INDEX") or "lbpr-rag"
        self.cloud = cloud or os.getenv("PINECONE_CLOUD") or "aws"
        self.region = region or os.getenv("PINECONE_REGION") or "us-east-1"

        # lazily bound index handle (created on demand)
        self._index = None

    # ---------- internal helpers ----------
    def _ensure_index(self, dimension: int):
        # create if missing
        existing = {i["name"] for i in self.pc.list_indexes()}
        if self.index_name not in existing:
            if ServerlessSpec is None:
                raise RuntimeError("ServerlessSpec missing from pinecone SDK; please upgrade pinecone-client.")
            self.pc.create_index(
                name=self.index_name,
                dimension=dimension,
                metric="cosine",
                spec=ServerlessSpec(cloud=self.cloud, region=self.region),
            )
            # wait until ready
            for _ in range(60):
                desc = self.pc.describe_index(self.index_name)
                if desc.get("status", {}).get("ready"):
                    break
                time.sleep(2)
        # bind
        self._index = self.pc.Index(self.index_name)

    def _index_handle(self):
        if self._index is None:
            # Attempt to bind; if index doesn't exist, user must upsert first to create with inferred dim
            try:
                self._index = self.pc.Index(self.index_name)
            except Exception:
                self._index = None
        return self._index

    # ---------- public API mirrored to InMemoryVectorStore ----------
    def upsert_chunks(self, dataset: str, entries: List[Dict]):
        # Entries contain: {chunk_id, doc_id, vector, text, metadata}
        if not entries:
            return
        # Infer dim
        dim = int(os.getenv("RAG_EMBED_DIM") or len(entries[0]["vector"]))
        if self._index is None:
            # Ensure index exists with the correct dim
            self._ensure_index(dimension=dim)

        vectors = []
        ns = dataset  # dataset already includes tenant prefix
        for e in entries:
            vectors.append({
                "id": f"{e['doc_id']}::{e['chunk_id']}",
                "values": e["vector"],
                "metadata": {
                    "doc_id": e["doc_id"],
                    "chunk_id": e["chunk_id"],
                    "text": e["text"],
                    **(e.get("metadata") or {}),
                },
            })
        # pinecone upsert supports batch list
        self._index.upsert(vectors=vectors, namespace=ns)

    def query(self, dataset: str, query_vec: List[float], k: int = 5) -> List[Tuple[float, Dict]]:
        idx = self._index_handle()
        if idx is None:
            return []  # nothing indexed yet
        res = idx.query(vector=query_vec, top_k=k, include_metadata=True, namespace=dataset)
        out: List[Tuple[float, Dict]] = []
        for m in res.get("matches", []):
            md = m.get("metadata", {}) or {}
            out.append((float(m.get("score", 0.0)), {
                "chunk_id": md.get("chunk_id"),
                "doc_id": md.get("doc_id"),
                "text": md.get("text", ""),
                "metadata": {k:v for k,v in md.items() if k not in ("chunk_id","doc_id","text")},
                "vector": None,  # omitted
            }))
        # sort by score desc to align with in-memory store behavior
        out.sort(key=lambda t: t[0], reverse=True)
        return out
