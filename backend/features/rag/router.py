from fastapi import APIRouter, HTTPException, Request, Depends
from .schemas import IngestRequest, IngestResponse, QueryRequest, QueryResponse
from . import orchestrator
import logging

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from core.tokenizer import count_tokens
from core.rate_limit import add_upload_tokens, add_message
from core.plan import sync_caps_and_plan
from core.pii import tokenize_text, detokenize_text

router = APIRouter(prefix="/features/rag", tags=["RAG"]) 
log = logging.getLogger("rag.router")

@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        await sync_caps_and_plan(user.uid)
        text = req.text or ""
        # Account usage on raw text, but index/tokenize before sending to vector store.
        tokenized_text = tokenize_text(user.uid, text) if text else text
        tokens = count_tokens(text)
        ok, used, cap = await add_upload_tokens(user.uid, tokens)
        log.info("usage_upload_tokens_add", extra={"uid": user.uid, "dataset": req.dataset, "tokens": tokens, "allowed": ok, "used_upload_tokens": used, "cap_upload_tokens": cap, "client": str(request.client)})
        if not ok:
            raise HTTPException(status_code=429, detail=f"Upload budget exceeded ({used}/{cap} tokens). Upgrade to continue.")
        meta = dict(req.metadata or {})
        for k in ("title", "filename", "display_name", "folder_path"):
            if isinstance(meta.get(k), str):
                meta[k] = tokenize_text(user.uid, meta[k])
        req2 = IngestRequest(dataset=req.dataset, text=str(tokenized_text), doc_id=req.doc_id, metadata=meta)
        resp = orchestrator.ingest_request(req2, user.uid)
        log.info("rag_ingest_ok", extra={"uid": user.uid, "dataset": req.dataset, "doc_id": resp.doc_id, "chunks": len(resp.chunk_ids)})
        return resp
    except HTTPException:
        raise
    except Exception as e:
        log.exception("rag_ingest_error", extra={"uid": user.uid, "dataset": getattr(req, "dataset", None)})
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        await sync_caps_and_plan(user.uid)
        ok, used, cap = await add_message(user.uid)
        log.info("usage_message_add", extra={"uid": user.uid, "allowed": ok, "used_messages": used, "cap_messages": cap, "path": str(request.url.path)})
        if not ok:
            raise HTTPException(status_code=429, detail=f"Message limit reached ({used}/{cap}). Upgrade to continue.")
        # Tokenize query so it matches tokenized documents in the index.
        req2 = QueryRequest(
            dataset=req.dataset,
            query=tokenize_text(user.uid, req.query),
            k=req.k,
            with_sources=req.with_sources,
            exclude_doc_ids=req.exclude_doc_ids,
            per_doc=req.per_doc,
        )
        resp = orchestrator.query_request(req2, user.uid)
        # Detokenize response for user-facing API.
        if resp.answer:
            resp.answer = detokenize_text(user.uid, resp.answer)
        if resp.sources:
            for s in resp.sources:
                if getattr(s, "text", None):
                    s.text = detokenize_text(user.uid, s.text)
                try:
                    meta = s.metadata or {}
                    for k in ("title", "filename", "display_name", "folder_path"):
                        if isinstance(meta.get(k), str):
                            meta[k] = detokenize_text(user.uid, meta[k])
                    s.metadata = meta
                except Exception:
                    pass
        log.info("rag_query_ok", extra={"uid": user.uid, "dataset": req.dataset, "k": req.k, "with_sources": req.with_sources})
        return resp
    except HTTPException:
        raise
    except Exception as e:
        log.exception("rag_query_error", extra={"uid": user.uid, "dataset": getattr(req, "dataset", None)})
        raise HTTPException(status_code=400, detail=str(e))
