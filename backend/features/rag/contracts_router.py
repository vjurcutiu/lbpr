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
except Exception:  # fallback for local dev without auth wired
    def get_current_user():
        class _U:
            uid = "dev"
        return _U()
    class SessionOut:  # type: ignore
        uid: str = "dev"

# Usage limits
from core.rate_limit import add_message

# RAG orchestrator & schemas
from .orchestrator import query_request
from .schemas import QueryRequest, QueryResponse, Source

# Optional LLM adapter
try:
    from .adapters.openai_chat import OpenAIChat  # type: ignore
except Exception:
    OpenAIChat = None  # type: ignore

router = APIRouter(prefix="/v1", tags=["RAG (Contracts)"])
log = logging.getLogger("rag.contracts")

class ChatTurn(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatTurn]] = None
    dataset: str = "default"
    k: int = 5
    with_sources: bool = True

class ChatResponse(BaseModel):
    answer: str

def _build_context_from_sources(sources: List[Source]) -> str:
    """Compose the model context with inline citations that include filenames.
    Format:
        [1] filename.ext (chars a-b)
        <snippet text>
    """
    blocks: List[str] = []
    for i, s in enumerate(sources or []):
        meta: Dict[str, Any] = s.metadata or {}
        label = meta.get("filename") or meta.get("title") or s.doc_id
        span_start = meta.get("span_start")
        span_end = meta.get("span_end")
        span = ""
        if isinstance(span_start, int) and isinstance(span_end, int):
            span = f" (chars {span_start}-{span_end})"
        head = f"[{i+1}] {label}{span}"
        text = (s.text or "").strip()
        blocks.append(f"{head}\n{text}" if text else head)
    return "\n\n".join(blocks).strip()

@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request, user: SessionOut = Depends(get_current_user)) -> ChatResponse:
    """
    RAG-first chat: retrieve per-user sources, build a filename-aware context,
    then let the LLM answer grounded in that context.
    Falls back to returning the concatenated sources if the LLM fails.
    Also counts a **message** against the user's monthly quota.
    """
    uid = getattr(user, "uid", "dev")

    # 0) Count a message against usage
    try:
        ok, used, cap = await add_message(uid)
        log.info(
            "usage_message_add",
            uid=uid, allowed=ok, used_messages=used, cap_messages=cap,
            path=str(request.url.path),
        )
    except Exception:
        log.exception("usage_message_add_error", uid=uid)

    # 1) Retrieval
    try:
        rag_resp: QueryResponse = query_request(
            QueryRequest(dataset=req.dataset, query=req.message, k=req.k, with_sources=req.with_sources),
            uid=uid,
        )
        # Build filename-aware context for the model.
        context_text = ""
        if (req.with_sources and rag_resp.sources):
            context_text = _build_context_from_sources(rag_resp.sources)
        else:
            # fallback to plain concatenated answer text from retrieval
            context_text = rag_resp.answer or ""
    except Exception:
        log.exception("chat_rag_error")
        context_text = ""

    # 2) LLM answer grounded in retrieved context
    if OpenAIChat is not None:
        try:
            llm = OpenAIChat()
            history = [t.model_dump() for t in (req.history or [])]
            system = (
                "You are a concise, helpful assistant. Use the provided context. "
                "Cite with the bracketed numbers if helpful. "
                "If the context is empty or irrelevant, say you couldn't find anything relevant."
            )
            user_msg = f"Question:\n{req.message}\n\nContext:\n{context_text}"
            # adapter expects keyword
            answer = await llm.simple_answer(message=user_msg, history=history, system=system)
            if answer and answer.strip():
                return ChatResponse(answer=answer)
        except Exception:
            log.exception("chat_llm_error")

    # 3) Fallbacks
    if context_text:
        return ChatResponse(answer=context_text)
    return ChatResponse(answer=f"You said: {req.message}")
