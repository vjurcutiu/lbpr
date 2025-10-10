
from fastapi import APIRouter, HTTPException, Request, Depends
from .schemas import IngestRequest, IngestResponse, QueryRequest, QueryResponse
from . import orchestrator
import logging

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from core.tokenizer import count_tokens
from core.rate_limit import add_upload_tokens

router = APIRouter(prefix="/features/rag", tags=["RAG"]) 
log = logging.getLogger("rag.router")


@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    try:
        # Compute tokens and enforce monthly upload token budget
        text = req.text or ""
        tokens = count_tokens(text)
        ok, used, cap = await add_upload_tokens(user.uid, tokens)
        if not ok:
            raise HTTPException(status_code=429, detail=f"Monthly upload token limit reached ({used}/{cap}). Upgrade to increase your limits.")
        log_info = {
            "dataset": req.dataset, "has_text": bool(req.text),
            "meta_keys": list((req.metadata or {}).keys()),
            "client": str(request.client), "uid": user.uid,
            "tokens": tokens, "used_upload_tokens": used, "cap_upload_tokens": cap
        }


        # Apply per-user namespace under the hood
        resp = orchestrator.ingest_request(req, user.uid)

        return resp
    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))


@router.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    try:

        # Apply per-user namespace under the hood
        resp = orchestrator.query_request(req, user.uid)

        return resp
    except Exception as e:

        raise HTTPException(status_code=400, detail=str(e))
