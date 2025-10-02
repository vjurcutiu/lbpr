from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional

class ProfileOut(BaseModel):
    uid: str
    email: Optional[str] = None
    name: Optional[str] = Field(default=None, description="Display name")
    picture: Optional[str] = None

class ProfilePatchIn(BaseModel):
    # All optional; we'll apply only provided ones
    email: Optional[str] = Field(default=None, description="New email")
    name: Optional[str] = Field(default=None, description="New display name")
    password: Optional[str] = Field(default=None, description="New password (min 6 characters)")
    picture: Optional[str] = Field(default=None, description="New photo URL")
