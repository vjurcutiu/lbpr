from typing import Optional, List
from fastapi import APIRouter, Header, HTTPException, Depends, Query, Request
from pydantic import BaseModel, Field
import logging, time, os

from .embedder import embed_one
from .vectorstore import InMemoryVectorStore
from . import orchestrator

# Optional LLM (OpenAI). If not configured, we fall back to snippet echo.
USE_LLM = bool(os.getenv("OPENAI_API_KEY"))

if USE_LLM:
    try:
        from .adapters.openai_chat import OpenAIChat
    except Exception as _e:
        OpenAIChat = None  # type: ignore
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

def _mk_snippet(text: str, max_len: int = 280) -> str:
    t = " ".join(text.split())
    return (t[: max_len - 1] + "…") if len(t) > max_len else t

@router.get("/v1/search", response_model=SearchResults)
def search(
    request: Request,
    q: str = Query(..., description="Search query"),
    limit: int = Query(10, ge=1, le=50),
    x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False),
    x_trace_id: Optional[str] = Header(default=None, convert_underscores=False),
    dataset: str = Query("default", description="Logical dataset (namespace within tenant)"),
):
    t0 = time.time()
    tenant_id = _tenant_from_header(x_tenant_id) or "demo"
    ns = _ns(dataset, tenant_id)
    qvec = embed_one(q)
    results = _store.query(ns, qvec, k=limit)
    items: List[DocHit] = []
    for score, e in results:
        title = e["metadata"].get("title") or e["doc_id"]
        items.append(
            DocHit(
                id=f'{e["doc_id"]}:{e["chunk_id"]}',
                title=str(title),
                score=float(score),
                snippet=_mk_snippet(e["text"]),
            )
        )
    dur_ms = int((time.time() - t0) * 1000)
    log.info("contracts_search_ok", q=q, limit=limit, ns=ns, total=len(items), dur_ms=dur_ms,
             trace_id=x_trace_id or getattr(request.state, "trace_id", None), tenant_id=tenant_id)
    return SearchResults(total=len(items), items=items)

def _build_context_from_hits(hits) -> List[str]:
    snippets: List[str] = []
    for _score, e in hits:
        snippets.append(f"- {e['text'].strip()}".strip())
    return snippets

@router.post("/v1/chat", response_model=ChatResponse)
def chat(req: ChatRequest, request: Request, x_trace_id: Optional[str] = Header(default=None, convert_underscores=False)):
    t0 = time.time()
    tenant_id = req.tenant_id or "demo"
    ns = _ns("default", tenant_id)
    retrieved = 0
    try:
        qvec = embed_one(req.message)
        hits = _store.query(ns, qvec, k=req.max_context)
        retrieved = len(hits)

        # Build citations (even if we later choose to not strictly quote them in prose)
        citations: List[Citation] = []
        for _score, e in hits:
            span_start = e.get("metadata", {}).get("span_start")
            span_end = e.get("metadata", {}).get("span_end")
            span = f"{span_start}-{span_end}" if (span_start is not None and span_end is not None) else None
            citations.append(Citation(doc_id=e["doc_id"], title=e.get("metadata", {}).get("title"), span=span))

        # Decide answer path
        answer_text: str
        model_used = None

        if USE_LLM and OpenAIChat is not None:
            chat = OpenAIChat()
            model_used = chat.model
            snippets = _build_context_from_hits(hits)

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
                answer_text = chat.generate(system=system, user=user_content, history=(req.history or []))
            except Exception:
                # On LLM failure, fall back to old behavior
                snippets = _build_context_from_hits(hits)
                answer_text = (
                    f"Here are the most relevant snippets for: '{req.message}'\n\n" + "\n\n".join(snippets)
                    if snippets else "I couldn’t find relevant context yet."
                )
                model_used = None
        else:
            # No LLM configured: original snippet behavior
            snippets = _build_context_from_hits(hits)
            answer_text = (
                f"Here are the most relevant snippets for: '{req.message}'\n\n" + "\n\n".join(snippets)
                if snippets else "I couldn’t find relevant context yet."
            )

        dur_ms = int((time.time() - t0) * 1000)
        log.info("contracts_chat_ok",
                 ns=ns, message_len=len(req.message),
                 history=len(req.history or []), retrieved=retrieved,
                 llm=bool(model_used), model=model_used,
                 dur_ms=dur_ms,
                 trace_id=x_trace_id or getattr(request.state, "trace_id", None),
                 tenant_id=tenant_id)

        usage = {"retrieved": retrieved}
        if model_used:
            usage["model"] = model_used

        return ChatResponse(answer=answer_text, citations=citations, usage=usage)

    except Exception:
        dur_ms = int((time.time() - t0) * 1000)
        log.exception("contracts_chat_error",
                      ns=ns, dur_ms=dur_ms,
                      trace_id=x_trace_id or getattr(request.state, "trace_id", None),
                      tenant_id=tenant_id)
        raise HTTPException(status_code=500, detail="chat_failed")
