
from fastapi import APIRouter, HTTPException
from .schemas import IngestRequest, IngestResponse, QueryRequest, QueryResponse
from . import orchestrator

router = APIRouter(prefix="/features/rag", tags=["RAG"])

@router.post("/ingest", response_model=IngestResponse)
def ingest(req: IngestRequest):
    try:
        return orchestrator.ingest(req)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/query", response_model=QueryResponse)
def query(req: QueryRequest):
    try:
        return orchestrator.query(req)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
