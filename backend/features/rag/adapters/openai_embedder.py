# OpenAI Embedding Adapter
# Uses the modern OpenAI Python SDK (>=1.0): `from openai import OpenAI`
# Respects: OPENAI_API_KEY, RAG_EMBED_MODEL (default: text-embedding-3-small)
from __future__ import annotations

import os
import time
from typing import List

try:
    from openai import OpenAI
except Exception as e:  # pragma: no cover - import error surfaced at runtime
    OpenAI = None  # type: ignore

DEFAULT_MODEL = os.getenv("RAG_EMBED_MODEL", "text-embedding-3-small")

class OpenAIEmbedder:
    def __init__(self, model: str | None = None, timeout: float = 30.0, max_retries: int = 3):
        self.model = model or DEFAULT_MODEL
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        if OpenAI is None:
            raise RuntimeError("OpenAI SDK not installed. Install `openai>=1.0`.")
        self.client = OpenAI(api_key=api_key)
        self.timeout = timeout
        self.max_retries = max_retries

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        # Basic exponential backoff
        delay = 1.0
        for attempt in range(self.max_retries):
            try:
                resp = self.client.embeddings.create(model=self.model, input=texts, timeout=self.timeout)
                # SDK returns `data[i].embedding` as list[float]
                return [d.embedding for d in resp.data]
            except Exception as e:
                if attempt == self.max_retries - 1:
                    raise
                time.sleep(delay)
                delay *= 2

    def embed_one(self, text: str) -> List[float]:
        return self.embed_texts([text])[0]
