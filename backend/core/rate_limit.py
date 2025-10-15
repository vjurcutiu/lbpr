
from __future__ import annotations

"""
Rate/usage limits with **per-user billing windows**.

What changed vs. previous logic
-------------------------------
- Window now refreshes based on each user's **payment (billing anchor) + 30 days**,
  *not* EOM+grace.
- **Free** plan never refreshes (usage is cumulative).
- One function for chat messages and one for upload tokens:
    - add_message(uid) -> (ok, used, cap)
    - add_upload_tokens(uid, n_tokens) -> (ok, used, cap)
- Safe to run without Redis (falls back to in-memory store for local dev/tests).

Storage model (Redis)
---------------------
Keys (all stringified):
- rl:{uid}:meta (HASH):
    plan                 -> "free" | "pro" | ...   (default: "free")
    cap_messages         -> int                    (default from env or sensible default)
    cap_upload_tokens    -> int                    (default from env or sensible default)
    billing_anchor_ts    -> unix ts (seconds)      (first payment time OR last renewal time)
    free_no_refresh      -> "1" | "0"              (default "1" for plan == "free")

- rl:{uid}:usage:{period_id} (HASH) — period_id depends on plan:
    messages             -> int (used so far in period)
    upload_tokens        -> int (used so far in period)
    period_start_ts      -> unix ts (for visibility)
    period_end_ts        -> unix ts (for visibility)

For **free** users, period_id is always "infinite" (no reset).

Admin helpers (optional; call from a staff route/CLI):
- set_caps(uid, cap_messages=None, cap_upload_tokens=None)
- set_billing_anchor(uid, anchor_ts)
- set_plan(uid, plan)  # if plan == "free" we automatically set free_no_refresh=1

Environment overrides
---------------------
- LIMITS_DEFAULT_MESSAGES           (default: 1000)
- LIMITS_DEFAULT_UPLOAD_TOKENS      (default: 200_000)  # ~150k words
- LIMITS_FREE_NO_REFRESH            (default: "1")
- LIMITS_WINDOW_DAYS                (default: 30)

This module is intentionally self-contained and does not require core.config.
"""

import asyncio
import os
import time
from typing import Tuple, Optional, Dict, Any

# Prefer our existing redis client helper (async), but fall back to local memory
try:
    from core.redis_utils import get_client as _get_client  # returns redis.asyncio.Redis
except Exception:  # pragma: no cover
    _get_client = None

# --------- In-memory fallback (dev/test) -------------------------------------

class _Mem:
    def __init__(self):
        self._h: Dict[str, Dict[str, str]] = {}

    # mimic some Redis hash ops we use
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
        # last-ditch: keep app running in dev
        return _mem


# --------- Config helpers ----------------------------------------------------

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").replace("_", "")) if os.getenv(name) else default
    except Exception:
        return default

DEFAULT_CAP_MESSAGES = _env_int("LIMITS_DEFAULT_MESSAGES", 1000)
DEFAULT_CAP_UPLOAD_TOKENS = _env_int("LIMITS_DEFAULT_UPLOAD_TOKENS", 200_000)
WINDOW_DAYS = _env_int("LIMITS_WINDOW_DAYS", 30)
FREE_NO_REFRESH_DEFAULT = os.getenv("LIMITS_FREE_NO_REFRESH", "1") == "1"


# --------- Period math -------------------------------------------------------

def _now() -> int:
    return int(time.time())

def _period_id_for_user(meta: Dict[str, str], now_ts: Optional[int] = None) -> Tuple[str, int, int]:
    """
    Returns (period_id, start_ts, end_ts).

    - For plan=='free' (or free_no_refresh=='1'): returns ('infinite', 0, 2**31-1).
    - Else: compute floor((now - anchor)/WINDOW), with WINDOW=WINDOW_DAYS.
    """
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
        # Initialize anchor to *now* (first payment time / first seen)
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
        # initialize defaults
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


# --------- Public API --------------------------------------------------------

async def add_message(uid: str) -> Tuple[bool, int, int]:
    """
    Increment 1 message for the current user's active window.
    Returns (ok, used, cap). If `ok` is False, the increment is NOT applied.
    """
    r = await _redis()
    meta = await _load_meta(uid)
    cap = int(meta.get("cap_messages") or DEFAULT_CAP_MESSAGES)
    period_id, start, end = _period_id_for_user(meta)
    ukey = await _usage_key(uid, period_id)

    usage = await _get_usage(r, ukey)
    used = int(usage.get("messages") or "0")

    # Enforce BEFORE increment
    if used + 1 > cap:
        return (False, used, cap)

    # Apply increment and update period bounds for visibility
    used = await r.hincrby(ukey, "messages", 1)
    await r.hset(ukey, mapping={"period_start_ts": str(start), "period_end_ts": str(end)})
    return (True, used, cap)


async def add_upload_tokens(uid: str, n_tokens: int) -> Tuple[bool, int, int]:
    """
    Increment upload token usage for the current user's active window.
    Returns (ok, used, cap). If `ok` is False, the increment is NOT applied.
    """
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


# --------- Admin helpers (optional) -----------------------------------------

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
    # If plan is free, we force no refresh unless specifically disabled by admin
    if plan == "free":
        mapping["free_no_refresh"] = "1"
    await r.hset(key, mapping=mapping)
