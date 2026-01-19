"""One-time magic-link invite codes.

Flow:
1) (Admin) Create an invite code for a Firebase UID (or phone number).
2) User clicks SMS link containing the code.
3) Frontend exchanges code -> Firebase custom token, then signs in with it.

The invite code is **single-use** and **expires**.
Uses Redis when REDIS_URL is set, otherwise falls back to in-memory store.
"""

from __future__ import annotations

import os
import secrets
import threading
import time
from typing import Optional

try:
    import redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None  # type: ignore


def _default_ttl_seconds() -> int:
    # Default to 24 hours.
    try:
        return int(os.getenv("MAGIC_LINK_TTL_SECONDS", "86400"))
    except Exception:
        return 86400


class InMemoryInviteStore:
    def __init__(self):
        self._lock = threading.Lock()
        # code -> {"uid": str, "exp": int}
        self._data: dict[str, dict] = {}

    def create(self, uid: str, ttl_seconds: int) -> str:
        code = secrets.token_urlsafe(32)
        exp = int(time.time()) + max(1, int(ttl_seconds))
        with self._lock:
            self._data[code] = {"uid": uid, "exp": exp}
        return code

    def consume(self, code: str) -> Optional[str]:
        now = int(time.time())
        with self._lock:
            rec = self._data.get(code)
            if not rec:
                return None
            if rec.get("exp") and rec["exp"] < now:
                self._data.pop(code, None)
                return None
            # single-use
            self._data.pop(code, None)
            return rec.get("uid")


class InviteStore:
    def __init__(self):
        url = os.getenv("REDIS_URL")
        if url and redis:
            self.kind = "redis"
            self._r = redis.Redis.from_url(url, decode_responses=True)
        else:
            self.kind = "memory"
            self._r = InMemoryInviteStore()

    def create(self, uid: str, ttl_seconds: Optional[int] = None) -> tuple[str, int]:
        ttl = int(ttl_seconds or _default_ttl_seconds())
        ttl = max(1, ttl)
        code = secrets.token_urlsafe(32)
        if self.kind == "redis":
            key = f"ml:{code}"
            # Value is uid; expiry enforces TTL.
            self._r.set(key, uid, ex=ttl)
        else:
            code = self._r.create(uid, ttl)  # type: ignore[assignment]
        return code, ttl

    def consume(self, code: str) -> Optional[str]:
        code = (code or "").strip()
        if not code:
            return None

        if self.kind == "redis":
            key = f"ml:{code}"
            # Atomic-ish get+delete.
            pipe = self._r.pipeline()
            pipe.get(key)
            pipe.delete(key)
            uid, _ = pipe.execute()
            return uid or None
        return self._r.consume(code)  # type: ignore[return-value]


invites = InviteStore()
