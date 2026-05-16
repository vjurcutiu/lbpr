# features/profile/models.py
from __future__ import annotations

from pydantic import BaseModel, HttpUrl, Field
from typing import Optional


class ProfileOut(BaseModel):
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    picture: Optional[str] = None
    phone_number: Optional[str] = None


class ProfileUpdateIn(BaseModel):
    # Email updates are handled by Firebase verifyBeforeUpdateEmail; do NOT accept here.
    name: Optional[str] = Field(default=None, max_length=200)
    picture: Optional[str] = Field(default=None, max_length=2000)

class DeleteAccountIn(BaseModel):
    confirm_text: str = Field(..., min_length=1, max_length=32)


class DeleteAccountOut(BaseModel):
    ok: bool = True
    stripe_subscriptions_canceled: int = 0
    storage_objects_deleted: int = 0
    firestore_docs_deleted: int = 0
    pinecone_namespaces_deleted: int = 0
    redis_keys_deleted: int = 0
    sessions_revoked: int = 0

