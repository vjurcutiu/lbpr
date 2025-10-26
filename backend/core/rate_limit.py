from __future__ import annotations
import os, time, logging, inspect
from typing import Tuple, Optional, Dict, Any
try:
    from core.redis_utils import get_client as _get_client
except Exception:
    _get_client = None  # type: ignore
log = logging.getLogger("limits")
def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").replace("_", "")) if os.getenv(name) else default
    except Exception:
        return default
DEFAULT_CAP_MESSAGES = _env_int("LIMITS_DEFAULT_MESSAGES", 1000)
DEFAULT_CAP_UPLOAD_TOKENS = _env_int("LIMITS_DEFAULT_UPLOAD_TOKENS", 200_000)
WINDOW_DAYS = _env_int("LIMITS_WINDOW_DAYS", 30)
FREE_NO_REFRESH_DEFAULT = os.getenv("LIMITS_FREE_NO_REFRESH", "1") == "1"
def _now() -> int: return int(time.time())
async def _redis():
    if _get_client is None:
        raise RuntimeError("Redis client is not available")
    client = _get_client()
    if inspect.isawaitable(client):
        client = await client
    return client
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
def _usage_key(uid: str, period_id: str) -> str:
    return f"rl:{uid}:usage:{period_id}"
LUA_CHECK_INCR = """
local key     = KEYS[1]
local field   = ARGV[1]
local inc     = tonumber(ARGV[2])
local cap     = tonumber(ARGV[3])
local pstart  = tostring(ARGV[4])
local pend    = tostring(ARGV[5])
local cur = redis.call('HGET', key, field)
if not cur then cur = 0 else cur = tonumber(cur) end
local newv = cur + inc
if newv > cap then
  return {0, cur}
end
redis.call('HINCRBY', key, field, inc)
redis.call('HSET', key, 'period_start_ts', pstart, 'period_end_ts', pend)
return {1, newv}
"""
async def _check_and_add(uid: str, metric: str, inc: int, cap: int, pstart: int, pend: int, period_id: str):
    try:
        r = await _redis()
        key = _usage_key(uid, period_id)
        res = await r.eval(LUA_CHECK_INCR, 1, key, metric, str(int(inc)), str(int(cap)), str(int(pstart)), str(int(pend)))
        allowed, newv = int(res[0]), int(res[1])
        if allowed == 1:
            log.info("limits_incr", extra={"uid": uid, "metric": metric, "inc": inc, "new_value": newv, "cap": cap, "period": period_id})
        else:
            log.info("limits_cap_reached", extra={"uid": uid, "metric": metric, "cur_value": newv, "cap": cap, "period": period_id})
        return (allowed == 1), newv
    except Exception as e:
        log.warning("limits_eval_failed_fail_open", extra={"uid": uid, "metric": metric, "error": str(e)})
        return True, -1
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
    mapping["free_no_refresh"] = "1" if plan == "free" else "0"
    await r.hset(key, mapping=mapping)
async def add_message(uid: str):
    meta = await _load_meta(uid)
    cap = int(meta.get("cap_messages") or DEFAULT_CAP_MESSAGES)
    period_id, start, end = _period_id_for_user(meta)
    ok, newv = await _check_and_add(uid, "messages", 1, cap, start, end, period_id)
    return ok, newv, cap
async def add_upload_tokens(uid: str, n_tokens: int):
    meta = await _load_meta(uid)
    cap = int(meta.get("cap_upload_tokens") or DEFAULT_CAP_UPLOAD_TOKENS)
    period_id, start, end = _period_id_for_user(meta)
    inc = max(0, int(n_tokens))
    ok, newv = await _check_and_add(uid, "upload_tokens", inc, cap, start, end, period_id)
    return ok, newv, cap
async def reset_usage_current_window(uid: str) -> None:
    r = await _redis()
    meta = await _load_meta(uid)
    period_id, start, end = _period_id_for_user(meta)
    if period_id == "infinite":
        return
    key = _usage_key(uid, period_id)
    await r.hset(key, mapping={
        "messages": "0",
        "upload_tokens": "0",
        "period_start_ts": str(start),
        "period_end_ts": str(end),
    })
async def usage_snapshot(uid: str):
    r = await _redis()
    meta = await _load_meta(uid)
    period_id, start, end = _period_id_for_user(meta)
    key = _usage_key(uid, period_id)
    usage = await r.hgetall(key)
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
