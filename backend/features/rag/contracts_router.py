# backend/features/rag/contracts_router.py
from __future__ import annotations

import logging
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Request, Depends
from pydantic import BaseModel

# Auth
try:
    from features.auth.deps import get_current_user  # type: ignore
    from features.auth.models import SessionOut  # type: ignore
except Exception:
    def get_current_user():
        return None
    class SessionOut(BaseModel):  # type: ignore
        uid: str = "dev"

# LLM adapter (optional)
try:
    from .adapters.openai_chat import OpenAIChat  # type: ignore
except Exception:
    OpenAIChat = None  # type: ignore

# ✅ RAG orchestrator + schemas
from . import orchestrator
from .schemas import QueryRequest  # type: ignore

router = APIRouter(prefix="/v1", tags=["RAG (Contracts)"])
log = logging.getLogger("rag.contracts")

class ChatTurn(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatTurn]] = None
    # allow the client to pick a logical dataset (defaults to "default")
    dataset: str = "default"
    k: int = 5
    with_sources: bool = True

class ChatResponse(BaseModel):
    answer: str

@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    """
    RAG-first chat. We query the user's namespace, then (if available)
    ask the LLM to answer grounded in those sources. If LLM fails,
    we return the concatenated sources as an answer.
    """
    uid = getattr(user, "uid", "dev")

    # 1) Retrieval (per-user namespace happens inside orchestrator)
    try:
        rag_resp = orchestrator.query_request(
            QueryRequest(dataset=req.dataset, query=req.message, k=req.k, with_sources=req.with_sources),
            uid=uid,
        )
        context_text = rag_resp.answer or ""
    except Exception:
        log.exception("chat_rag_error")
        context_text = ""  # continue with LLM/echo below

    # 2) LLM answer grounded in retrieved context (if possible)
    if OpenAIChat is not None:
        try:
            llm = OpenAIChat()
            history = [t.model_dump() for t in (req.history or [])]
            system = (
                "You are a concise, helpful assistant. Use the provided context. "
                "If the context is empty or irrelevant, say you couldn't find anything relevant."
            )
            user_msg = f"Question:\n{req.message}\n\nContext:\n{context_text}"
            # ✅ FIX: use 'message=' per adapter signature
            answer = await llm.simple_answer(message=user_msg, history=history, system=system)
            if answer and answer.strip():
                return ChatResponse(answer=answer)
        except Exception:
            log.exception("chat_llm_error")

    # 3) Fallbacks:
    if context_text:
        # return retrieved snippets if LLM failed
        return ChatResponse(answer=context_text)
    return ChatResponse(answer=f"You said: {req.message}")
