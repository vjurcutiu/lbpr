
# Lightweight, dependency-free hashing embedder for MVP/happy-path.
# Replace with a proper provider (OpenAI, Azure, local) later by implementing the same interface.

import math
from typing import List

DIM = 768  # keep it modest for speed

def _hash_token(t: str) -> int:
    # A simple, stable hash across runs
    h = 2166136261
    for ch in t:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h

def embed_texts(texts: List[str]) -> List[List[float]]:
    vectors = []
    for txt in texts:
        vec = [0.0] * DIM
        # char 3-grams for a tiny bit of semantics
        grams = [txt[i:i+3] for i in range(max(0, len(txt)-2))]
        for g in grams:
            idx = _hash_token(g) % DIM
            vec[idx] += 1.0
        # L2 normalize
        norm = math.sqrt(sum(v*v for v in vec)) or 1.0
        vec = [v / norm for v in vec]
        vectors.append(vec)
    return vectors

def embed_one(text: str) -> List[float]:
    return embed_texts([text])[0]
