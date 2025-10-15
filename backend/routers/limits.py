from fastapi import APIRouter, Depends
from features.auth.deps import get_current_user
from features.auth.models import SessionOut
from core.plan import get_user_plan, plan_limits
# Updated: use the new snapshot API; the old read_usage/month_key no longer exist
from core.rate_limit import usage_snapshot

router = APIRouter(prefix="/limits", tags=["limits"])

@router.get("/me")
async def get_limits_me(user: SessionOut = Depends(get_current_user)):
    # Resolve the user's plan (FREE/PRO) and static caps for that plan
    plan = await get_user_plan(user.uid)
    caps = plan_limits(plan)

    # Get current rolling-window usage snapshot (aligned to billing anchor for paid plans,
    # or infinite window for free if configured)
    snap = await usage_snapshot(user.uid)

    usage = {
        "messages": int(snap.get("messages_used", 0)),
        "upload_tokens": int(snap.get("upload_tokens_used", 0)),
    }

    remaining = {
        "messages": max(0, int(caps["messages"]) - usage["messages"]),
        "upload_tokens": max(0, int(caps["upload_tokens"]) - usage["upload_tokens"]),
    }

    # Keep the historic 'window' field for compatibility, mapped to the period_id string.
    # Also expose precise start/end timestamps.
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
