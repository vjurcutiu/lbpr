from fastapi import APIRouter
from core.redis_utils import get_client

router = APIRouter(tags=["meta"])

@router.get("/healthz")
async def healthz():
    # Try a fast PING; don't fail the endpoint if Redis is down.
    ok = True
    redis_ok = None
    try:
        r = await get_client()
        redis_ok = await r.ping()
    except Exception:
        redis_ok = False
    return {"ok": ok, "redis": redis_ok}
