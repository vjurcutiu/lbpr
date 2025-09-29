
# Files Feature (Firebase Storage) — /v1/files

This slice provides the `/v1/files` contract used by the SPA Files page.

## Endpoints

- `GET /v1/files` -> `[FileItem]`
- `POST /v1/files` (multipart/form-data; field `file`) -> `{ job_id }` (202)
- `GET /v1/files/{id}/download` -> 302 redirect to short-lived signed URL
- `DELETE /v1/files/{id}` -> `{ ok: true }`

All endpoints are tenant-aware via the optional `X-Tenant-Id` header (defaults to `demo`).

## Storage

Backed by Firebase Storage (Google Cloud Storage). Bucket is chosen via:

- `FIREBASE_STORAGE_BUCKET` (recommended), or
- fallback to `<FIREBASE_PROJECT_ID>.appspot.com`

Ensure `core/firebase.py` initializes the Firebase Admin app at startup.

## RAG Integration

On upload, for text-like files (text/*, Markdown, JSON, CSV, XML), we inline-extract
text and call the existing RAG ingester:

```python
orchestrator.ingest(IngestRequest(
  dataset="default",
  text=...,
  metadata={"tenant_id": tenant, "source": "upload", "title": filename}
))
```

Unsupported types (PDF, DOCX, etc.) are stored but skipped for indexing.

## Wiring

In `backend/main.py`:

```py
from features.files import router as files_router
app.include_router(files_router)  # router already prefixed with /v1/files
```

In `core/config.py` add:

```py
FIREBASE_STORAGE_BUCKET: str | None = None
```

## Notes

- Max upload size 50 MB (enforced in service).
- `GET /v1/files` composes items from object metadata and blob attributes.
- `download` endpoint returns a 10-minute signed URL via redirect.
