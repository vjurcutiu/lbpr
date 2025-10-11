# backend/features/rag/router.py

from fastapi import APIRouter, HTTPException, Request, Depends
from .schemas import IngestRequest, IngestResponse, QueryRequest, QueryResponse
from . import orchestrator
import logging

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from core.tokenizer import count_tokens
from core.rate_limit import add_upload_tokens, add_message

router = APIRouter(prefix="/features/rag", tags=["RAG"]) 
log = logging.getLogger("rag.router")


@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        # Compute tokens and enforce monthly upload token budget
        text = req.text or ""
        tokens = count_tokens(text)
        ok, used, cap = await add_upload_tokens(user.uid, tokens)
        log.info(
            "usage_upload_tokens_add",
            uid=user.uid, dataset=req.dataset, tokens=tokens,
            allowed=ok, used_upload_tokens=used, cap_upload_tokens=cap,
            client=str(request.client),
        )
        if not ok:
            raise HTTPException(status_code=429, detail=f"Monthly upload token limit reached ({used}/{cap}). Upgrade to increase your limits.")

        # Apply per-user namespace under the hood
        resp = orchestrator.ingest_request(req, user.uid)
        log.info("rag_ingest_ok", uid=user.uid, dataset=req.dataset, doc_id=resp.doc_id, chunks=len(resp.chunk_ids))
        return resp
    except HTTPException:
        raise
    except Exception as e:
        log.exception("rag_ingest_error", uid=user.uid, dataset=getattr(req, "dataset", None))
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        # Count a chat message and log usage outcome
        try:
            ok, used, cap = await add_message(user.uid)
            log.info(
                "usage_message_add",
                uid=user.uid, allowed=ok, used_messages=used, cap_messages=cap,
                path=str(request.url.path)
            )
        except Exception:
            log.exception("usage_message_add_error", uid=user.uid)

        # Apply per-user namespace under the hood
        resp = orchestrator.query_request(req, user.uid)
        log.info("rag_query_ok", uid=user.uid, dataset=req.dataset, k=req.k, with_sources=req.with_sources)
        return resp
    except Exception as e:
        log.exception("rag_query_error", uid=user.uid, dataset=getattr(req, "dataset", None))
        raise HTTPException(status_code=400, detail=str(e))
