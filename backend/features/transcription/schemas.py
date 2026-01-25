from __future__ import annotations

from pydantic import BaseModel, Field
from typing import List, Optional


class TranscribeResponse(BaseModel):
    job_id: str = Field(..., description="Upload tracker job id")
    text: str = Field(..., description="Best-effort concatenated transcript text")
    segments: List[str] = Field(default_factory=list, description="Per-result transcript segments (top alternative)")
    detected_languages: List[str] = Field(default_factory=list, description="Detected language codes (if provided by API)")
    billed_seconds: int = Field(0, description="Billed audio seconds (rounded)")
    model: str = Field(..., description="Speech-to-Text model identifier used")
    location: str = Field(..., description="Recognizer location/region used")
