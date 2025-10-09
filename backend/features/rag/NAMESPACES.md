# Per-user namespaces (FINAL)

We now use **user-based** namespaces consistently across storage, ingestion, and chat.

- **Firebase Storage:** objects are written under `u:{uid}/uploads/{uuid}/{filename}` and carry metadata
  `owner_uid={uid}`. Listing only returns objects with prefix `u:{uid}/uploads/`.
- **RAG / Pinecone:** the orchestrator already calls `core.namespaces.pinecone_namespace(uid, dataset)`;
  your Pinecone `namespace` therefore looks like `u:{uid}:{dataset}`.
- **Frontend:** the Files and Chat API calls no longer send any tenant header/body. The backend infers the
  user from the authenticated session and uses the user-based namespaces internally.

> IMPORTANT: re-uploading may be required if you previously stored under `t:{tenant}/...`.
