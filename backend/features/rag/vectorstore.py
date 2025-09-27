
from typing import Dict, List, Tuple
import math

class InMemoryVectorStore:
    def __init__(self):
        # dataset -> list of entries
        # entry: {chunk_id, doc_id, vector, text, metadata}
        self._data: Dict[str, List[Dict]] = {}

    def upsert_chunks(self, dataset: str, entries: List[Dict]):
        self._data.setdefault(dataset, [])
        # naive: append; in a real impl, dedup by (doc_id, chunk_id)
        self._data[dataset].extend(entries)

    @staticmethod
    def _cosine(a: List[float], b: List[float]) -> float:
        # vectors are expected to be normalized already
        return sum(x*y for x, y in zip(a, b))

    def query(self, dataset: str, query_vec: List[float], k: int = 5) -> List[Tuple[float, Dict]]:
        entries = self._data.get(dataset, [])
        scored = []
        for e in entries:
            s = self._cosine(query_vec, e["vector"])
            scored.append((s, e))
        scored.sort(key=lambda t: t[0], reverse=True)
        return scored[:k]
