# RAG Happy Path (MVP) — Pinecone dual-index hybrid (RRF)

This slice now supports **two Pinecone indexes** (dense + sparse) per dataset/namespace and performs hybrid retrieval via **RRF** (or rank-α blending).

## Why dual index?

Recent Pinecone serverless supports two index types: **dense** and **sparse**. Hybrid search can be implemented by
querying each index separately and fusing results (RRF), which avoids single-call constraints and lets you tune each
store independently.

## Configure

Set these env vars (examples):

```bash
RAG_VECTORSTORE=pinecone
RAG_HYBRID_DUAL_INDEX=1

# Base name and explicit index names (optional)
PINECONE_INDEX=lbpr
PINECONE_INDEX_DENSE=lbpr-dense
PINECONE_INDEX_SPARSE=lbpr-sparse

# Cloud/region and embedding size
PINECONE_CLOUD=aws
PINECONE_REGION=us-east-1
RAG_EMBED_DIM=1536
```

> If `RAG_HYBRID_DUAL_INDEX` is unset/false, the code falls back to the single-index adapter with optional
> `sparse_values` stored alongside dense vectors.

## Ingestion flow

1. **Chunk** text (simple word chunker by default).
2. **Embed** dense vectors using the configured embedder (OpenAI or local).
3. **Encode** sparse vectors with `pinecone-text` BM25 (public defaults).
4. **Upsert** each chunk to **both** indexes under the same namespace:
   - Dense index receives `values` + metadata.
   - Sparse index receives `sparse_values` + metadata.

## Query flow

- Compute a dense query vector and a sparse query vector.
- Query **dense** index and **sparse** index independently.
- Fuse with **RRF** (default) or **alpha** (rank-based convex blend).

No API changes are required. The existing `/features/rag/ingest` and `/features/rag/query` endpoints now route through the dual-index store when enabled.
