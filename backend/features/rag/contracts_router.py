# features/rag/contracts_router.py
from __future__ import annotations

from typing import Optional, List, Any, Tuple
from fastapi import APIRouter, Header, HTTPException, Query, Request, Depends
from pydantic import BaseModel, Field
import logging
import time
import os

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from .embedder import embed_one
from .vectorstore import InMemoryVectorStore  # type: ignore
from . import orchestrator  # exposes _store, _sparse, FUSION, ALPHA

from core.rate_limit import add_message

# Optional LLM (OpenAI). If not configured, we fall back to snippet echo.
USE_LLM = bool(os.getenv("OPENAI_API_KEY"))
OpenAIChat = None
if USE_LLM:
    try:
        from .adapters.openai_chat import OpenAIChat  # type: ignore
    except Exception:
        OpenAIChat = None
        USE_LLM = False

router = APIRouter(tags=["RAG (Contracts)"])
log = logging.getLogger("rag.contracts")


class DocHit(BaseModel):
    id: str
    title: str
    score: float
    snippet: Optional[str] = None


class SearchResults(BaseModel):
    total: int
    items: List[DocHit]


class ChatTurn(BaseModel):
    role: str
    content: str


class Citation(BaseModel):
    doc_id: str
    title: Optional[str] = None
    span: Optional[str] = None


class ChatRequest(BaseModel):
    tenant_id: str
    message: str
    history: Optional[List[ChatTurn]] = None
    max_context: int = 6
    stream: bool = False


class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation] = Field(default_factory=list)
    usage: dict = Field(default_factory=dict)


def _tenant_from_header(x_tenant_id: Optional[str]) -> Optional[str]:
    return x_tenant_id


_store: InMemoryVectorStore = orchestrator._store  # type: ignore[attr-defined]


def _ns(dataset: str, tenant_id: str) -> str:
    return f"t:{tenant_id}:{dataset}"


@router.post("/v1/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    # Enforce message limit (per inbound chat invocation)
    ok, used, cap = await add_message(user.uid)
    if not ok:
        raise HTTPException(status_code=429, detail=f"Monthly message limit reached ({used}/{cap}). Upgrade to increase your limits.")
    log.info("chat_usage", uid=user.uid, used_messages=used, cap_messages=cap)

    # --- the rest of your existing chat orchestration (unchanged minimal echo fallback) ---
    tenant_id = req.tenant_id
    if not tenant_id:
        tenant_id = request.headers.get("x-tenant-id") or "default"

    # Simple echo fallback when no LLM configured
    answer = f"You said: {req.message}"
    citations: List[Citation] = []

    if USE_LLM and OpenAIChat:
        try:
            llm = OpenAIChat()
            answer = await llm.simple_answer(req.message)
        except Exception:
            log.exception("chat_llm_error")

    return ChatResponse(answer=answer, citations=citations, usage={"messages_used": used, "messages_cap": cap})
