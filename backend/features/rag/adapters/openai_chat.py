# backend/features/rag/adapters/openai_chat.py
from __future__ import annotations

import os
import asyncio
from typing import List, Dict, Optional, Any

try:
    from openai import OpenAI  # official SDK (>=1.0)
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-mini")

def _normalize_history(history: Optional[List[Dict[str, str]]]) -> List[Dict[str, str]]:
    if not history:
        return []
    out: List[Dict[str, str]] = []
    for t in history:
        role = t.get("role") or "user"
        content = t.get("content") or ""
        if role not in {"system", "user", "assistant"}:
            role = "user"
        out.append({"role": role, "content": content})
    return out

class OpenAIChat:
    """Thin adapter used by our FastAPI routes.


    Uses the **Responses API** (preferred) and falls back to Chat Completions if needed.

    Keep this class dependency-light; callers should never import the OpenAI SDK directly.
    """

    def __init__(self, *, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        if OpenAI is None:
            raise RuntimeError("openai-python SDK is not installed")
        self.client = OpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY"))
        self.model = model or DEFAULT_MODEL

    # ---------- public APIs ----------
    def generate(
        self,
        *,
        system: str,
        user: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """Synchronous text generation.

        Prefers the Responses API; falls back to Chat Completions for older deployments.
        """
        # Compose messages
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.extend(_normalize_history(history))
        messages.append({"role": "user", "content": user})

        # Try Responses API first
        try:
            resp = self.client.responses.create(
                model=self.model,
                instructions=system or None,
                input=[{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"],
            )
            # responses API consolidates output; easiest is output_text
            text = getattr(resp, "output_text", None)
            if not text:
                # best-effort extract
                text = "".join(
                    [getattr(item, "content", "") if hasattr(item, "content") else "" for item in getattr(resp, "output", [])]
                )
            return text or ""
        except Exception:
            # Fall back to Chat Completions for environments pinned to older SDKs
            pass

        # Fallback: Chat Completions
        cc = self.client.chat.completions.create(  # type: ignore[attr-defined]
            model=self.model,
            messages=messages,
            temperature=0.2,
        )
        return cc.choices[0].message.content or ""

    async def simple_answer(
        self,
        message: str,
        *,
        history: Optional[List[Dict[str, str]]] = None,
        system: str = "You are a concise, helpful assistant.",
    ) -> str:
        """Async helper used by FastAPI endpoints.

        Delegates to .generate(...) in a thread to avoid blocking the event loop.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, lambda: self.generate(system=system, user=message, history=history)
        )
