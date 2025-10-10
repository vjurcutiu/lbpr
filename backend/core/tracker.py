from __future__ import annotations

import time
import logging
from typing import Optional, Dict, Any, List

from core.redis_utils import get_client

log = logging.getLogger("upload.tracker")

# Redis key helpers
def _job_key(job_id: str) -> str:
    return f"ut:job:{job_id}"

def _user_set(uid: str) -> str:
    return f"ut:user:{uid}:jobs"

# Public job schema (wire format for API/FE)
# {
#   "job_id": str,
#   "uid": str,
#   "filename": str,
#   "dataset": str,
#   "total_bytes": int,
#   "bytes": int,
#   "phase": str,       # receive|upload|ocr|extract|embed|upsert|complete|error
#   "pct": int,         # 0..100 best-effort
#   "status": str,      # running|done|error
#   "error": Optional[str],
#   "created_at": int,  # epoch seconds
#   "updated_at": int,  # epoch seconds
# }

ACTIVE_STATUSES = {"running"}
DONE_STATUSES = {"done", "error"}

def _now() -> int:
    return int(time.time())

async def create_job(*, job_id: str, uid: str, filename: str, dataset: str, total_bytes: int) -> None:
    r = await get_client()
    now = _now()
    m = {
        "job_id": job_id,
        "uid": uid,
        "filename": filename,
        "dataset": dataset,
        "total_bytes": str(int(total_bytes)),
        "bytes": "0",
        "phase": "receive",
        "pct": "0",
        "status": "running",
        "error": "",
        "created_at": str(now),
        "updated_at": str(now),
    }
    key = _job_key(job_id)
    log.info("ut_create_job", job_id=job_id, uid=uid, filename=filename, dataset=dataset, total_bytes=total_bytes)
    pipe = r.pipeline()
    pipe.hset(key, mapping=m)
    # Keep jobs for a week after completion; will set expiry on finish as well.
    pipe.expire(key, 7 * 24 * 3600)
    pipe.zadd(_user_set(uid), {job_id: now})
    # pipeline.execute() is a coroutine in redis.asyncio -> must await
    await pipe.execute()
    log.debug("ut_create_job_ok", job_id=job_id)

async def incr_bytes(job_id: str, n: int) -> int:
    """Increase processed bytes and recompute pct if total is known."""
    r = await get_client()
    key = _job_key(job_id)
    inc = int(max(0, n))
    # Increase bytes
    new_bytes = await r.hincrby(key, "bytes", inc)
    # Clamp and recompute pct
    tot = await r.hget(key, "total_bytes")
    pct = 0
    try:
        tot_i = int(tot or 0)
        if tot_i > 0:
            pct = int(min(100, round(new_bytes * 100 / tot_i)))
    except Exception as e:
        log.warning("ut_incr_bytes_pct_fail", job_id=job_id, error=str(e))
    pipe = r.pipeline()
    pipe.hset(key, mapping={"pct": str(pct), "updated_at": str(_now())})
    await pipe.execute()
    log.debug("ut_incr_bytes", job_id=job_id, add=n, total=new_bytes, pct=pct, total_bytes=tot)
    return int(new_bytes)

async def set_phase(job_id: str, phase: str, *, pct: Optional[int] = None, status: Optional[str] = None, error: Optional[str] = None) -> None:
    r = await get_client()
    key = _job_key(job_id)
    m: Dict[str, str] = {"phase": phase, "updated_at": str(_now())}
    if pct is not None:
        m["pct"] = str(max(0, min(100, pct)))
    if status is not None:
        m["status"] = status
    if error is not None:
        m["error"] = error
    log.info("ut_set_phase", job_id=job_id, phase=phase, pct=m.get("pct"), status=m.get("status"))
    await r.hset(key, mapping=m)
    # If terminal, extend retention
    if status in ("done", "error"):
        await r.expire(key, 14 * 24 * 3600)
        log.info("ut_terminal", job_id=job_id, status=status)

async def mark_done(job_id: str) -> None:
    log.info("ut_mark_done", job_id=job_id)
    await set_phase(job_id, "complete", pct=100, status="done")

async def mark_error(job_id: str, message: str) -> None:
    log.error("ut_mark_error", job_id=job_id, error=message)
    await set_phase(job_id, "error", status="error", error=message)

async def get_job(job_id: str) -> Dict[str, Any]:
    r = await get_client()
    m = await r.hgetall(_job_key(job_id))
    if not m:
        log.debug("ut_get_job_empty", job_id=job_id)
        return {}
    # normalize numerics
    out: Dict[str, Any] = {k: v for k, v in m.items()}
    for k in ("total_bytes", "bytes", "pct", "created_at", "updated_at"):
        if k in out:
            try:
                out[k] = int(out[k])
            except Exception:
                pass
    log.debug("ut_get_job_ok", job_id=job_id, pct=out.get("pct"), phase=out.get("phase"), bytes=out.get("bytes"), total_bytes=out.get("total_bytes"))
    return out

async def list_jobs(uid: str, *, limit: int = 50, active_only: bool = False) -> List[Dict[str, Any]]:
    r = await get_client()
    # Most recent first
    ids = await r.zrevrange(_user_set(uid), 0, max(0, limit - 1))
    log.debug("ut_list_job_ids", uid=uid, count=len(ids))
    jobs: List[Dict[str, Any]] = []
    for jid in ids:
        m = await get_job(jid)
        if not m:
            continue
        if active_only and m.get("status") not in ACTIVE_STATUSES:
            continue
        jobs.append(m)
    # Sort in Python by updated_at desc to be safe
    jobs.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
    log.info("ut_list_jobs_ok", uid=uid, items=len(jobs), active_only=active_only)
    return jobs

# ---- NEW: clearing helpers -------------------------------------------------

async def clear_jobs(uid: str, *, only_done: bool = True) -> int:
    """
    Remove tracker entries for a user.
    - only_done=True: remove jobs with status in DONE_STATUSES (default)
    - only_done=False: remove all jobs (running jobs will vanish from UI)
    Returns number of removed jobs.
    """
    r = await get_client()
    set_key = _user_set(uid)
    ids: List[str] = await r.zrange(set_key, 0, -1)  # oldest..newest
    if not ids:
        return 0

    removed = 0
    pipe = r.pipeline()

    if not only_done:
        # nuke everything
        for jid in ids:
            pipe.delete(_job_key(jid))
        pipe.delete(set_key)
        await pipe.execute()
        removed = len(ids)
        log.info("ut_clear_jobs_all", uid=uid, removed=removed)
        return removed

    # Clear completed/error only
    # We do small per-id reads to avoid fetching entire hashes
    for jid in ids:
        status = await r.hget(_job_key(jid), "status")
        if status and status in DONE_STATUSES:
            pipe.delete(_job_key(jid))
            pipe.zrem(set_key, jid)
            removed += 1

    if removed:
        await pipe.execute()
    log.info("ut_clear_jobs_done", uid=uid, removed=removed, total=len(ids))
    return removed
