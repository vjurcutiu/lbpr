
from fastapi import APIRouter, HTTPException, Request
from .schemas import IngestRequest, IngestResponse, QueryRequest, QueryResponse
from . import orchestrator
import logging

router = APIRouter(prefix="/features/rag", tags=["RAG"])
log = logging.getLogger("rag.router")

@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, request: Request):
    try:
        log.info("ingest_request", dataset=req.dataset, has_text=bool(req.text), meta_keys=list((req.metadata or {}).keys()), client=str(request.client))
        resp = orchestrator.ingest(req)
        log.info("ingest_ok", dataset=resp.dataset, doc_id=resp.doc_id, chunks=len(resp.chunk_ids))
        return resp
    except Exception as e:
        log.exception("ingest_error")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest, request: Request):
    try:
        log.info("query_request", dataset=req.dataset, k=req.k, client=str(request.client))
        resp = orchestrator.query(req)
        log.info("query_ok", dataset=resp.dataset, sources=len(resp.sources))
        return resp
    except Exception as e:
        log.exception("query_error")
        raise HTTPException(status_code=400, detail=str(e))
