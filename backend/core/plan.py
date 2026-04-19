# backend/core/plan.py
from __future__ import annotations

import logging
from typing import Literal, Optional, Dict, Any

from core.redis_utils import get_client
from core.config import settings
from core.rate_limit import (
    reset_usage_current_window,
    set_caps,
    set_plan,
    set_billing_anchor,
)

log = logging.getLogger("plan")

Plan = Literal["FREE", "PRO"]

ACTIVE_STATUSES = {"active", "trialing", "past_due"}
SUB_COLLECTION = "subscriptions"
USER_COLLECTION = "users"
PLAN_OVERRIDE_FIELD = "plan_override"


def _normalize_plan_override(value: Any) -> Optional[Plan]:
    try:
        normalized = str(value or "").strip().upper()
    except Exception:
        return None
    if normalized in ("FREE", "PRO"):
        return normalized  # type: ignore[return-value]
    return None


def _as_unix_ts(v: Any) -> int:
    try:
        if v is None:
            return 0
        if isinstance(v, (int, float)):
            return int(v)
        if hasattr(v, "timestamp"):
            return int(v.timestamp())  # type: ignore
        if hasattr(v, "seconds"):
            return int(getattr(v, "seconds"))  # type: ignore
        if isinstance(v, str):
            from datetime import datetime
            try:
                return int(datetime.fromisoformat(v.replace("Z","+00:00")).timestamp())
            except Exception:
                return 0
    except Exception:
        return 0
    return 0


async def _fetch_sub_snapshot(uid: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "plan": "FREE",
        "status": "none",
        "current_period_start": 0,
        "current_period_end": 0,
        "cancel_at_period_end": False,
        "cancel_at": 0,
        "override": False,
    }
    try:
        from firebase_admin import firestore  # type: ignore
        db = firestore.client()

        user_doc = db.collection(USER_COLLECTION).document(uid).get()
        user_data = user_doc.to_dict() or {}
        override = _normalize_plan_override(user_data.get(PLAN_OVERRIDE_FIELD))
        if override is not None:
            out["plan"] = override
            out["status"] = "override"
            out["override"] = True
            return out

        subs = (
            db.collection("customers")
              .document(uid)
              .collection(SUB_COLLECTION)
              .order_by("created", direction=firestore.Query.DESCENDING)
              .limit(5)
              .stream()
        )
        for s in subs:
            data = s.to_dict() or {}
            status = (data.get("status") or "").lower()
            if out["status"] == "none":
                out["status"] = status or "unknown"
                out["cancel_at_period_end"] = bool(data.get("cancel_at_period_end") or False)
                out["cancel_at"] = _as_unix_ts(data.get("cancel_at"))
                out["current_period_start"] = _as_unix_ts(data.get("current_period_start"))
                out["current_period_end"] = _as_unix_ts(data.get("current_period_end"))

            if status in ACTIVE_STATUSES:
                out["plan"] = "PRO"
                cps = _as_unix_ts(data.get("current_period_start"))
                if cps:
                    out["current_period_start"] = cps
                cpe = _as_unix_ts(data.get("current_period_end"))
                if cpe:
                    out["current_period_end"] = cpe
                break
    except Exception:
        log.exception("plan_firestore_error", uid=uid)
    return out


def _plan_limits(plan: Plan) -> Dict[str, int]:
    if plan == "PRO":
        return {
            "messages": settings.LIMITS_PRO_MESSAGES,
            "upload_tokens": settings.LIMITS_PRO_UPLOAD_TOKENS,
            "transcribe_seconds": settings.LIMITS_PRO_TRANSCRIBE_SECONDS,
            "ocr_images": settings.LIMITS_PRO_OCR_IMAGES,
        }
    return {
        "messages": settings.LIMITS_FREE_MESSAGES,
        "upload_tokens": settings.LIMITS_FREE_UPLOAD_TOKENS,
        "transcribe_seconds": settings.LIMITS_FREE_TRANSCRIBE_SECONDS,
        "ocr_images": settings.LIMITS_FREE_OCR_IMAGES,
    }


