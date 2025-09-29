# Vector store dispatcher: defaults to in-memory; can switch to Pinecone via env.
from typing import Dict, List, Tuple
import os
import math

RAG_VECTORSTORE = os.getenv("RAG_VECTORSTORE", "memory").lower()

class InMemoryVectorStore:
    def __init__(self):
        self._data: Dict[str, List[Dict]] = {}

    def upsert_chunks(self, dataset: str, entries: List[Dict]):
        self._data.setdefault(dataset, [])
        self._data[dataset].extend(entries)

    @staticmethod
    def _cosine(a: List[float], b: List[float]) -> float:
        return sum(x*y for x, y in zip(a, b))

    def query(self, dataset: str, query_vec: List[float], k: int = 5):
        entries = self._data.get(dataset, [])
        scored = []
        for e in entries:
            s = self._cosine(query_vec, e["vector"])
            scored.append((s, e))
        scored.sort(key=lambda t: t[0], reverse=True)
        return scored[:k]

def _pinecone_store():
    from .adapters.pinecone_store import PineconeVectorStore
    return PineconeVectorStore()

def get_store():
    if RAG_VECTORSTORE == "pinecone":
        return _pinecone_store()
    return InMemoryVectorStore()
