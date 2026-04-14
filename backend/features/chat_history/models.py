from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ConversationOut(BaseModel):
    id: str
    ns: str
    title: str
    tenant_id: str = "tenant_demo"
    created_at: str
    updated_at: str


class ChatMessageOut(BaseModel):
    role: str
    content: str
    created_at: Optional[str] = None
    citations: list[dict[str, Any]] = Field(default_factory=list)
    trace_id: Optional[str] = None
    request_id: Optional[str] = None


class CreateConversationIn(BaseModel):
    ns: str = Field(..., min_length=1, max_length=256)
    id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    title: str = Field(default="New chat", min_length=1, max_length=200)
    tenant_id: str = Field(default="tenant_demo", min_length=1, max_length=128)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class UpdateConversationIn(BaseModel):
    ns: str = Field(..., min_length=1, max_length=256)
    title: str = Field(..., min_length=1, max_length=200)


class AppendMessageIn(BaseModel):
    ns: str = Field(..., min_length=1, max_length=256)
    role: str = Field(..., min_length=1, max_length=32)
    content: str = Field(...)
    created_at: Optional[str] = None
    citations: list[dict[str, Any]] = Field(default_factory=list)
    trace_id: Optional[str] = Field(default=None, max_length=200)
    request_id: Optional[str] = Field(default=None, max_length=200)
