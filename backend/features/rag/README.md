
# RAG Happy Path (MVP) — now with Pinecone + OpenAI adapters

This slice now supports **production-grade** providers while preserving the original
in-memory defaults (so local dev & tests still run without any external services).

## Quick start

1) Choose providers via env vars:
   - `RAG_EMBEDDER=openai` to use OpenAI embeddings (else falls back to local hasher)
   - `RAG_VECTORSTORE=pinecone` to use Pinecone (else falls back to in-memory)

2) Required configuration for OpenAI:
   - `OPENAI_API_KEY=...`
   - Optional: `RAG_EMBED_MODEL=text-embedding-3-small` (default) or `text-embedding-3-large`

3) Required configuration for Pinecone:
   - `PINECONE_API_KEY=...`
   - `PINECONE_INDEX=lbpr-rag` (or any name)
   - Optional: `PINECONE_CLOUD=aws` and `PINECONE_REGION=us-east-1`
   - Optional: `RAG_EMBED_DIM=3072` to force a dimension for index creation
     (otherwise we infer it from the first embedding at upsert time).

The API surface under `/features/rag/*` is unchanged.

## Notes

- Index creation is **automatic** on first upsert when using Pinecone. The adapter
  infers the dimension from your embedding vector length and creates a serverless
  cosine index if it doesn't exist yet.
- You can keep using the existing endpoints:
  - `POST /features/rag/ingest`
  - `POST /features/rag/query`
- Tenancy/namespace format stays `t:{tenant}:{dataset}`.

## Local dev (no external services)

Omit the env vars above and you'll get the original hashing embedder and in-memory store.
