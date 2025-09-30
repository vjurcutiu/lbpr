import math
import os
import logging
import time
from typing import List

log = logging.getLogger("rag.embedder")

RAG_EMBEDDER = os.getenv("RAG_EMBEDDER", "local").lower()

DIM = 768  # local hashing dim

def _hash_token(t: str) -> int:
    h = 2166136261
    for ch in t:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h

def _local_embed_texts(texts: List[str]) -> List[List[float]]:
    t0 = time.time()
    vectors = []
    for txt in texts:
        vec = [0.0] * DIM
        grams = [txt[i:i+3] for i in range(max(0, len(txt)-2))]
        for g in grams:
            idx = _hash_token(g) % DIM
            vec[idx] += 1.0
        norm = math.sqrt(sum(v*v for v in vec)) or 1.0
        vec = [v / norm for v in vec]
        vectors.append(vec)
    dur_ms = int((time.time() - t0) * 1000)
    log.info("local_embed_ok", count=len(texts), dim=DIM, dur_ms=dur_ms)
    return vectors

def _openai_embed_texts(texts: List[str]) -> List[List[float]]:
    from .adapters.openai_embedder import OpenAIEmbedder
    embedder = OpenAIEmbedder()
    log.info("openai_embed_call", model=embedder.model, count=len(texts))
    return embedder.embed_texts(texts)

def embed_texts(texts: List[str]) -> List[List[float]]:
    if RAG_EMBEDDER == "openai":
        return _openai_embed_texts(texts)
    log.info("local_embed_call", count=len(texts), dim=DIM)
    return _local_embed_texts(texts)

def embed_one(text: str) -> List[float]:
    return embed_texts([text])[0]
