# backend/features/rag/adapters/pinecone_dual_store.py
from __future__ import annotations
from typing import Dict, List, Tuple, Optional
import os
import sys
import logging
import platform
import importlib.util
import time

from core.business_metrics import record_pinecone_duration

log = logging.getLogger("rag.pinecone.dual")

# We detect/install details via a helper so we can log *why* import failed.
def _import_pinecone():
    """
    Import Pinecone with rich diagnostics.

    Returns:
        (Pinecone, ServerlessSpec, PineconeApiException, version_str)
    Raises:
        RuntimeError with the original exception chained.
    """
    # Try modern SDK first
    try:
        from pinecone import Pinecone, ServerlessSpec
        try:
            # >=6.x/7.x
            from pinecone.core.client.exceptions import PineconeApiException  # type: ignore
        except Exception:
            # Older fallback path used by some pins
            try:
                from pinecone.exceptions.exceptions import PineconeApiException  # type: ignore
            except Exception:
                PineconeApiException = Exception  # type: ignore

        try:
            import importlib.metadata as md
            ver = md.version("pinecone")
        except Exception:
            ver = "unknown"

        # Success path
        log.info("pinecone_import_ok", pinecone_version=ver)
        return Pinecone, ServerlessSpec, PineconeApiException, ver

    except Exception as e:
        # Gather diagnostics to surface the *real* reason
        find = importlib.util.find_spec("pinecone")
        try:
            import importlib.metadata as md
            installed_version = md.version("pinecone")
        except Exception:
            installed_version = None

        # Keep the dict flat (our logger prints kwargs)
        log.error(
            "pinecone_import_failed",
            error_type=type(e).__name__,
            error_msg=str(e),
            python_version=sys.version.split()[0],
            platform=platform.platform(),
            pinecone_find_spec=bool(find),
            pinecone_spec_origin=(getattr(find, "origin", None) if find else None),
            installed_pinecone_version=installed_version,
            sys_path_head=str(sys.path[:5]),
            env_PINECONE_API_KEY_present=bool(os.getenv("PINECONE_API_KEY")),
            env_PINECONE_ENV_present=bool(os.getenv("PINECONE_ENVIRONMENT")) or bool(os.getenv("PINECONE_ENV")),
            env_PINECONE_INDEX=os.getenv("PINECONE_INDEX"),
            env_PINECONE_INDEX_dense=os.getenv("PINECONE_INDEX_DENSE"),
            env_PINECONE_INDEX_sparse=os.getenv("PINECONE_INDEX_SPARSE"),
            container_image=os.getenv("IMAGE_TAG") or os.getenv("HOSTNAME"),
            exc_info=True,
        )
        raise RuntimeError(
            "Failed to import Pinecone SDK. See `pinecone_import_failed` log for diagnostics. "
            "If missing, install with: pip install 'pinecone>=7' 'pinecone-text'"
        ) from e


# Lazily resolved symbols (let import fail loudly with diagnostics)
Pinecone = None
ServerlessSpec = None
PineconeApiException = Exception  # type: ignore
_PINECONE_VERSION = "unknown"

def _pc():
    global Pinecone, ServerlessSpec, PineconeApiException, _PINECONE_VERSION
    if Pinecone is None or ServerlessSpec is None:
        Pinecone, ServerlessSpec, PineconeApiException, _PINECONE_VERSION = _import_pinecone()
    # Build client
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        # Make this explicit too
        log.error("pinecone_missing_api_key")
        raise RuntimeError("PINECONE_API_KEY is not set")
    return Pinecone(api_key=api_key)


