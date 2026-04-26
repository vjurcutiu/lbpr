# backend/routers/limits.py
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from features.auth.deps import get_current_user
from features.auth.models import SessionOut
from core.plan import get_user_plan, plan_limits, sync_caps_and_plan
from core.rate_limit import usage_snapshot

router = APIRouter(prefix="/limits", tags=["limits"])

LIMITS_NO_STORE_HEADERS = {
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _limits_payload(plan: str, caps: dict, snap: dict) -> dict:
    usage = {
        "messages": int(snap.get("messages_used", 0)),
        "file_processing_tokens": int(snap.get("file_processing_tokens_used", snap.get("upload_tokens_used", 0))),
        "upload_tokens": int(snap.get("file_processing_tokens_used", snap.get("upload_tokens_used", 0))),
        "upload_ingest_tokens": int(snap.get("upload_ingest_tokens_used", 0)),
        "workflow_tokens": int(snap.get("workflow_tokens_used", 0)),
        "workflow_input_tokens": int(snap.get("workflow_input_tokens_used", 0)),
        "workflow_output_tokens": int(snap.get("workflow_output_tokens_used", 0)),
        "workflow_rag_overhead_tokens": int(snap.get("workflow_rag_overhead_tokens_used", 0)),
        "transcribe_seconds": int(snap.get("transcribe_seconds_used", 0)),
        "ocr_images": int(snap.get("ocr_images_used", 0)),
    }
    file_processing_cap = int(caps.get("file_processing_tokens", caps.get("upload_tokens", 0)))
    workflow_cap = int(caps.get("workflow_tokens", file_processing_cap))
    remaining = {
        "messages": max(0, int(caps["messages"]) - usage["messages"]),
        "file_processing_tokens": max(0, file_processing_cap - usage["file_processing_tokens"]),
        "upload_tokens": max(0, file_processing_cap - usage["file_processing_tokens"]),
        "workflow_tokens": max(0, workflow_cap - usage["workflow_tokens"]),
        "transcribe_seconds": max(0, int(caps["transcribe_seconds"]) - usage["transcribe_seconds"]),
        "ocr_images": max(0, int(caps.get("ocr_images", 0)) - usage["ocr_images"]),
    }

    payload_caps = dict(caps)
    payload_caps.setdefault("file_processing_tokens", file_processing_cap)
    payload_caps.setdefault("upload_tokens", file_processing_cap)
    payload_caps.setdefault("workflow_tokens", workflow_cap)

    return {
        "plan": plan,
        "window": str(snap.get("period_id")),
        "period": {
            "start_ts": int(snap.get("period_start_ts", 0)),
            "end_ts": int(snap.get("period_end_ts", 0)),
        },
        "caps": payload_caps,
        "usage": usage,
        "remaining": remaining,
    }


@router.get("/me")
async def get_limits_me(user: SessionOut = Depends(get_current_user)):
    # Ensure caps/anchor in Redis match latest billing state
    await sync_caps_and_plan(user.uid)

    plan = await get_user_plan(user.uid)
    caps = plan_limits(plan)
    snap = await usage_snapshot(user.uid)
    return JSONResponse(content=_limits_payload(plan, caps, snap), headers=LIMITS_NO_STORE_HEADERS)


@router.post("/sync")
async def sync_limits_now(user: SessionOut = Depends(get_current_user)):
    """Manual Firestore → Redis sync + snapshot (debugging helper)."""
    info = await sync_caps_and_plan(user.uid)
    snap = await usage_snapshot(user.uid)
    return JSONResponse(content={"info": info, "snapshot": snap}, headers=LIMITS_NO_STORE_HEADERS)
