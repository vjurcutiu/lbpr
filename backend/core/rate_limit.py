# backend/core/rate_limit.py
from __future__ import annotations
import time, calendar, datetime as dt, logging
from typing import Tuple, Optional
from core.redis_utils import get_client
from core.config import settings

log = logging.getLogger("limits")

def month_key(now: Optional[dt.datetime] = None) -> Tuple[str, int]:
    now = now or dt.datetime.utcnow()
    ym = now.strftime("%Y%m")
    # Expire at end-of-month + 2 days buffer (UTC)
    last_day = calendar.monthrange(now.year, now.month)[1]
    end = dt.datetime(now.year, now.month, last_day, 23, 59, 59, tzinfo=dt.timezone.utc)
    expire_at = int(end.timestamp()) + 2*24*3600
    return ym, expire_at

# Single Lua script to atomically check + increment a field capped by a limit.
# Returns: {allowed:int, new_value:int}
LUA_CHECK_INCR = """local key     = KEYS[1]
local field   = ARGV[1]
local inc     = tonumber(ARGV[2])
local cap     = tonumber(ARGV[3])
local expat   = tonumber(ARGV[4])

local cur = redis.call('HGET', key, field)
if not cur then cur = 0 else cur = tonumber(cur) end
local new = cur + inc
if new > cap then
  return {0, cur}
end
redis.call('HINCRBY', key, field, inc)
-- ensure expiry each time
local ttl = redis.call('TTL', key)
if not ttl or ttl < 0 then
  redis.call('EXPIREAT', key, expat)
end
return {1, new}
"""

async def _check_and_add(uid: str, metric: str, inc: int, cap: int) -> Tuple[bool, int]:
    r = await get_client()
    ym, expat = month_key()
    key = f"usage:{uid}:{ym}"
    try:
        res = await r.eval(LUA_CHECK_INCR, 1, key, metric, str(inc), str(cap), str(expat))
        allowed, newv = int(res[0]), int(res[1])
        return (allowed == 1), newv
    except Exception:
        log.exception("redis_eval_failed", uid=uid, metric=metric)
        # Fail-OPEN: allow but log (prevents hard lockout if Redis hiccups)
        return True, -1

async def add_message(uid: str) -> Tuple[bool, int, int]:
    from core.plan import get_user_plan, plan_limits
    plan = await get_user_plan(uid)
    caps = plan_limits(plan)
    ok, newv = await _check_and_add(uid, "messages", 1, caps["messages"])
    log.info("usage_message_result", uid=uid, allowed=ok, value=newv, cap=caps["messages"])
    return ok, newv, caps["messages"]

# For uploads and /ingest: increment token budget by N tokens
async def add_upload_tokens(uid: str, tokens: int) -> Tuple[bool, int, int]:
    from core.plan import get_user_plan, plan_limits
    plan = await get_user_plan(uid)
    caps = plan_limits(plan)
    ok, newv = await _check_and_add(uid, "upload_tokens", tokens, caps["upload_tokens"])
    log.info("usage_upload_tokens_result", uid=uid, added=tokens, allowed=ok, value=newv, cap=caps["upload_tokens"])
    return ok, newv, caps["upload_tokens"]

# Fetch current usage snapshot
async def read_usage(uid: str) -> dict:
    r = await get_client()
    ym, _ = month_key()
    key = f"usage:{uid}:{ym}"
    data = await r.hgetall(key)
    return {k:int(v) for k,v in data.items() if v is not None and str(v).isdigit()}

# NEW: reset current month's usage (called when upgrading FREE -> PRO)
async def reset_usage_current_window(uid: str) -> None:
    """Hard reset the current month usage hash for the given user."""
    r = await get_client()
    ym, _ = month_key()
    key = f"usage:{uid}:{ym}"
    try:
        await r.delete(key)
        log.info("usage_reset", uid=uid, window=ym)
    except Exception:
        log.exception("usage_reset_failed", uid=uid, window=ym)
