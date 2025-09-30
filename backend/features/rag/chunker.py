from typing import List, Dict
from math import floor

def simple_word_chunker(text: str, chunk_size: int = 1500, overlap: int = 150) -> List[Dict]:
    min_cs, max_cs = floor(1500 * 0.9), floor(1500 * 1.1)
    if chunk_size < min_cs: chunk_size = min_cs
    if chunk_size > max_cs: chunk_size = max_cs
    words = text.split()
    chunks = []
    i = 0
    idx = 0
    while i < len(words):
        j = min(len(words), i + chunk_size)
        chunk_words = words[i:j]
        chunk_text = " ".join(chunk_words)
        chunks.append({
            "chunk_id": f"ch_{idx}",
            "text": chunk_text,
            "span": {"start": i, "end": j},
        })
        idx += 1
        if j == len(words):
            break
        i = max(i + chunk_size - overlap, j - overlap)
    return chunks
