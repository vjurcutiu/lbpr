from __future__ import annotations

import os
import logging
from typing import List, Dict, Any

log = logging.getLogger("rag.openai.chat")

try:
    from openai import OpenAI
except Exception:
    OpenAI = None  # type: ignore

DEFAULT_MODEL = os.getenv("RAG_CHAT_MODEL", os.getenv("OPENAI_CHAT_MODEL", "gpt-4.1-mini"))
DEFAULT_TEMPERATURE = float(os.getenv("RAG_CHAT_TEMPERATURE", "0.2"))

class OpenAIChat:
    """Tiny wrapper around OpenAI Responses API for text-only answers."""
    def __init__(self, model: str | None = None, temperature: float | None = None, timeout: float = 30.0):
        if OpenAI is None:
            raise RuntimeError("OpenAI SDK not installed. Install `openai>=1.0`.")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        self.client = OpenAI(api_key=api_key)
        self.model = model or DEFAULT_MODEL
        self.temperature = DEFAULT_TEMPERATURE if temperature is None else float(temperature)
        self.timeout = timeout

    def generate(self, system: str, user: str, history: List[Dict[str, str]] | None = None) -> str:
        """Generate a single assistant message as plain text.

        `history` is a list of {role, content} where role in {"user","assistant","system"}.
        We'll map it to the Responses API single-input format by concatenating messages.
        """
        parts: List[Dict[str, Any]] = []
        # System instructions first
        if system:
            parts.append({"role": "system", "content": system})
        # Prior turns if provided
        for turn in (history or []):
            r = turn.get("role") or "user"
            c = str(turn.get("content") or "").strip()
            if not c:
                continue
            parts.append({"role": r, "content": c})
        # Current user message
        parts.append({"role": "user", "content": user})

        try:
            resp = self.client.responses.create(
                model=self.model,
                input=parts,
                temperature=self.temperature,
                timeout=self.timeout,
            )
            # responses API gives unified output
            out = getattr(resp, "output_text", None)
            if isinstance(out, str) and out.strip():
                return out.strip()
            # Fallback: try to assemble from content parts
            try:
                chunks = []
                for item in resp.output or []:
                    if getattr(item, "type", "") == "message" and getattr(item, "role", "") == "assistant":
                        for ct in getattr(item, "content", []) or []:
                            if getattr(ct, "type", "") == "output_text" and getattr(ct, "text", ""):
                                chunks.append(ct.text)
                if chunks:
                    return "".join(chunks).strip()
            except Exception:
                pass
            return "(no text output)"
        except Exception as e:
            log.exception("openai_chat_error")
            raise
