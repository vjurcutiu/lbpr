
from __future__ import annotations
import asyncio
import os
import time
from typing import Tuple, Optional, Dict, Any

try:
    from core.redis_utils import get_client as _get_client  # returns redis.asyncio.Redis
except Exception:
    _get_client = None

class _Mem:
    def __init__(self):
        self._h: Dict[str, Dict[str, str]] = {}
    async def hgetall(self, key: str) -> Dict[str, str]:
        return dict(self._h.get(key, {}))
    async def hset(self, key: str, mapping: Dict[str, Any]):
        d = self._h.setdefault(key, {})
        for k, v in mapping.items():
            d[k] = str(v)
    async def hincrby(self, key: str, field: str, amount: int = 1) -> int:
        d = self._h.setdefault(key, {})
        cur = int(d.get(field) or "0")
        cur += int(amount)
        d[field] = str(cur)
        return cur

_mem = _Mem()

async def _redis():
    if _get_client is None:
        return _mem
    try:
        return await _get_client()
    except Exception:
        return _mem

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").replace("_", "")) if os.getenv(name) else default
    except Exception:
        return default

DEFAULT_CAP_MESSAGES = _env_int("LIMITS_DEFAULT_MESSAGES", 1000)
DEFAULT_CAP_UPLOAD_TOKENS = _env_int("LIMITS_DEFAULT_UPLOAD_TOKENS", 200_000)
WINDOW_DAYS = _env_int("LIMITS_WINDOW_DAYS", 30)
FREE_NO_REFRESH_DEFAULT = os.getenv("LIMITS_FREE_NO_REFRESH", "1") == "1"

def _now() -> int:
    return int(time.time())

def _period_id_for_user(meta: Dict[str, str], now_ts: Optional[int] = None) -> Tuple[str, int, int]:
    now_ts = now_ts or _now()
    plan = (meta.get("plan") or "free").lower()
    free_no_refresh = (meta.get("free_no_refresh") == "1") or (plan == "free")
    if free_no_refresh:
        return ("infinite", 0, 2**31 - 1)
    try:
        anchor = int(meta.get("billing_anchor_ts") or "0")
    except Exception:
        anchor = 0
    if anchor <= 0:
        anchor = now_ts
    window = WINDOW_DAYS * 24 * 3600
    idx = max(0, (now_ts - anchor) // window)
    start = anchor + idx * window
    end = start + window
    return (f"{idx}", start, end)

async def _load_meta(uid: str) -> Dict[str, str]:
    r = await _redis()
    key = f"rl:{uid}:meta"
    meta = await r.hgetall(key)
    if not meta:
        meta = {
            "plan": "free",
            "cap_messages": str(DEFAULT_CAP_MESSAGES),
            "cap_upload_tokens": str(DEFAULT_CAP_UPLOAD_TOKENS),
            "billing_anchor_ts": "0",
            "free_no_refresh": "1" if FREE_NO_REFRESH_DEFAULT else "0",
        }
        await r.hset(key, mapping=meta)
    return meta

async def _usage_key(uid: str, period_id: str) -> str:
    return f"rl:{uid}:usage:{period_id}"

async def _get_usage(r, key: str) -> Dict[str, str]:
    return await r.hgetall(key)

async def add_message(uid: str) -> Tuple[bool, int, int]:
    r = await _redis()
    meta = await _load_meta(uid)
    cap = int(meta.get("cap_messages") or DEFAULT_CAP_MESSAGES)
    period_id, start, end = _period_id_for_user(meta)
    ukey = await _usage_key(uid, period_id)
    usage = await _get_usage(r, ukey)
    used = int(usage.get("messages") or "0")
    if used + 1 > cap:
        return (False, used, cap)
    used = await r.hincrby(ukey, "messages", 1)
    await r.hset(ukey, mapping={"period_start_ts": str(start), "period_end_ts": str(end)})
    return (True, used, cap)

async def add_upload_tokens(uid: str, n_tokens: int) -> Tuple[bool, int, int]:
    r = await _redis()
    meta = await _load_meta(uid)
    cap = int(meta.get("cap_upload_tokens") or DEFAULT_CAP_UPLOAD_TOKENS)
    period_id, start, end = _period_id_for_user(meta)
    ukey = await _usage_key(uid, period_id)
    usage = await _get_usage(r, ukey)
    used = int(usage.get("upload_tokens") or "0")
    if used + max(0, int(n_tokens)) > cap:
        return (False, used, cap)
    used = await r.hincrby(ukey, "upload_tokens", max(0, int(n_tokens)))
    await r.hset(ukey, mapping={"period_start_ts": str(start), "period_end_ts": str(end)})
    return (True, used, cap)

async def set_caps(uid: str, *, cap_messages: Optional[int] = None, cap_upload_tokens: Optional[int] = None) -> None:
    r = await _redis()
    key = f"rl:{uid}:meta"
    mapping = {}
    if cap_messages is not None:
        mapping["cap_messages"] = str(int(cap_messages))
    if cap_upload_tokens is not None:
        mapping["cap_upload_tokens"] = str(int(cap_upload_tokens))
    if mapping:
        await r.hset(key, mapping=mapping)

async def set_billing_anchor(uid: str, anchor_ts: int) -> None:
    r = await _redis()
    key = f"rl:{uid}:meta"
    await r.hset(key, mapping={"billing_anchor_ts": str(int(anchor_ts))})

async def set_plan(uid: str, plan: str) -> None:
    r = await _redis()
    key = f"rl:{uid}:meta"
    plan = (plan or "free").lower()
    mapping = {"plan": plan}
    if plan == "free":
        mapping["free_no_refresh"] = "1"
    await r.hset(key, mapping=mapping)

# Compatibility helpers expected by older modules:
async def reset_usage_current_window(uid: str) -> None:
    """
    Legacy compatibility.
    - For paid plans, clears counters in the *current* window.
    - For free plans (no refresh), this is a NO-OP to respect product rules.
    """
    r = await _redis()
    meta = await _load_meta(uid)
    period_id, start, end = _period_id_for_user(meta)
    if period_id == "infinite":
        return
    ukey = await _usage_key(uid, period_id)
    await r.hset(ukey, mapping={"messages": "0", "upload_tokens": "0", "period_start_ts": str(start), "period_end_ts": str(end)})

async def usage_snapshot(uid: str) -> Dict[str, Any]:
    r = await _redis()
    meta = await _load_meta(uid)
    period_id, start, end = _period_id_for_user(meta)
    ukey = await _usage_key(uid, period_id)
    usage = await _get_usage(r, ukey)
    return {
        "uid": uid,
        "plan": meta.get("plan", "free"),
        "free_no_refresh": meta.get("free_no_refresh", "1") == "1",
        "cap_messages": int(meta.get("cap_messages") or DEFAULT_CAP_MESSAGES),
        "cap_upload_tokens": int(meta.get("cap_upload_tokens") or DEFAULT_CAP_UPLOAD_TOKENS),
        "period_id": period_id,
        "period_start_ts": int(start),
        "period_end_ts": int(end),
        "messages_used": int(usage.get("messages") or 0),
        "upload_tokens_used": int(usage.get("upload_tokens") or 0),
    }
