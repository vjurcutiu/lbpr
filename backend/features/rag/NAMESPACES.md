
# Per-user namespaces

- **Pinecone**: we now write/query using namespaces of the form `u:{uid}:{dataset}`.
- **Firebase**: when storing files or metadata, use `core.namespaces.firebase_folder(uid)`
  as the base path, e.g. `users/{uid}/files/{fileId}`. Wire this in your Files router/service.
