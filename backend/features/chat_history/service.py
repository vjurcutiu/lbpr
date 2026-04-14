from __future__ import annotations

import os
import threading
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any, Optional
from uuid import uuid4

from .models import ChatMessageOut, ConversationOut

ROOT_COLLECTION = "customers"

_MEM_LOCK = threading.Lock()
_MEM_CONVERSATIONS: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
_MEM_MESSAGES: dict[tuple[str, str, str], list[dict[str, Any]]] = {}


class ConversationNotFoundError(FileNotFoundError):
    pass


class ConversationNamespaceMismatchError(PermissionError):
    pass


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _iso_to_datetime(value: str) -> datetime:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _parse_or_now(value: Optional[str]) -> str:
    if not value:
        return _now_iso()
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except Exception:
        return _now_iso()


def _get_firestore_handles():
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import firestore  # type: ignore
    except Exception:
        return None, None

    try:
        if not getattr(firebase_admin, "_apps", None):
            return None, None
        return firestore.client(), firestore
    except Exception:
        return None, None


def _conversation_ref(db, uid: str, conversation_id: str):
    return db.collection(ROOT_COLLECTION).document(uid).collection("conversations").document(conversation_id)


def _message_dict(data: dict[str, Any]) -> dict[str, Any]:
    out = {
        "role": str(data.get("role") or "system"),
        "content": str(data.get("content") or ""),
        "created_at": _parse_or_now(data.get("created_at")),
        "citations": deepcopy(list(data.get("citations") or [])),
        "trace_id": data.get("trace_id") or None,
        "request_id": data.get("request_id") or None,
    }
    return out


def _conversation_dict(conversation_id: str, ns: str, data: dict[str, Any]) -> dict[str, Any]:
    created_at = _parse_or_now(data.get("created_at"))
    updated_at = _parse_or_now(data.get("updated_at") or created_at)
    return {
        "id": conversation_id,
        "ns": str(ns),
        "title": str(data.get("title") or "New chat").strip() or "New chat",
        "tenant_id": str(data.get("tenant_id") or "tenant_demo"),
        "created_at": created_at,
        "updated_at": updated_at,
    }


def list_conversations(uid: str, ns: str, *, limit: int = 200) -> list[ConversationOut]:
    db, fs = _get_firestore_handles()
    if db is not None:
        rows: list[dict[str, Any]] = []
        try:
            q = (
                db.collection(ROOT_COLLECTION)
                .document(uid)
                .collection("conversations")
                .where("ns", "==", ns)
                .order_by("updated_at_ts", direction=fs.Query.DESCENDING)
                .limit(int(limit))
            )
            for doc in q.stream():
                rows.append(_conversation_dict(doc.id, ns, doc.to_dict() or {}))
        except Exception:
            q = (
                db.collection(ROOT_COLLECTION)
                .document(uid)
                .collection("conversations")
                .where("ns", "==", ns)
                .limit(int(limit))
            )
            for doc in q.stream():
                rows.append(_conversation_dict(doc.id, ns, doc.to_dict() or {}))
            rows.sort(key=lambda x: x["updated_at"], reverse=True)
        return [ConversationOut(**row) for row in rows]

    key = (uid, ns)
    with _MEM_LOCK:
        rows = list((_MEM_CONVERSATIONS.get(key) or {}).values())
    rows = sorted(rows, key=lambda x: x["updated_at"], reverse=True)[:limit]
    return [ConversationOut(**deepcopy(row)) for row in rows]


def create_conversation(
    uid: str,
    *,
    ns: str,
    title: str,
    tenant_id: str = "tenant_demo",
    conversation_id: Optional[str] = None,
    created_at: Optional[str] = None,
    updated_at: Optional[str] = None,
) -> ConversationOut:
    conversation_id = str(conversation_id or uuid4())
    created_at = _parse_or_now(created_at)
    updated_at = _parse_or_now(updated_at or created_at)
    data = {
        "ns": ns,
        "title": str(title or "New chat").strip() or "New chat",
        "tenant_id": tenant_id or "tenant_demo",
        "created_at": created_at,
        "updated_at": updated_at,
    }

    db, fs = _get_firestore_handles()
    if db is not None:
        _conversation_ref(db, uid, conversation_id).set(
            {
                **data,
                "created_at_ts": _iso_to_datetime(created_at),
                "updated_at_ts": _iso_to_datetime(updated_at),
            },
            merge=True,
        )
        return ConversationOut(id=conversation_id, **data)

    key = (uid, ns)
    row = {"id": conversation_id, **data}
    with _MEM_LOCK:
        bucket = _MEM_CONVERSATIONS.setdefault(key, {})
        existing = bucket.get(conversation_id)
        if existing:
            row["created_at"] = existing.get("created_at") or created_at
            if existing.get("updated_at") and existing["updated_at"] > row["updated_at"]:
                row["updated_at"] = existing["updated_at"]
        bucket[conversation_id] = deepcopy(row)
        _MEM_MESSAGES.setdefault((uid, ns, conversation_id), [])
    return ConversationOut(**row)


