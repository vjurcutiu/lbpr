from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class IngestRequest(BaseModel):
    dataset: str
    text: Optional[str] = None
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
    # Kept for compatibility, but chat flow will not auto-populate this anymore.
    exclude_doc_ids: List[str] = Field(default_factory=list)
    # Optionally restrict retrieval to a known set of documents.
    doc_ids: List[str] = Field(default_factory=list)
    # Diversify by document (one top chunk per doc) to avoid repetitive chunks.
    per_doc: bool = Field(default=True)

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
