from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class IngestRequest(BaseModel):
    dataset: str = Field(..., description="Logical dataset/collection name")
    text: Optional[str] = Field(None, description="Raw text to ingest")
    doc_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class IngestResponse(BaseModel):
    dataset: str
    doc_id: str
    chunk_ids: List[str]

class QueryRequest(BaseModel):
    dataset: str
    query: str
    k: int = 5
    with_sources: bool = True

class Source(BaseModel):
    doc_id: str
    chunk_id: str
    score: float
    text: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class QueryResponse(BaseModel):
    dataset: str
    query: str
    answer: str
    sources: List[Source] = Field(default_factory=list)
