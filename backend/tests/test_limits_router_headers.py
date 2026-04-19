import pytest

from features.auth.models import SessionOut
from routers import limits


@pytest.mark.asyncio
async def test_limits_me_is_no_store(monkeypatch):
    async def fake_sync(uid: str):
        return {"plan": "PRO"}

    async def fake_get_user_plan(uid: str):
        return "PRO"

    def fake_plan_limits(plan: str):
        return {
            "messages": 10000,
            "upload_tokens": 20000000,
            "transcribe_seconds": 60000,
            "ocr_images": 1000,
        }

    async def fake_usage_snapshot(uid: str):
        return {
            "period_id": "0",
            "period_start_ts": 0,
            "period_end_ts": 1,
            "messages_used": 2,
            "upload_tokens_used": 10,
            "transcribe_seconds_used": 3,
            "ocr_images_used": 1,
        }

    monkeypatch.setattr(limits, "sync_caps_and_plan", fake_sync)
    monkeypatch.setattr(limits, "get_user_plan", fake_get_user_plan)
    monkeypatch.setattr(limits, "plan_limits", fake_plan_limits)
    monkeypatch.setattr(limits, "usage_snapshot", fake_usage_snapshot)

    resp = await limits.get_limits_me(SessionOut(uid="u_test"))

    assert resp.headers["Cache-Control"] == "private, no-store, no-cache, max-age=0, must-revalidate"
    assert resp.headers["Pragma"] == "no-cache"
    assert resp.headers["Expires"] == "0"
    assert b'"plan":"PRO"' in resp.body


@pytest.mark.asyncio
async def test_limits_sync_is_no_store(monkeypatch):
    async def fake_sync(uid: str):
        return {"plan": "PRO", "caps": {"messages": 10000}}

    async def fake_usage_snapshot(uid: str):
        return {"period_id": "0", "messages_used": 0}

    monkeypatch.setattr(limits, "sync_caps_and_plan", fake_sync)
    monkeypatch.setattr(limits, "usage_snapshot", fake_usage_snapshot)

    resp = await limits.sync_limits_now(SessionOut(uid="u_test"))

    assert resp.headers["Cache-Control"] == "private, no-store, no-cache, max-age=0, must-revalidate"
    assert b'"plan":"PRO"' in resp.body
