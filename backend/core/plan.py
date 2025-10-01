from __future__ import annotations
import logging, time
from typing import Literal, Optional
from core.config import settings
from core.redis_utils import get_client

log = logging.getLogger("plan")

Plan = Literal["FREE", "PRO"]

async def _fetch_plan_from_firestore(uid: str) -> Plan:
    """Ask Firestore: if there's any active/trialing/past_due subscription => PRO else FREE."""
    try:
        # Use Firebase Admin SDK
        from firebase_admin import firestore  # type: ignore
        db = firestore.client()
        subs = db.collection("customers").document(uid).collection("subscriptions").order_by("created", direction=firestore.Query.DESCENDING).limit(5).stream()
        active_like = {"active", "trialing", "past_due"}
        for s in subs:
            data = s.to_dict() or {}
            st = (data.get("status") or "").lower()
            if st in active_like:
                return "PRO"
    except Exception:
        log.exception("plan_firestore_error", uid=uid)
    return "FREE"

async def get_user_plan(uid: str, cache_ttl_sec: int = 300) -> Plan:
    r = await get_client()
    key = f"plan:{uid}"
    plan = await r.get(key)
    if plan in ("FREE","PRO"):
        return plan  # type: ignore
    plan = await _fetch_plan_from_firestore(uid)
    try:
        await r.set(key, plan, ex=cache_ttl_sec)
    except Exception:
        pass
    return plan  # type: ignore

def plan_limits(plan: Plan) -> dict[str,int]:
    if plan == "PRO":
        return {
            "messages": settings.LIMITS_PRO_MESSAGES,
            "upload_tokens": settings.LIMITS_PRO_UPLOAD_TOKENS,
        }
    return {
        "messages": settings.LIMITS_FREE_MESSAGES,
        "upload_tokens": settings.LIMITS_FREE_UPLOAD_TOKENS,
    }
