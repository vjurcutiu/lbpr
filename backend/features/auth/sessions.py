from __future__ import annotations
import os, time, secrets, threading
from typing import Optional, Dict, Any
from features.auth.models import SessionOut


class InMemoryStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._data: dict[str, dict] = {}  # sid -> {"user": SessionOut.dict(), "exp": int}
        self._user_sids: dict[str, set[str]] = {}

    def get(self, sid: str) -> Optional[dict]:
        with self._lock:
            rec = self._data.get(sid)
            if not rec:
                return None
            if rec["exp"] and rec["exp"] < int(time.time()):
                user = rec.get("user") or {}
                uid = str(user.get("uid") or "")
                self._remove_sid_from_user(uid, sid)
                del self._data[sid]
                return None
            return rec

    def set(self, sid: str, payload: Dict[str, Any], ttl_seconds: int):
        exp = int(time.time()) + ttl_seconds if ttl_seconds else 0
        with self._lock:
            self._data[sid] = {**payload, "exp": exp}
            user = payload.get("user") or {}
            uid = str(user.get("uid") or "")
            if uid:
                self._user_sids.setdefault(uid, set()).add(sid)

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
            rec = self._data.pop(sid, None)
            if rec:
                user = rec.get("user") or {}
                uid = str(user.get("uid") or "")
                self._remove_sid_from_user(uid, sid)

    def delete_user(self, uid: str) -> int:
        uid = str(uid or "")
        if not uid:
            return 0
        with self._lock:
            sids = list(self._user_sids.get(uid) or set())
            for sid in sids:
                self._data.pop(sid, None)
            self._user_sids.pop(uid, None)
            return len(sids)

    def _remove_sid_from_user(self, uid: str, sid: str) -> None:
        if not uid:
            return
        sids = self._user_sids.get(uid)
        if not sids:
            return
        sids.discard(sid)
        if not sids:
            self._user_sids.pop(uid, None)


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

    def _user_sessions_key(self, uid: str) -> str:
        return f"su:{uid}"

    def create(self, user: SessionOut, ttl_seconds: int) -> str:
        sid = secrets.token_urlsafe(32)
        if self.kind == "redis":
            key = f"s:{sid}"
            pipe = self._r.pipeline()
            pipe.hset(key, mapping={
                "uid": user.uid,
                "email": user.email or "",
                "name": user.name or "",
                "picture": user.picture or "",
                "phone_number": user.phone_number or "",
                "email_verified": "1" if (user.email_verified is True) else ("0" if user.email_verified is False else ""),
            })
            if ttl_seconds:
                pipe.expire(key, ttl_seconds)
            if user.uid:
                user_key = self._user_sessions_key(user.uid)
                pipe.sadd(user_key, sid)
                if ttl_seconds:
                    pipe.expire(user_key, ttl_seconds)
            pipe.execute()
        else:
            self._r.set(sid, {"user": user.model_dump()}, ttl_seconds)
        return sid

    def get_user(self, sid: str) -> Optional[SessionOut]:
        if self.kind == "redis":
            data = self._r.hgetall(f"s:{sid}")
            if not data:
                return None
            ev = data.get("email_verified")
            ev_val = None
            if ev == "1":
                ev_val = True
            elif ev == "0":
                ev_val = False
            return SessionOut(
                uid=data.get("uid", ""),
                email=data.get("email") or None,
                name=data.get("name") or None,
                picture=data.get("picture") or None,
                phone_number=data.get("phone_number") or None,
                email_verified=ev_val,
            )
        rec = self._r.get(sid)
        if not rec:
            return None
        return SessionOut(**rec["user"])

    def update_user(self, sid: str, **fields):
        if self.kind == "redis":
            key = f"s:{sid}"
            mapping = {}
            for k in ("email", "name", "picture", "phone_number", "email_verified"):
                if k in fields and fields[k] is not None:
                    v = fields[k]
                    if k == "email_verified":
                        v = "1" if v is True else "0" if v is False else ""
                    mapping[k] = str(v)
            if mapping:
                try:
                    self._r.hset(key, mapping=mapping)
                except Exception:
                    pass
        else:
            self._r.update_fields(sid, {k: v for k, v in fields.items() if v is not None})

    def revoke(self, sid: str):
        if self.kind == "redis":
            key = f"s:{sid}"
            try:
                uid = self._r.hget(key, "uid") or ""
            except Exception:
                uid = ""
            pipe = self._r.pipeline()
            pipe.delete(key)
            if uid:
                pipe.srem(self._user_sessions_key(uid), sid)
            pipe.execute()
        else:
            self._r.delete(sid)

    def revoke_user(self, uid: str) -> int:
        uid = str(uid or "").strip()
        if not uid:
            return 0
        if self.kind == "redis":
            user_key = self._user_sessions_key(uid)
            try:
                sids = set(self._r.smembers(user_key) or [])
            except Exception:
                sids = set()

            # Fallback for sessions created before the per-user index existed.
            if not sids:
                try:
                    for raw_key in self._r.scan_iter(match="s:*"):
                        try:
                            if (self._r.hget(raw_key, "uid") or "") == uid:
                                sids.add(str(raw_key).split(":", 1)[1])
                        except Exception:
                            continue
                except Exception:
                    pass

            if not sids:
                return 0
            pipe = self._r.pipeline()
            for sid in sids:
                pipe.delete(f"s:{sid}")
            pipe.delete(user_key)
            pipe.execute()
            return len(sids)
        return self._r.delete_user(uid)


sessions = SessionStore()
