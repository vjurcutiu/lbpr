
from typing import List, Dict
from .schemas import QueryRequest, QueryResponse, Source, IngestRequest, IngestResponse
from .chunker import simple_word_chunker
from .embedder import embed_texts, embed_one
from .vectorstore import InMemoryVectorStore

# Single in-process store for MVP; swap with Qdrant/pgvector later.
_store = InMemoryVectorStore()

def ingest(req: IngestRequest) -> IngestResponse:
    if not req.text:
        raise ValueError("text is required for MVP ingest")
    chunks = simple_word_chunker(req.text)
    vectors = embed_texts([c["text"] for c in chunks])
    entries: List[Dict] = []
    doc_id = req.doc_id or "doc_" + str(abs(hash(req.text)) % (10**8))
    for c, v in zip(chunks, vectors):
        entries.append({
            "chunk_id": c["chunk_id"],
            "doc_id": doc_id,
            "text": c["text"],
            "metadata": {**req.metadata, **{"span": c["span"]}},
            "vector": v,
        })
    _store.upsert_chunks(req.dataset, entries)
    return IngestResponse(dataset=req.dataset, doc_id=doc_id, chunk_ids=[e["chunk_id"] for e in entries])

def _compose_answer(query: str, hits: List[Source]) -> str:
    # Minimal, LLM-free answer composer for happy path:
    # concatenate the best snippets with a tiny preface.
    snippets = "\n\n".join([f"- {h.text.strip()}" for h in hits])
    return f"Here are the most relevant snippets I found for: '{query}'\n\n{snippets}"

def query(req: QueryRequest) -> QueryResponse:
    qvec = embed_one(req.query)
    results = _store.query(req.dataset, qvec, req.k)
    sources: List[Source] = [
        Source(
            doc_id=e["doc_id"],
            chunk_id=e["chunk_id"],
            score=float(score),
            text=e["text"],
            metadata=e["metadata"],
        )
        for score, e in results
    ]
    answer = _compose_answer(req.query, sources)
    return QueryResponse(dataset=req.dataset, query=req.query, answer=answer, sources=sources)
