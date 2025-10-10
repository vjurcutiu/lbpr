from __future__ import annotations
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class Job(BaseModel):
    job_id: str
    uid: str
    filename: str
    dataset: str = "default"
    total_bytes: int = 0
    bytes: int = 0
    phase: str = "receive"     # receive|upload|ocr|extract|embed|upsert|complete|error
    pct: int = 0
    status: str = "running"    # running|done|error
    error: Optional[str] = None
    created_at: int
    updated_at: int

class JobsResponse(BaseModel):
    items: List[Job] = Field(default_factory=list)
