# backend/routers/limits.py
from __future__ import annotations

from fastapi import APIRouter, Depends
from features.auth.deps import get_current_user
from features.auth.models import SessionOut
from core.plan import get_user_plan, plan_limits, sync_caps_and_plan
from core.rate_limit import usage_snapshot

router = APIRouter(prefix="/limits", tags=["limits"])

@router.get("/me")
async def get_limits_me(user: SessionOut = Depends(get_current_user)):
    # Ensure caps/anchor in Redis match latest billing state
    await sync_caps_and_plan(user.uid)

    plan = await get_user_plan(user.uid)
    caps = plan_limits(plan)
    snap = await usage_snapshot(user.uid)

    usage = {
        "messages": int(snap.get("messages_used", 0)),
        "upload_tokens": int(snap.get("upload_tokens_used", 0)),
    }
    remaining = {
        "messages": max(0, int(caps["messages"]) - usage["messages"]),
        "upload_tokens": max(0, int(caps["upload_tokens"]) - usage["upload_tokens"]),
    }

    return {
        "plan": plan,
        "window": str(snap.get("period_id")),
        "period": {
            "start_ts": int(snap.get("period_start_ts", 0)),
            "end_ts": int(snap.get("period_end_ts", 0)),
        },
        "caps": caps,
        "usage": usage,
        "remaining": remaining,
    }

@router.post("/sync")
async def sync_limits_now(user: SessionOut = Depends(get_current_user)):
    """Manual Firestore → Redis sync + snapshot (debugging helper)."""
    info = await sync_caps_and_plan(user.uid)
    snap = await usage_snapshot(user.uid)
    return {"info": info, "snapshot": snap}
