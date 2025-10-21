# features/profile/models.py
from __future__ import annotations

from pydantic import BaseModel, HttpUrl, Field
from typing import Optional


class ProfileOut(BaseModel):
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    picture: Optional[str] = None


class ProfileUpdateIn(BaseModel):
    # Email updates are handled by Firebase verifyBeforeUpdateEmail; do NOT accept here.
    name: Optional[str] = Field(default=None, max_length=200)
    picture: Optional[str] = Field(default=None, max_length=2000)
