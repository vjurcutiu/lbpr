# Per-user namespaces (UPDATED)

- **Pinecone**: queries & upserts use `u:{uid}:{dataset}` via `core.namespaces.pinecone_namespace(uid, dataset)`.
- **Firebase**: files are stored under `core.namespaces.firebase_folder(uid)`, e.g. `users/{uid}/...` or `u:{uid}/...`.
  This patch writes uploads at: `{firebase_folder(uid)}/uploads/{uuid}/{filename}` and sets `owner_uid` metadata.

Make sure the UI queries the RAG endpoints while authenticated so `uid` matches between upload and query.
