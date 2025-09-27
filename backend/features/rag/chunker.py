
from typing import List, Dict

def simple_word_chunker(text: str, chunk_size: int = 200, overlap: int = 40) -> List[Dict]:
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
        i = j - overlap if j - overlap > i else j
    return chunks