def _get_conversation(uid: str, ns: str, conversation_id: str) -> dict[str, Any]:
    db, fs = _get_firestore_handles()
    if db is not None:
        snap = _conversation_ref(db, uid, conversation_id).get()
        if not snap.exists:
            raise ConversationNotFoundError("Conversation not found")
        data = snap.to_dict() or {}
        if str(data.get("ns") or "") != ns:
            raise ConversationNamespaceMismatchError("Conversation namespace mismatch")
        return _conversation_dict(conversation_id, ns, data)

    key = (uid, ns)
    with _MEM_LOCK:
        row = deepcopy((_MEM_CONVERSATIONS.get(key) or {}).get(conversation_id))
    if not row:
        for (bucket_uid, bucket_ns), bucket in list(_MEM_CONVERSATIONS.items()):
            if bucket_uid == uid and conversation_id in bucket and bucket_ns != ns:
                raise ConversationNamespaceMismatchError("Conversation namespace mismatch")
        raise ConversationNotFoundError("Conversation not found")
    return row


def rename_conversation(uid: str, *, ns: str, conversation_id: str, title: str) -> ConversationOut:
    current = _get_conversation(uid, ns, conversation_id)
    updated_at = _now_iso()
    next_row = {**current, "title": str(title or current["title"]).strip() or current["title"], "updated_at": updated_at}

    db, fs = _get_firestore_handles()
    if db is not None:
        _conversation_ref(db, uid, conversation_id).set(
            {
                "title": next_row["title"],
                "updated_at": updated_at,
                "updated_at_ts": _iso_to_datetime(updated_at),
            },
            merge=True,
        )
        return ConversationOut(**next_row)

    key = (uid, ns)
    with _MEM_LOCK:
        (_MEM_CONVERSATIONS.setdefault(key, {}))[conversation_id] = deepcopy(next_row)
    return ConversationOut(**next_row)


def list_messages(uid: str, *, ns: str, conversation_id: str, limit: int = 2000) -> list[ChatMessageOut]:
    _get_conversation(uid, ns, conversation_id)
    db, fs = _get_firestore_handles()
    if db is not None:
        rows: list[dict[str, Any]] = []
        messages_ref = _conversation_ref(db, uid, conversation_id).collection("messages")
        try:
            q = messages_ref.order_by("created_at_ts", direction=fs.Query.ASCENDING).limit(int(limit))
            for doc in q.stream():
                rows.append(_message_dict(doc.to_dict() or {}))
        except Exception:
            q = messages_ref.limit(int(limit))
            for doc in q.stream():
                rows.append(_message_dict(doc.to_dict() or {}))
            rows.sort(key=lambda x: x["created_at"] or "")
        return [ChatMessageOut(**row) for row in rows]

    key = (uid, ns, conversation_id)
    with _MEM_LOCK:
        rows = deepcopy(_MEM_MESSAGES.get(key) or [])
    rows.sort(key=lambda x: x.get("created_at") or "")
    return [ChatMessageOut(**row) for row in rows[:limit]]


def append_message(
    uid: str,
    *,
    ns: str,
    conversation_id: str,
    role: str,
    content: str,
    created_at: Optional[str] = None,
    citations: Optional[list[dict[str, Any]]] = None,
    trace_id: Optional[str] = None,
    request_id: Optional[str] = None,
) -> ChatMessageOut:
    conversation = _get_conversation(uid, ns, conversation_id)
    created_at = _parse_or_now(created_at)
    row = {
        "role": str(role or "system"),
        "content": str(content or ""),
        "created_at": created_at,
        "citations": deepcopy(list(citations or [])),
        "trace_id": trace_id or None,
        "request_id": request_id or None,
    }
    updated_at = created_at

    db, fs = _get_firestore_handles()
    if db is not None:
        ref = _conversation_ref(db, uid, conversation_id)
        ref.collection("messages").document(str(uuid4())).set(
            {
                **row,
                "created_at_ts": _iso_to_datetime(created_at),
            },
            merge=False,
        )
        ref.set(
            {
                "updated_at": updated_at,
                "updated_at_ts": _iso_to_datetime(updated_at),
                "title": conversation["title"],
                "ns": ns,
            },
            merge=True,
        )
        return ChatMessageOut(**row)

    convo_key = (uid, ns)
    msg_key = (uid, ns, conversation_id)
    with _MEM_LOCK:
        bucket = _MEM_MESSAGES.setdefault(msg_key, [])
        bucket.append(deepcopy(row))
        convos = _MEM_CONVERSATIONS.setdefault(convo_key, {})
        conv = deepcopy(convos.get(conversation_id) or conversation)
        conv["updated_at"] = updated_at
        convos[conversation_id] = conv
    return ChatMessageOut(**row)


def delete_conversation(uid: str, *, ns: str, conversation_id: str) -> None:
    _get_conversation(uid, ns, conversation_id)
    db, fs = _get_firestore_handles()
    if db is not None:
        ref = _conversation_ref(db, uid, conversation_id)
        while True:
            docs = list(ref.collection("messages").limit(200).stream())
            if not docs:
                break
            for doc in docs:
                doc.reference.delete()
        ref.delete()
        return

    convo_key = (uid, ns)
    msg_key = (uid, ns, conversation_id)
    with _MEM_LOCK:
        (_MEM_CONVERSATIONS.get(convo_key) or {}).pop(conversation_id, None)
        _MEM_MESSAGES.pop(msg_key, None)
