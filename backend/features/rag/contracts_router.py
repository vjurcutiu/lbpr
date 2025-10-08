# backend/features/rag/contracts_router.py
from __future__ import annotations

import logging
from typing import List, Optional, Dict

from fastapi import APIRouter, Request, Depends
from pydantic import BaseModel

# If auth deps exist in your project, keep the import. Otherwise, use a stub.
try:
    from features.auth.deps import get_current_user  # type: ignore
    from features.auth.models import SessionOut  # type: ignore
except Exception:  # local/dev fallback
    def get_current_user():
        class _U: uid = "dev"
        return _U()
    class SessionOut(BaseModel):  # type: ignore
        uid: str = "dev"

# OpenAI adapter (optional — we fallback cleanly if missing)
try:
    from .adapters.openai_chat import OpenAIChat  # type: ignore
except Exception:
    OpenAIChat = None  # type: ignore

# RAG orchestrator (dense+sparse hybrid with per-user namespaces)
from . import orchestrator
from .schemas import QueryRequest

router = APIRouter(prefix="/v1", tags=["RAG (Contracts)"])
log = logging.getLogger("rag.contracts")


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatTurn]] = None
    # NEW: wire RAG in chat — dataset & top-k
    dataset: str = "default"
    k: int = 5


class ChatResponse(BaseModel):
    answer: str


def _build_context(snippets: List[str], max_chars: int = 5000) -> str:
    """Join top-k snippets into a bounded context block."""
    out: List[str] = []
    total = 0
    for i, s in enumerate(snippets, start=1):
        s = (s or "").strip()
        if not s:
            continue
        if total + len(s) + 50 > max_chars:
            break
        out.append(f"[{i}] {s}")
        total += len(s) + 4
    return "\n\n".join(out)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    """Primary chat endpoint used by the frontend.

    Now performs a RAG retrieval (hybrid dense+sparse) against the user's namespace
    before calling the LLM. If the LLM fails or is unavailable, we return the
    concatenated top snippets so the UI still shows something useful.
    """
    uid = getattr(user, "uid", "dev")
    dataset = (req.dataset or "default").strip() or "default"
    k = max(1, min(req.k or 5, 10))

    # ---- 1) Retrieval -----------------------------------------------------
    try:
        q = QueryRequest(dataset=dataset, query=req.message, k=k, with_sources=True)
        rag = orchestrator.query_request(q, uid)
        log.info("chat_rag_ok", dataset=rag.dataset, uid=uid, sources=len(rag.sources))
    except Exception:
        log.exception("chat_rag_error")
        # graceful fallback
        rag = None

    # Collect snippets for the prompt (or fallback answer)
    snippets = [(s.text or "").strip() for s in (rag.sources if rag else []) if (s.text or "").strip()]
    context_block = _build_context(snippets) if snippets else ""

    # ---- 2) Generation ----------------------------------------------------
    USE_LLM = OpenAIChat is not None
    if USE_LLM:
        try:
            llm = OpenAIChat()
            history = [t.model_dump() for t in (req.history or [])]

            system = (
                "You are a concise, trustworthy assistant. "
                "Use ONLY the provided context to answer the user's question. "
                "If the answer isn't in the context, say you don't have enough information. "
                "Cite snippets like [1], [2] when relevant."
            )
            user_msg = req.message
            if context_block:
                user_msg = f"Question:\n{req.message}\n\nContext:\n{context_block}"

            answer = await llm.simple_answer(
                message=user_msg,
                history=history,
                system=system,
            )
            if not answer:
                raise RuntimeError("empty LLM answer")
            return ChatResponse(answer=answer)
        except Exception:
            log.exception("chat_llm_error")  # keep parity with existing logs

    # ---- 3) Fallbacks -----------------------------------------------------
    if context_block:
        # Extractive fallback: return the joined snippets
        return ChatResponse(answer=context_block)

    # Last-resort echo (kept for historical parity)
    return ChatResponse(answer=f"You said: {req.message}")
