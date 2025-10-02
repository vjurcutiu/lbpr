# features/auth/sessions.py
from __future__ import annotations
import os, time, secrets, threading
from typing import Optional, Dict, Any
from features.auth.models import SessionOut

class InMemoryStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._data: dict[str, dict] = {}  # sid -> {"user": SessionOut.dict(), "exp": int}

    def get(self, sid: str) -> Optional[dict]:
        with self._lock:
            rec = self._data.get(sid)
            if not rec:
                return None
            if rec["exp"] and rec["exp"] < int(time.time()):
                del self._data[sid]
                return None
            return rec

    def set(self, sid: str, payload: Dict[str, Any], ttl_seconds: int):
        exp = int(time.time()) + ttl_seconds if ttl_seconds else 0
        with self._lock:
            self._data[sid] = {**payload, "exp": exp}

    def update_fields(self, sid: str, fields: Dict[str, Any]):
        with self._lock:
            rec = self._data.get(sid)
            if not rec:
                return
            user = rec.get("user") or {}
            user.update({k: v for k, v in fields.items() if v is not None})
            rec["user"] = user
            self._data[sid] = rec

    def delete(self, sid: str):
        with self._lock:
            self._data.pop(sid, None)

try:
    import redis  # type: ignore
except Exception:
    redis = None  # pragma: no cover

class SessionStore:
    def __init__(self):
        url = os.getenv("REDIS_URL")
        if url and redis:
            self.kind = "redis"
            self._r = redis.Redis.from_url(url, decode_responses=True)
        else:
            self.kind = "memory"
            self._r = InMemoryStore()

    def create(self, user: SessionOut, ttl_seconds: int) -> str:
        sid = secrets.token_urlsafe(32)
        if self.kind == "redis":
            key = f"s:{sid}"
            self._r.hset(key, mapping={
                "uid": user.uid,
                "email": user.email or "",
                "name": user.name or "",
                "picture": user.picture or "",
            })
            if ttl_seconds:
                self._r.expire(key, ttl_seconds)
        else:
            self._r.set(sid, {"user": user.model_dump()}, ttl_seconds)
        return sid

    def get_user(self, sid: str) -> Optional[SessionOut]:
        if self.kind == "redis":
            data = self._r.hgetall(f"s:{sid}")
            if not data:
                return None
            return SessionOut(
                uid=data.get("uid", ""),
                email=data.get("email") or None,
                name=data.get("name") or None,
                picture=data.get("picture") or None,
            )
        rec = self._r.get(sid)
        if not rec:
            return None
        return SessionOut(**rec["user"])

    def update_user(self, sid: str, **fields):
        if self.kind == "redis":
            key = f"s:{sid}"
            # Only include provided, non-None keys and coerce to strings
            mapping = {}
            for k in ("email", "name", "picture"):
                if k in fields and fields[k] is not None:
                    mapping[k] = str(fields[k])
            if mapping:
                try:
                    self._r.hset(key, mapping=mapping)
                except Exception:
                    pass
        else:
            self._r.update_fields(sid, {k: v for k, v in fields.items() if v is not None})

    def revoke(self, sid: str):
        if self.kind == "redis":
            self._r.delete(f"s:{sid}")
        else:
            self._r.delete(sid)

sessions = SessionStore()