class PineconeDualVectorStore:
    """
    Maintain *two* serverless indexes:
      - DENSE index for semantic vectors
      - SPARSE index for BM25/SPLADE sparse vectors

    Upserts go to both indexes; queries run against each separately and are fused in-process
    via RRF or rank-alpha (convex) blending.

    Env vars:
      PINECONE_INDEX               # base name (optional)
      PINECONE_INDEX_DENSE         # explicit dense index name (default: {PINECONE_INDEX or 'lbpr'}-dense)
      PINECONE_INDEX_SPARSE        # explicit sparse index name (default: {PINECONE_INDEX or 'lbpr'}-sparse)
      PINECONE_CLOUD               # 'aws' (default)
      PINECONE_REGION              # 'us-east-1' (default)
      RAG_EMBED_DIM                # dense vector dim hint (validated at runtime)
    """

    def __init__(self):
        base = os.getenv("PINECONE_INDEX", "lbpr")
        self._dense_name = os.getenv("PINECONE_INDEX_DENSE", f"{base}-dense")
        self._sparse_name = os.getenv("PINECONE_INDEX_SPARSE", f"{base}-sparse")
        self._dimension = int(os.getenv("RAG_EMBED_DIM", "1536"))
        self._cloud = os.getenv("PINECONE_CLOUD", "aws")
        self._region = os.getenv("PINECONE_REGION", "us-east-1")
        self._dense = None
        self._sparse = None
        log.info(
            "pinecone_dual_store_init",
            dense_index=self._dense_name,
            sparse_index=self._sparse_name,
            dim_hint=self._dimension,
            cloud=self._cloud,
            region=self._region,
        )

    # ---- index management --------------------------------------------------
    def _ensure_dense(self, required_dim: int):
        pc = _pc()
        try:
            names = [i["name"] for i in pc.list_indexes()]
        except Exception as e:
            log.error("pinecone_list_indexes_error", error=str(e), exc_info=True)
            names = []

        if self._dense_name not in names:
            dim = required_dim or self._dimension or 1536
            log.info(
                "pinecone_create_dense",
                name=self._dense_name,
                dim=dim,
                region=self._region,
                cloud=self._cloud,
                pinecone_version=_PINECONE_VERSION,
            )
            pc.create_index(
                name=self._dense_name,
                dimension=dim,
                metric="cosine",
                spec=ServerlessSpec(cloud=self._cloud, region=self._region),
                vector_type="dense",
            )
        self._dense = pc.Index(self._dense_name)

        # Best-effort validation (describe_index_stats availability varies)
        try:
            stats = self._dense.describe_index_stats()
            idx_dim = int(stats.get("dimension") or 0)
            if required_dim and idx_dim and idx_dim != required_dim:
                raise ValueError(
                    f"Dense index '{self._dense_name}' dim={idx_dim} does not match embedding size {required_dim}. "
                    "Create an index with the correct dimension or set RAG_EMBED_DIM."
                )
        except Exception as e:
            log.warning("pinecone_dense_stats_failed", index=self._dense_name, error=str(e))

    def _ensure_sparse(self):
        pc = _pc()
        try:
            names = [i["name"] for i in pc.list_indexes()]
        except Exception as e:
            log.error("pinecone_list_indexes_error", error=str(e), exc_info=True)
            names = []

        if self._sparse_name not in names:
            log.info(
                "pinecone_create_sparse",
                name=self._sparse_name,
                region=self._region,
                cloud=self._cloud,
                pinecone_version=_PINECONE_VERSION,
            )
            # Sparse indexes omit 'dimension' and require metric='dotproduct'
            pc.create_index(
                name=self._sparse_name,
                metric="dotproduct",
                spec=ServerlessSpec(cloud=self._cloud, region=self._region),
                vector_type="sparse",
            )
        self._sparse = pc.Index(self._sparse_name)

    def _dense_idx(self, required_dim: Optional[int] = None):
        if self._dense is None:
            self._ensure_dense(required_dim or self._dimension)
        return self._dense

    def _sparse_idx(self):
        if self._sparse is None:
            self._ensure_sparse()
        return self._sparse

    # ---- upsert -----------------------------------------------------------
    def upsert_chunks(self, dataset: str, entries: List[Dict]):
        if not entries:
            return

        # Determine vector dimension from first entry (for dense index validation)
        first_vec = entries[0].get("vector") or []
        vec_dim = len(first_vec) if isinstance(first_vec, (list, tuple)) else 0
        if vec_dim <= 0:
            raise ValueError("Attempted to upsert without dense vectors")

        didx = self._dense_idx(required_dim=vec_dim)
        sidx = self._sparse_idx()
        ns = str(dataset)

        dense_vectors = []
        sparse_vectors = []

        for e in entries:
            # common metadata
            md = {
                "doc_id": e["doc_id"],
                "chunk_id": e["chunk_id"],
                "text": e["text"],
                **(e.get("metadata") or {}),
            }
            # dense payload (no sparse_values in dense index)
            dense_vectors.append({
                "id": f"{e['doc_id']}::{e['chunk_id']}",
                "values": e["vector"],
                "metadata": md,
            })
            # sparse payload (no 'values' in sparse index)
            if e.get("sparse"):
                sparse_vectors.append({
                    "id": f"{e['doc_id']}::{e['chunk_id']}",
                    "sparse_values": e["sparse"],
                    "metadata": md,
                })

        log.info(
            "pinecone_upsert_begin",
            dataset=ns,
            dense_count=len(dense_vectors),
            sparse_count=len(sparse_vectors),
            dense_index=self._dense_name,
            sparse_index=self._sparse_name,
        )

        # Upsert to both indexes
        op_t0 = time.perf_counter()
        try:
            didx.upsert(vectors=dense_vectors, namespace=ns)
            if sparse_vectors:
                sidx.upsert(vectors=sparse_vectors, namespace=ns)
            record_pinecone_duration(operation="upsert", dur_ms=(time.perf_counter() - op_t0) * 1000, status="ok")
        except Exception:
            record_pinecone_duration(operation="upsert", dur_ms=(time.perf_counter() - op_t0) * 1000, status="error")
            raise

        log.info(
            "pinecone_upsert_ok",
            dataset=ns,
            dense_count=len(dense_vectors),
            sparse_count=len(sparse_vectors),
        )

    # ---- result conversion ------------------------------------------------
    @staticmethod
    def _to_hits(res) -> List[Tuple[float, Dict]]:
        out: List[Tuple[float, Dict]] = []
        for m in (res.get("matches") or []):
            md = m.get("metadata", {}) or {}
            out.append(
                (
                    float(m.get("score", 0.0)),
                    {
                        "chunk_id": md.get("chunk_id"),
                        "doc_id": md.get("doc_id"),
                        "text": md.get("text", ""),
                        "metadata": {k: v for k, v in md.items() if k not in ("chunk_id", "doc_id", "text")},
                        "vector": None,
                    },
                )
            )
        out.sort(key=lambda t: t[0], reverse=True)
        return out

    # ---- queries ----------------------------------------------------------
    def query_dense(self, dataset: str, q_dense: List[float], k: int = 5):
        didx = self._dense_idx(required_dim=len(q_dense or []))
        log.debug("pinecone_query_dense", index=self._dense_name, k=k, namespace=str(dataset))
        op_t0 = time.perf_counter()
        try:
            res = didx.query(vector=q_dense, top_k=k, include_metadata=True, namespace=str(dataset))
            record_pinecone_duration(operation="query_dense", dur_ms=(time.perf_counter() - op_t0) * 1000, status="ok")
            return self._to_hits(res)
        except Exception:
            record_pinecone_duration(operation="query_dense", dur_ms=(time.perf_counter() - op_t0) * 1000, status="error")
            raise

    def query_sparse(self, dataset: str, q_sparse: Dict, k: int = 5):
        sidx = self._sparse_idx()
        log.debug("pinecone_query_sparse", index=self._sparse_name, k=k, namespace=str(dataset))
        op_t0 = time.perf_counter()
        try:
            res = sidx.query(sparse_vector=q_sparse, top_k=k, include_metadata=True, namespace=str(dataset))
            record_pinecone_duration(operation="query_sparse", dur_ms=(time.perf_counter() - op_t0) * 1000, status="ok")
            return self._to_hits(res)
        except PineconeApiException as e:
            record_pinecone_duration(operation="query_sparse", dur_ms=(time.perf_counter() - op_t0) * 1000, status="error")
            log.warning("pinecone_sparse_query_error", error=str(e))
            return []
        except Exception:
            record_pinecone_duration(operation="query_sparse", dur_ms=(time.perf_counter() - op_t0) * 1000, status="error")
            raise

    # ---- hybrid (two calls + fusion) -------------------------------------
    def query_hybrid(
        self,
        dataset: str,
        q_dense: List[float],
        q_sparse: Dict,
        k: int = 5,
        fusion: str = "rrf",
        alpha: float = 0.5,
    ):
        op_t0 = time.perf_counter()
        try:
            topd = self.query_dense(dataset, q_dense, k=max(k, 20))
            tops = self.query_sparse(dataset, q_sparse, k=max(k, 20))

            if fusion == "alpha":
                # Rank-based convex blend (since we can't single-call across indexes)
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
                record_pinecone_duration(operation="query_hybrid", dur_ms=(time.perf_counter() - op_t0) * 1000, status="ok")
                return [(s, id2e[i]) for s, i in fused[:k]]

            # Default: Reciprocal Rank Fusion
            def rrf(ids_a, ids_b, k_out, k_rrf=60):
                ranks = {}
                for r, id_ in enumerate(ids_a, 1):
                    ranks[id_] = ranks.get(id_, 0.0) + 1.0 / (k_rrf + r)
                for r, id_ in enumerate(ids_b, 1):
                    ranks[id_] = ranks.get(id_, 0.0) + 1.0 / (k_rrf + r)
                return sorted(ranks.items(), key=lambda t: t[1], reverse=True)[:k_out]

            dense_ids = [f"{e['doc_id']}::{e['chunk_id']}" for _, e in topd]
            sparse_ids = [f"{e['doc_id']}::{e['chunk_id']}" for _, e in tops]
            fused = rrf(dense_ids, sparse_ids, k)
            id2e = {f"{e['doc_id']}::{e['chunk_id']}": e for _, e in (topd + tops)}
            record_pinecone_duration(operation="query_hybrid", dur_ms=(time.perf_counter() - op_t0) * 1000, status="ok")
            return [(score, id2e[i]) for i, score in fused]
        except Exception:
            record_pinecone_duration(operation="query_hybrid", dur_ms=(time.perf_counter() - op_t0) * 1000, status="error")
            raise
