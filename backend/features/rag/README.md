
# RAG Happy Path (MVP)

This slice provides a minimal, dependency-light RAG flow to unblock frontend integration and end-to-end testing.

## What it includes

- **Chunker**: simple word-count chunker with overlap.
- **Embedder**: hashing-based character trigram embedder (768-dim) with L2 normalization (no external deps).
- **Vector Store**: in-memory store with cosine similarity.
- **Orchestrator**: ingest & query pipeline; naive answer composer (no LLM yet).
- **FastAPI Router**: mounts under `/features/rag`

## Endpoints

- `POST /features/rag/ingest`
  ```json
  { "dataset": "demo", "text": "Your document text here", "metadata": {} }
  ```

- `POST /features/rag/query`
  ```json
  { "dataset": "demo", "query": "what is this about?", "k": 5 }
  ```

## Integrating into your app

```py
# main.py
from fastapi import FastAPI
from features.rag.router import router as rag_router

def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(rag_router)
    return app

app = create_app()
```

## Next steps

- Swap embedder with a real provider.
- Replace in-memory vector store with Qdrant/pgvector.
- Add streaming + LLM answer generation.
- Add doc/file loaders and storage for real ingestion.