async def _refresh_and_handle_transition(uid: str, cache_ttl_sec: int = 300) -> Plan:
    r = await get_client()
    snap = await _fetch_sub_snapshot(uid)
    new_plan: Plan = snap.get("plan", "FREE")  # type: ignore
    new_anchor = int(snap.get("current_period_start") or 0)

    last_plan_key = f"plan:{uid}:last"
    last_anchor_key = f"plan:{uid}:anchor_last"

    cached_last_plan = await r.get(last_plan_key)
    last_plan: Optional[Plan] = cached_last_plan if cached_last_plan in ("FREE","PRO") else None  # type: ignore

    cached_last_anchor = await r.get(last_anchor_key)
    try:
        last_anchor = int(cached_last_anchor) if cached_last_anchor is not None else 0
    except Exception:
        last_anchor = 0

    # Transition: FREE -> PRO => reset immediately
    if last_plan == "FREE" and new_plan == "PRO":
        try:
            # Ensure paid windows behave as rolling windows (clear stale flag from FREE)
            await r.hset(f"rl:{uid}:meta", mapping={"free_no_refresh": "0"})
            await reset_usage_current_window(uid)
            log.info("plan_transition_reset", uid=uid, from_plan=last_plan, to_plan=new_plan)
        except Exception:
            log.exception("plan_transition_reset_failed", uid=uid)

    # Renewal detection: anchor changed for PRO
    renewal_detected = new_plan == "PRO" and new_anchor > 0 and new_anchor != last_anchor
    if renewal_detected:
        # Move anchor and wipe usage to 0 (explicit reset requested)
        try:
            await set_billing_anchor(uid, new_anchor)
            await r.hset(f"rl:{uid}:meta", mapping={"free_no_refresh": "0"})
            await reset_usage_current_window(uid)
            log.info("plan_renewal_reset", uid=uid, new_anchor_ts=new_anchor, old_anchor_ts=last_anchor)
        except Exception:
            log.exception("plan_renewal_reset_failed", uid=uid)

    # Update plan + caps (always)
    try:
        caps = _plan_limits(new_plan)
        await set_caps(
            uid,
            cap_messages=int(caps["messages"]),
            cap_upload_tokens=int(caps["upload_tokens"]),
            cap_transcribe_seconds=int(caps.get("transcribe_seconds", 0)),
            cap_ocr_images=int(caps.get("ocr_images", 0)),
        )
        await set_plan(uid, new_plan)
        # Force-clear free_no_refresh for paid plans in case older meta left it behind
        if new_plan == "PRO":
            await r.hset(f"rl:{uid}:meta", mapping={"free_no_refresh": "0"})
        # If we didn't hit the renewal branch above, still set anchor for PRO
        if new_plan == "PRO" and new_anchor > 0 and not renewal_detected:
            try:
                await set_billing_anchor(uid, new_anchor)
            except Exception:
                log.exception("plan_anchor_set_error", uid=uid, anchor_ts=new_anchor)
        log.debug("limits_synced", uid=uid, plan=new_plan, caps=caps, anchor_ts=new_anchor)
    except Exception:
        log.exception("limits_sync_error", uid=uid)

    # Persist caches
    try:
        await r.set(last_plan_key, new_plan, ex=cache_ttl_sec)
        if new_anchor > 0:
            await r.set(last_anchor_key, str(new_anchor), ex=cache_ttl_sec)
    except Exception:
        pass

    return new_plan


async def get_user_plan(uid: str, cache_ttl_sec: int = 300) -> Plan:
    r = await get_client()
    key = f"plan:{uid}"
    plan = await r.get(key)
    if plan in ("FREE","PRO"):
        return plan  # type: ignore
    return await _refresh_and_handle_transition(uid, cache_ttl_sec)


def plan_limits(plan: Plan) -> Dict[str,int]:
    return _plan_limits(plan)


async def sync_caps_and_plan(uid: str) -> Dict[str, Any]:
    plan = await _refresh_and_handle_transition(uid, cache_ttl_sec=300)
    try:
        snap = await _fetch_sub_snapshot(uid)
        caps = _plan_limits(plan)
        return {"plan": plan, "caps": caps, "snapshot": snap}
    except Exception:
        return {"plan": plan, "caps": _plan_limits(plan)}
