# RAG conversation-aware retrieval

## 2025-10-20 – Update: remove auto-exclusion
- Removed automatic exclusion of the most recently surfaced document from the `/v1/chat` flow.
- Kept **per-document diversification** (one chunk per doc) so users still get varied sources without suppressing any specific doc.
- Kept `exclude_doc_ids` field on `QueryRequest` for API compatibility; client code may set it explicitly if desired.
- Kept query rewrite and prompt hardening.

## 2025-10-20 – Initial
- Added `exclude_doc_ids` and `per_doc` to `QueryRequest`.
- Orchestrator post-processing to drop excluded docs and enforce one-chunk-per-doc.
- Optional Redis memory to record recently returned doc IDs (not used for exclusion anymore).
- Clear QUESTION vs CONTEXT prompting and inline [n] citations only when context is used.
