# backend/features/rag/contracts_router.py
from __future__ import annotations

import logging
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Request, Depends
from pydantic import BaseModel

# If auth deps exist in your project, keep the import. Otherwise, use a stub.
try:
    from features.auth.deps import get_current_user  # type: ignore
    from features.auth.models import SessionOut  # type: ignore
except Exception:  # local/dev fallback
    def get_current_user():
        return None
    class SessionOut(BaseModel):  # type: ignore
        uid: str = "dev"

# Use the OpenAI adapter if available
try:
    from .adapters.openai_chat import OpenAIChat  # type: ignore
except Exception:
    OpenAIChat = None  # type: ignore

router = APIRouter(prefix="/v1", tags=["RAG (Contracts)"])
log = logging.getLogger("rag.contracts")


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatTurn]] = None


class ChatResponse(BaseModel):
    answer: str


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request, user: SessionOut = Depends(get_current_user)):
    """Primary chat endpoint used by the frontend.

    When the LLM call fails, we intentionally return a 200 with an echo so the UI stays responsive.
    """
    USE_LLM = OpenAIChat is not None

    if USE_LLM:
        try:
            llm = OpenAIChat()
            history = [t.model_dump() for t in (req.history or [])]
            answer = await llm.simple_answer(
                req.message,
                history=history,
                system="You are a concise, helpful assistant for our RAG chat.",
            )
            if not answer:
                raise RuntimeError("empty LLM answer")
            return ChatResponse(answer=answer)
        except Exception:
            log.exception("chat_llm_error")  # keep parity with existing logs

    # Fallback echo so the UI still shows *something*
    return ChatResponse(answer=f"You said: {req.message}")
