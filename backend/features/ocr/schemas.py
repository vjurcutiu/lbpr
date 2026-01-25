from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field


class OcrResponse(BaseModel):
    job_id: str
    text: str = ""
    mode: str = Field(default="document", description="OCR mode used: document|text")
    language_hints: List[str] = Field(default_factory=list)
    images_charged: int = Field(default=1, description="How many images/pages were counted toward usage")
