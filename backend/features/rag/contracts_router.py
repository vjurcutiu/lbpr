# features/rag/contracts_router.py
from __future__ import annotations

from typing import Optional, List, Any, Tuple
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
import logging
import time
import os

from .embedder import embed_one
from .vectorstore import InMemoryVectorStore  # type: ignore
from . import orchestrator  # exposes _store, _sparse, FUSION, ALPHA

# Optional LLM (OpenAI). If not configured, we fall back to snippet echo.
USE_LLM = bool(os.getenv("OPENAI_API_KEY"))
OpenAIChat = None
if USE_LLM:
    try:
        from .adapters.openai_chat import OpenAIChat  # type: ignore
    except Exception:
        # If import fails, disable LLM path gracefully
        OpenAIChat = None
        USE_LLM = False

router = APIRouter(tags=["RAG (Contracts)"])
log = logging.getLogger("rag.contracts")

# ───────────────────────── Schemas ─────────────────────────


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


# ───────────────────── Helper utilities ────────────────────


def _tenant_from_header(x_tenant_id: Optional[str]) -> Optional[str]:
    return x_tenant_id


# Use the active store selected by orchestrator (memory or pinecone)
_store: InMemoryVectorStore = orchestrator._store  # type: ignore[attr-defined]


def _ns(dataset: str, tenant_id: str) -> str:
    # namespace format aligns with the rest of the RAG stack
    return f"t:{tenant_id}:{dataset}"


def _mk_snippet(text: str, max_len: int = 280) -> str:
    t = " ".join(text.split())
    return (t[: max_len - 1] + "…") if len(t) > max_len else t


def _build_context_from_hits(hits: List[Tuple[float, dict]]) -> List[str]:
    snippets: List[str] = []
    for _score, e in hits:
        snippets.append(f"- {e['text'].strip()}".strip())
    return snippets


def _normalize_history(h: Optional[List[Any]]) -> List[dict]:
    """
    Normalize ChatRequest.history into a list[dict] with keys: role, content.
    Accepts either a list of dicts or list of ChatTurn Pydantic objects.
    """
    if not h:
        return []
    out: List[dict] = []
    for t in h:
        if isinstance(t, dict):
            out.append({"role": t.get("role", "user"), "content": t.get("content", "")})
        else:
            # Pydantic ChatTurn object (or similar with attributes)
            out.append({"role": getattr(t, "role", "user"), "content": getattr(t, "content", "")})
    return out


# ──────────────────────── Endpoints ────────────────────────


@router.get("/v1/search", response_model=SearchResults)
def search(
    request: Request,
    q: str = Query(..., description="Search query"),
    limit: int = Query(10, ge=1, le=50),
    x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False),
    x_trace_id: Optional[str] = Header(default=None, convert_underscores=False),
    dataset: str = Query("default", description="Logical dataset (namespace within tenant)"),
):
    """
    Hybrid search (dense + sparse) with robust fusion.
    Falls back to dense-only if the active store doesn't implement hybrid.
    """
    t0 = time.time()
    tenant_id = _tenant_from_header(x_tenant_id) or "demo"
    ns = _ns(dataset, tenant_id)

    # Build dense + sparse queries (same flow as orchestrator.query)
    qvec = embed_one(q)
    qsparse = orchestrator._sparse.encode_query(q)  # BM25 sparse query

    # Prefer hybrid; fall back gracefully
    if hasattr(_store, "query_hybrid"):
        results = _store.query_hybrid(
            ns, qvec, qsparse, k=limit, fusion=orchestrator.FUSION, alpha=orchestrator.ALPHA
        )
    elif hasattr(_store, "query_dense"):
        results = _store.query_dense(ns, qvec, k=limit)
    else:
        raise HTTPException(500, "Active vector store does not support search")

    items: List[DocHit] = []
    for score, e in results:
        title = (e.get("metadata") or {}).get("title") or e["doc_id"]
        items.append(
            DocHit(
                id=f'{e["doc_id"]}:{e["chunk_id"]}',
                title=str(title),
                score=float(score),
                snippet=_mk_snippet(e["text"]),
            )
        )

    dur_ms = int((time.time() - t0) * 1000)
    log.info(
        "contracts_search_ok",
        extra={
            "q": q,
            "limit": limit,
            "ns": ns,
            "total": len(items),
            "dur_ms": dur_ms,
            "trace_id": x_trace_id or getattr(request.state, "trace_id", None),
            "tenant_id": tenant_id,
        },
    )
    return SearchResults(total=len(items), items=items)


