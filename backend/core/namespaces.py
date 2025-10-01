
# core/namespaces.py
from __future__ import annotations

def pinecone_namespace(uid: str, dataset: str) -> str:
    """
    Build a per-user namespace for Pinecone using the authenticated user's UID.
    Example: u:abc123:myds
    """
    uid = (uid or "anon").strip()
    dataset = (dataset or "default").strip()
    return f"u:{uid}:{dataset}"

def firebase_folder(uid: str) -> str:
    """
    Base folder prefix for Firebase Storage and Firestore docs related to user uploads.
    Example: users/abc123
    """
    uid = (uid or "anon").strip()
    return f"users/{uid}"
