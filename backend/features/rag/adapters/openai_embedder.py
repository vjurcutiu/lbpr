from __future__ import annotations

import os
import time
import logging
from typing import List

log = logging.getLogger("rag.openai")

try:
    from openai import OpenAI
except Exception as e:  # pragma: no cover
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
        delay = 1.0
        for attempt in range(self.max_retries):
            t0 = time.time()
            try:
                resp = self.client.embeddings.create(model=self.model, input=texts, timeout=self.timeout)
                dur_ms = int((time.time() - t0) * 1000)
                data = resp.data or []
                dim = len(data[0].embedding) if data else 0
                log.info("openai_embed_ok", model=self.model, count=len(texts), dur_ms=dur_ms, dim=dim)
                return [d.embedding for d in data]
            except Exception as e:
                if attempt == self.max_retries - 1:
                    log.exception("openai_embed_error_final")
                    raise
                log.warning("openai_embed_retry", attempt=attempt+1, error=str(e))
                time.sleep(delay)
                delay *= 2

    def embed_one(self, text: str) -> List[float]:
        return self.embed_texts([text])[0]
