from __future__ import annotations

import os
import time
import logging
from typing import Dict, List, Tuple, Optional

log = logging.getLogger("rag.pinecone")

try:
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

        self._index = None
        log.info("pinecone_init", index=self.index_name, cloud=self.cloud, region=self.region)

    def _ensure_index(self, dimension: int):
        existing = {i["name"] for i in self.pc.list_indexes()}
        if self.index_name not in existing:
            if ServerlessSpec is None:
                raise RuntimeError("ServerlessSpec missing from pinecone SDK; please upgrade pinecone-client.")
            log.info("pinecone_create_index_start", index=self.index_name, dimension=dimension, metric="cosine", cloud=self.cloud, region=self.region)
            self.pc.create_index(
                name=self.index_name,
                dimension=dimension,
                metric="cosine",
                spec=ServerlessSpec(cloud=self.cloud, region=self.region),
            )
            for _ in range(60):
                desc = self.pc.describe_index(self.index_name)
                ready = bool(desc.get("status", {}).get("ready"))
                log.info("pinecone_index_status", ready=ready)
                if ready:
                    break
                time.sleep(2)
        self._index = self.pc.Index(self.index_name)
        log.info("pinecone_index_bound", index=self.index_name)

    def _index_handle(self):
        if self._index is None:
            try:
                self._index = self.pc.Index(self.index_name)
                log.info("pinecone_index_bound", index=self.index_name)
            except Exception as e:
                log.warning("pinecone_index_unavailable", error=str(e))
                self._index = None
        return self._index

    def upsert_chunks(self, dataset: str, entries: List[Dict]):
        if not entries:
            log.info("pinecone_upsert_skip_empty", namespace=dataset)
            return
        dim = int(os.getenv("RAG_EMBED_DIM") or len(entries[0]["vector"]))
        if self._index is None:
            self._ensure_index(dimension=dim)

        vectors = []
        ns = dataset
        for e in entries:
            # IMPORTANT: only pinecone-serializable metadata (no nested objects)
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
        try:
            log.info("pinecone_upsert_start", namespace=ns, count=len(vectors), dim=dim,
                     first_id=vectors[0]["id"] if vectors else None)
            self._index.upsert(vectors=vectors, namespace=ns)
            log.info("pinecone_upsert_done", namespace=ns, count=len(vectors))
        except Exception:
            log.exception("pinecone_upsert_error", namespace=ns, count=len(vectors))
            raise

    def query(self, dataset: str, query_vec: List[float], k: int = 5) -> List[Tuple[float, Dict]]:
        idx = self._index_handle()
        if idx is None:
            log.info("pinecone_query_empty_index", namespace=dataset)
            return []
        try:
            log.info("pinecone_query_start", namespace=dataset, k=k)
            res = idx.query(vector=query_vec, top_k=k, include_metadata=True, namespace=dataset)
            out: List[Tuple[float, Dict]] = []
            for m in res.get("matches", []):
                md = m.get("metadata", {}) or {}
                out.append((float(m.get("score", 0.0)), {
                    "chunk_id": md.get("chunk_id"),
                    "doc_id": md.get("doc_id"),
                    "text": md.get("text", ""),
                    "metadata": {k:v for k,v in md.items() if k not in ("chunk_id","doc_id","text")},
                    "vector": None,
                }))
            out.sort(key=lambda t: t[0], reverse=True)
            log.info("pinecone_query_done", namespace=dataset, found=len(out))
            return out
        except Exception:
            log.exception("pinecone_query_error", namespace=dataset, k=k)
            raise
