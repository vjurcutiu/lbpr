from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from .models import AppendMessageIn, ChatMessageOut, ConversationOut, CreateConversationIn, UpdateConversationIn
from .service import (
    ConversationNamespaceMismatchError,
    ConversationNotFoundError,
    append_message,
    create_conversation,
    delete_conversation,
    list_conversations,
    list_messages,
    rename_conversation,
)

router = APIRouter(prefix="/v1/chat", tags=["chat-history"])


@router.get("/conversations", response_model=List[ConversationOut])
def get_conversations(
    ns: str = Query(..., min_length=1, max_length=256),
    user: SessionOut = Depends(get_current_user),
):
    return list_conversations(user.uid, ns)


@router.post("/conversations", response_model=ConversationOut)
def post_conversation(payload: CreateConversationIn, user: SessionOut = Depends(get_current_user)):
    try:
        return create_conversation(
            user.uid,
            ns=payload.ns,
            title=payload.title,
            tenant_id=payload.tenant_id,
            conversation_id=payload.id,
            created_at=payload.created_at,
            updated_at=payload.updated_at,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
def patch_conversation(conversation_id: str, payload: UpdateConversationIn, user: SessionOut = Depends(get_current_user)):
    try:
        return rename_conversation(user.uid, ns=payload.ns, conversation_id=conversation_id, title=payload.title)
    except ConversationNamespaceMismatchError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/conversations/{conversation_id}")
def remove_conversation(
    conversation_id: str,
    ns: str = Query(..., min_length=1, max_length=256),
    user: SessionOut = Depends(get_current_user),
):
    try:
        delete_conversation(user.uid, ns=ns, conversation_id=conversation_id)
        return {"ok": True}
    except ConversationNamespaceMismatchError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/conversations/{conversation_id}/messages", response_model=List[ChatMessageOut])
def get_conversation_messages(
    conversation_id: str,
    ns: str = Query(..., min_length=1, max_length=256),
    user: SessionOut = Depends(get_current_user),
):
    try:
        return list_messages(user.uid, ns=ns, conversation_id=conversation_id)
    except ConversationNamespaceMismatchError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/conversations/{conversation_id}/messages", response_model=ChatMessageOut)
def post_conversation_message(
    conversation_id: str,
    payload: AppendMessageIn,
    user: SessionOut = Depends(get_current_user),
):
    try:
        return append_message(
            user.uid,
            ns=payload.ns,
            conversation_id=conversation_id,
            role=payload.role,
            content=payload.content,
            created_at=payload.created_at,
            citations=payload.citations,
            trace_id=payload.trace_id,
            request_id=payload.request_id,
        )
    except ConversationNamespaceMismatchError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except ConversationNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
