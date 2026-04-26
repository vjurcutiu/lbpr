# backend/features/rag/adapters/openai_chat.py
from __future__ import annotations

import os
import asyncio
import time
from dataclasses import dataclass
from typing import List, Dict, Optional, Any

from core.business_metrics import record_openai_duration
from core.tokenizer import count_tokens

try:
    from openai import OpenAI  # official SDK (>=1.0)
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4-mini")


@dataclass
class OpenAIUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    approximate: bool = False


@dataclass
class OpenAITextResponse:
    text: str
    usage: OpenAIUsage
    operation: str


def _usage_from_responses(resp: Any, *, fallback_text: str, prompt_text: str) -> OpenAIUsage:
    usage = getattr(resp, "usage", None)
    input_tokens = getattr(usage, "input_tokens", None) if usage is not None else None
    output_tokens = getattr(usage, "output_tokens", None) if usage is not None else None
    total_tokens = getattr(usage, "total_tokens", None) if usage is not None else None
    if isinstance(usage, dict):
        input_tokens = usage.get("input_tokens", input_tokens)
        output_tokens = usage.get("output_tokens", output_tokens)
        total_tokens = usage.get("total_tokens", total_tokens)
    prompt_tokens = int(input_tokens or 0)
    completion_tokens = int(output_tokens or 0)
    total = int(total_tokens or 0)
    if prompt_tokens > 0 or completion_tokens > 0 or total > 0:
        if total <= 0:
            total = prompt_tokens + completion_tokens
        return OpenAIUsage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, total_tokens=total, approximate=False)
    prompt_est = count_tokens(prompt_text)
    completion_est = count_tokens(fallback_text) if fallback_text else 0
    return OpenAIUsage(prompt_tokens=prompt_est, completion_tokens=completion_est, total_tokens=prompt_est + completion_est, approximate=True)


def _usage_from_chat_completions(resp: Any, *, fallback_text: str, prompt_text: str) -> OpenAIUsage:
    usage = getattr(resp, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", None) if usage is not None else None
    completion_tokens = getattr(usage, "completion_tokens", None) if usage is not None else None
    total_tokens = getattr(usage, "total_tokens", None) if usage is not None else None
    if isinstance(usage, dict):
        prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
        completion_tokens = usage.get("completion_tokens", completion_tokens)
        total_tokens = usage.get("total_tokens", total_tokens)
    prompt = int(prompt_tokens or 0)
    completion = int(completion_tokens or 0)
    total = int(total_tokens or 0)
    if prompt > 0 or completion > 0 or total > 0:
        if total <= 0:
            total = prompt + completion
        return OpenAIUsage(prompt_tokens=prompt, completion_tokens=completion, total_tokens=total, approximate=False)
    prompt_est = count_tokens(prompt_text)
    completion_est = count_tokens(fallback_text) if fallback_text else 0
    return OpenAIUsage(prompt_tokens=prompt_est, completion_tokens=completion_est, total_tokens=prompt_est + completion_est, approximate=True)

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
    def generate_with_usage(
        self,
        *,
        system: str,
        user: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> OpenAITextResponse:
        """Synchronous text generation with best-effort usage accounting."""
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.extend(_normalize_history(history))
        messages.append({"role": "user", "content": user})
        prompt_text = "\n\n".join(f"{m['role']}: {m['content']}" for m in messages)

        t0 = time.perf_counter()
        try:
            resp = self.client.responses.create(
                model=self.model,
                instructions=system or None,
                input=[{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"],
            )
            text = getattr(resp, "output_text", None)
            if not text:
                text = "".join(
                    [getattr(item, "content", "") if hasattr(item, "content") else "" for item in getattr(resp, "output", [])]
                )
            record_openai_duration(operation="responses.create", dur_ms=(time.perf_counter() - t0) * 1000, status="ok")
            return OpenAITextResponse(
                text=text or "",
                usage=_usage_from_responses(resp, fallback_text=text or "", prompt_text=prompt_text),
                operation="responses.create",
            )
        except Exception:
            record_openai_duration(operation="responses.create", dur_ms=(time.perf_counter() - t0) * 1000, status="error")

        t1 = time.perf_counter()
        try:
            cc = self.client.chat.completions.create(  # type: ignore[attr-defined]
                model=self.model,
                messages=messages,
                temperature=0.2,
            )
            text = cc.choices[0].message.content or ""
            record_openai_duration(operation="chat.completions.create", dur_ms=(time.perf_counter() - t1) * 1000, status="ok")
            return OpenAITextResponse(
                text=text,
                usage=_usage_from_chat_completions(cc, fallback_text=text, prompt_text=prompt_text),
                operation="chat.completions.create",
            )
        except Exception:
            record_openai_duration(operation="chat.completions.create", dur_ms=(time.perf_counter() - t1) * 1000, status="error")
            raise

    def generate(
        self,
        *,
        system: str,
        user: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        return self.generate_with_usage(system=system, user=user, history=history).text

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
