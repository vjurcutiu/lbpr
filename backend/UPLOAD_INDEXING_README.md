
# Upload → Chunk → Embed → Vector Store (Inline)

This integrates the Files feature with the RAG pipeline so that uploads are immediately chunked,
embedded, and stored in the configured vector store.

- Endpoint: `POST /v1/files` (multipart)
  - Params: `file` (UploadFile), optional query param `dataset` (defaults to `default`)
  - Header: `x-tenant-id` to namespace data per tenant
- Storage: Firebase Storage under `t:{tenant}/uploads/{uuid}/{filename}`
- Indexing: best-effort extraction for text/JSON/XML/CSV/MD + PDF (pypdf) + DOCX (python-docx)
  - If extraction succeeds, we call `features.rag.orchestrator.ingest(...)`
  - Chunking via `simple_word_chunker`, embeddings via configured embedder, vector store via dispatcher

## Notes
- PDF and DOCX extraction are optional; if the libraries are missing, upload still succeeds and indexing is skipped.
- Configure providers via env:
  - `RAG_EMBEDDER=local|openai`
  - `RAG_VECTORSTORE=memory|pinecone`
