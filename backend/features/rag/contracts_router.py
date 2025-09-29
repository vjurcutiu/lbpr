
from typing import Optional, List
from fastapi import APIRouter, Header, HTTPException, Depends, Query
from pydantic import BaseModel, Field

from .embedder import embed_one
from .vectorstore import InMemoryVectorStore
from .chunker import simple_word_chunker
from . import orchestrator

router = APIRouter(tags=["RAG (Contracts)"])

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
    q: str = Query(..., description="Search query"),
    limit: int = Query(10, ge=1, le=50),
    x_tenant_id: Optional[str] = Header(default=None, convert_underscores=False),
    dataset: str = Query("default", description="Logical dataset (namespace within tenant)"),
):
    tenant_id = _tenant_from_header(x_tenant_id) or "demo"
    ns = _ns(dataset, tenant_id)
    qvec = embed_one(q)
    results = _store.query(ns, qvec, k=limit)
    items: List[DocHit] = []
    for score, e in results:
        title = e["metadata"].get("title") or e["doc_id"]
        span = e["metadata"].get("span")
        items.append(
            DocHit(
                id=f'{e["doc_id"]}:{e["chunk_id"]}',
                title=str(title),
                score=float(score),
                snippet=_mk_snippet(e["text"]),
            )
        )
    return SearchResults(total=len(items), items=items)

@router.post("/v1/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    tenant_id = req.tenant_id or "demo"
    ns = _ns("default", tenant_id)
    qvec = embed_one(req.message)
    hits = _store.query(ns, qvec, k=req.max_context)
    snippets = []
    citations: List[Citation] = []
    for score, e in hits:
        snippets.append(f"- {e['text'].strip()}")
        span = e.get("metadata", {}).get("span")
        citations.append(
            Citation(
                doc_id=e["doc_id"],
                title=e.get("metadata", {}).get("title"),
                span=str(span) if span else None,
            )
        )
    answer = (
        f"Here are the most relevant snippets for: '{req.message}'\n\n"
        + "\n\n".join(snippets)
        if snippets
        else "I couldn’t find relevant context yet."
    )
    return ChatResponse(
        answer=answer,
        citations=citations,
        usage={"retrieved": len(hits)},
    )