@router.post("/v1/chat", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    request: Request,
    x_trace_id: Optional[str] = Header(default=None, convert_underscores=False),
):
    """
    RAG chat:
      1) Retrieve context via hybrid search (fallback to dense).
      2) If LLM is configured, answer with grounding; else return snippets.
    """
    t0 = time.time()
    tenant_id = (req.tenant_id or "demo").strip()
    ns = _ns("default", tenant_id)

    try:
        # Retrieve
        qvec = embed_one(req.message)
        qsparse = orchestrator._sparse.encode_query(req.message)  # BM25

        if hasattr(_store, "query_hybrid"):
            hits = _store.query_hybrid(
                ns,
                qvec,
                qsparse,
                k=req.max_context,
                fusion=orchestrator.FUSION,
                alpha=orchestrator.ALPHA,
            )
        elif hasattr(_store, "query_dense"):
            hits = _store.query_dense(ns, qvec, k=req.max_context)
        else:
            raise HTTPException(500, "Active vector store does not support chat retrieval")

        # Citations (for UI grounding)
        citations: List[Citation] = []
        for _score, e in hits:
            md = e.get("metadata", {}) or {}
            span_start = md.get("span_start")
            span_end = md.get("span_end")
            span = f"{span_start}-{span_end}" if (span_start is not None and span_end is not None) else None
            citations.append(Citation(doc_id=e["doc_id"], title=md.get("title"), span=span))

        # Answer
        if USE_LLM and OpenAIChat is not None:
            chat = OpenAIChat()
            snippets = _build_context_from_hits(hits)

            # ✅ Normalize history to list[dict] to match adapter expectations
            norm_history = _normalize_history(req.history)

            if snippets:
                system = (
                    "You are an expert assistant. Answer the user's question using ONLY the provided context.\n"
                    "If the answer is not present in the context, say you don't know. Keep it concise."
                )
                user_content = f"Question: {req.message}\n\nContext:\n" + "\n".join(snippets)
            else:
                system = (
                    "You are a helpful general assistant. No RAG context is available for this turn.\n"
                    "Answer from general knowledge. If the user asks about their private data, explain that no context was retrieved."
                )
                user_content = req.message

            try:
                answer_text = chat.generate(system=system, user=user_content, history=norm_history)
            except Exception:
                log.exception("openai_chat_fallback")
                snippets = _build_context_from_hits(hits)
                answer_text = (
                    f"Here are the most relevant snippets for: '{req.message}'\n\n" + "\n\n".join(snippets)
                    if snippets
                    else "I couldn’t find relevant context yet."
                )
        else:
            # No LLM configured → return snippets
            snippets = _build_context_from_hits(hits)
            answer_text = (
                f"Here are the most relevant snippets for: '{req.message}'\n\n" + "\n\n".join(snippets)
                if snippets
                else "I couldn’t find relevant context yet."
            )

        dur_ms = int((time.time() - t0) * 1000)
        log.info(
            "contracts_chat_ok",
            extra={
                "ns": ns,
                "retrieved": len(hits),
                "dur_ms": dur_ms,
                "trace_id": x_trace_id or getattr(request.state, "trace_id", None),
                "tenant_id": tenant_id,
            },
        )
        return ChatResponse(answer=answer_text, citations=citations, usage={})

    except HTTPException:
        raise
    except Exception:
        log.exception(
            "contracts_chat_error",
            extra={
                "ns": ns,
                "dur_ms": int((time.time() - t0) * 1000),
                "trace_id": x_trace_id or getattr(request.state, "trace_id", None),
                "tenant_id": tenant_id,
            },
        )
        raise HTTPException(status_code=500, detail="Chat processing failed")
