from __future__ import annotations
from core.config import settings

def _get_encoding_name() -> str:
    # Prefer explicit override, then model-based guess, then cl100k_base
    if settings.TOKENIZER_MODEL:
        return settings.TOKENIZER_MODEL
    # Map common OpenAI models to encodings
    m = (settings.RAG_EMBED_MODEL or "").lower()
    # Most modern OpenAI text models use cl100k_base (including text-embedding-3-*)
    return "cl100k_base"

def count_tokens(text: str) -> int:
    try:
        import tiktoken  # type: ignore
        enc = tiktoken.get_encoding(_get_encoding_name())
        return len(enc.encode(text or ""))
    except Exception:
        # Fallback: approximate 4 chars/token
        t = text or ""
        return max(1, (len(t) + 3) // 4)
