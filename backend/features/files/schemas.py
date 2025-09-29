
from __future__ import annotations
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class FileItem(BaseModel):
    id: str
    name: str
    size: int
    created_at: Optional[str] = None
    content_type: Optional[str] = None

class UploadResponse(BaseModel):
    job_id: str

class DeleteResponse(BaseModel):
    ok: bool = True
