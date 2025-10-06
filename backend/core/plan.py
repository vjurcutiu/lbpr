from __future__ import annotations
import logging
from typing import Literal
from core.redis_utils import get_client
from core.config import settings
from core.rate_limit import reset_usage_current_window

log = logging.getLogger("plan")

Plan = Literal["FREE", "PRO"]

async def _fetch_plan_from_firestore(uid: str) -> Plan:
    """Ask Firestore: if there's any active/trialing/past_due subscription => PRO else FREE."""
    try:
        # Use Firebase Admin SDK
        from firebase_admin import firestore  # type: ignore
        db = firestore.client()
        subs = (
            db.collection("customers")
              .document(uid)
              .collection("subscriptions")
              .order_by("created", direction=firestore.Query.DESCENDING)
              .limit(5)
              .stream()
        )
        active_like = {"active", "trialing", "past_due"}
        for s in subs:
            data = s.to_dict() or {}
            st = (data.get("status") or "").lower()
            if st in active_like:
                return "PRO"
    except Exception:
        log.exception("plan_firestore_error", uid=uid)
    return "FREE"

async def _refresh_and_handle_transition(uid: str, cache_ttl_sec: int = 300) -> Plan:
    """Fetch latest plan, compare with previous, handle FREE->PRO transition, then cache."""
    r = await get_client()
    new_plan: Plan = await _fetch_plan_from_firestore(uid)

    last_key = f"plan:{uid}:last"
    cached_last = await r.get(last_key)
    last_plan: Plan | None = cached_last if cached_last in ("FREE","PRO") else None  # type: ignore

    # Transition handling: reset usage when moving from FREE to PRO
    if last_plan == "FREE" and new_plan == "PRO":
        try:
            await reset_usage_current_window(uid)
            log.info("plan_transition_reset", uid=uid, from_plan=last_plan, to_plan=new_plan)
        except Exception:
            log.exception("plan_transition_reset_failed", uid=uid)

    # Persist "last" (no expiry) and the normal short-lived cache
    try:
        await r.set(last_key, new_plan)
        await r.set(f"plan:{uid}", new_plan, ex=cache_ttl_sec)
    except Exception:
        # Non-fatal
        pass

    return new_plan

async def get_user_plan(uid: str, cache_ttl_sec: int = 300) -> Plan:
    """Return the cached plan quickly; refresh if needed (and handle transitions)."""
    r = await get_client()
    key = f"plan:{uid}"
    plan = await r.get(key)
    if plan in ("FREE","PRO"):
        return plan  # type: ignore
    # No cache → fetch fresh and handle transitions
    return await _refresh_and_handle_transition(uid, cache_ttl_sec)

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
