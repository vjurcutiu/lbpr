
# backend/features/rag/contracts_router.py
from __future__ import annotations

import logging
from typing import List, Optional, Dict, Any, Tuple

from fastapi import APIRouter, Request, Depends, HTTPException
from pydantic import BaseModel, Field

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

class Citation(BaseModel):
    doc_id: str
    title: Optional[str] = None
    span: Optional[str] = None

class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation] = Field(default_factory=list)
    usage: Dict[str, Any] = Field(default_factory=dict)

def _build_context_from_sources(sources: List[Source]) -> Tuple[str, List[Citation]]:
    blocks: List[str] = []
    cites: List[Citation] = []
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
        cites.append(Citation(
            doc_id=s.doc_id,
            title=str(label),
            span=(f"{span_start}-{span_end}" if (isinstance(span_start, int) and isinstance(span_end, int)) else None)
        ))
    return "\n\n".join(blocks).strip(), cites

def _history_hint(history: Optional[List[ChatTurn]], max_turns: int = 8, max_chars: int = 1200) -> str:
    if not history:
        return ""
    turns = history[-max_turns:]
    parts: List[str] = []
    for t in turns:
        role = (t.role or "user").lower()
        prefix = "U:" if role == "user" else ("A:" if role == "assistant" else "S:")
        parts.append(f"{prefix} {t.content.strip()}".strip())
    hint = "\n".join(parts).strip()
    if len(hint) > max_chars:
        hint = hint[-max_chars:]
    return hint

async def _rewrite_query(question: str, hint: str) -> str:
    if not OpenAIChat:
        if hint:
            return f"{question}\n\n(History: {hint})"
        return question
    try:
        llm = OpenAIChat()
        system = (
            "You rewrite user questions into standalone, concise search queries. "
            "Keep essential entities, constraints, dates, and file/section names. Output ONE line, no quotes."
        )
        user = (
            "Conversation history (recent → older):\n"
            f"{hint}\n\n"
            "User's latest question: \n"
            f"{question}\n\n"
            "Rewrite now:"
        )
        rewritten = await llm.simple_answer(message=user, history=None, system=system)
        rewritten = (rewritten or "").strip()
        return " ".join(rewritten.split())[:600] or question
    except Exception:
        log.exception("query_rewrite_error")
        return question if not hint else f"{question} ({hint})"

@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request, user: SessionOut = Depends(get_current_user)) -> ChatResponse:
    uid = getattr(user, "uid", "dev")

    # 0) Enforce a message against usage
    ok, used, cap = await add_message(uid)
    log.info("usage_message_add", uid=uid, allowed=ok, used_messages=used, cap_messages=cap, path=str(request.url.path))
    if not ok:
        raise HTTPException(status_code=429, detail=f"Message limit reached ({used}/{cap}). Upgrade to continue.")

    # 1) Build history-aware retrieval query
    hint = _history_hint(req.history)
    search_query = await _rewrite_query(req.message, hint)
    if search_query != req.message:
        log.info("chat_query_rewritten", orig_len=len(req.message or ""), rewritten_len=len(search_query), has_hint=bool(hint))

    # 2) Retrieval
    citations: List[Citation] = []
    try:
        rag_resp: QueryResponse = query_request(
            QueryRequest(dataset=req.dataset, query=search_query, k=req.k, with_sources=req.with_sources),
            uid=uid,
        )
        if req.with_sources and rag_resp.sources:
            context_text, citations = _build_context_from_sources(rag_resp.sources)
        else:
            context_text, citations = (rag_resp.answer or "", [])
    except Exception:
        log.exception("chat_rag_error")
        context_text, citations = ("", [])

    # 3) LLM answer grounded in retrieved context
    try:
        from .adapters.openai_chat import OpenAIChat as _LLM  # re-import to avoid import cycles during tests
        llm = _LLM()
        history = [t.model_dump() for t in (req.history or [])]
        system = (
            "You are a concise, helpful assistant. Use the provided context. "
            "Cite with the bracketed numbers if helpful. "
            "If the context is empty or irrelevant, say you couldn't find anything relevant."
        )
        user_msg = f"Question:\n{req.message}\n\nContext:\n{context_text}"
        answer = await llm.simple_answer(message=user_msg, history=history, system=system)
        if answer and answer.strip():
            return ChatResponse(answer=answer, citations=citations, usage={})
    except Exception:
        log.exception("chat_llm_error")

    if context_text:
        return ChatResponse(answer=context_text, citations=citations, usage={})
    return ChatResponse(answer=f"You said: {req.message}", citations=[], usage={})
