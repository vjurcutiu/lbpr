from fastapi import APIRouter, Depends
from features.auth.deps import get_current_user
from features.auth.models import SessionOut
from core.plan import get_user_plan, plan_limits
from core.rate_limit import read_usage, month_key

router = APIRouter(prefix="/limits", tags=["limits"])

@router.get("/me")
async def get_limits_me(user: SessionOut = Depends(get_current_user)):
    plan = await get_user_plan(user.uid)
    caps = plan_limits(plan)
    usage = await read_usage(user.uid)
    ym, _ = month_key()
    return {
        "plan": plan,
        "window": ym,
        "caps": caps,
        "usage": {"messages": usage.get("messages", 0), "upload_tokens": usage.get("upload_tokens", 0)},
        "remaining": {
            "messages": max(0, caps["messages"] - usage.get("messages", 0)),
            "upload_tokens": max(0, caps["upload_tokens"] - usage.get("upload_tokens", 0)),
        },
    }
