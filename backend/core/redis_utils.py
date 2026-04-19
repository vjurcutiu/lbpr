import asyncio
import logging
import threading
from redis.asyncio import Redis

from core.config import settings

log = logging.getLogger("redis")

# Keep one async Redis client per event loop. This avoids cross-loop Future errors
# when background worker threads create their own event loops with asyncio.run(...).
_CLIENTS_BY_LOOP: dict[int, Redis] = {}
_CLIENTS_LOCK = threading.Lock()


def _loop_id() -> int:
    loop = asyncio.get_running_loop()
    return id(loop)


async def get_client() -> Redis:
    loop_id = _loop_id()
    with _CLIENTS_LOCK:
        client = _CLIENTS_BY_LOOP.get(loop_id)
    if client is not None:
        return client
    return await init(settings.REDIS_URL)


async def init(redis_url: str) -> Redis:
    loop_id = _loop_id()
    with _CLIENTS_LOCK:
        existing = _CLIENTS_BY_LOOP.get(loop_id)
    if existing is not None:
        return existing

    log.info("redis_connecting", url=redis_url, loop_id=loop_id)
    client = Redis.from_url(redis_url, encoding="utf-8", decode_responses=True)
    try:
        pong = await client.ping()
        log.info("redis_connected", ping=pong, loop_id=loop_id)
    except Exception:
        log.exception("redis_ping_failed", loop_id=loop_id)
        try:
            await client.close()
            await client.connection_pool.disconnect(inuse_connections=True)
        except Exception:
            pass
        raise

    with _CLIENTS_LOCK:
        race_winner = _CLIENTS_BY_LOOP.get(loop_id)
        if race_winner is None:
            _CLIENTS_BY_LOOP[loop_id] = client
            return client

    # Another caller initialized the same loop while we were pinging.
    try:
        await client.close()
        await client.connection_pool.disconnect(inuse_connections=True)
    except Exception:
        pass
    return race_winner


async def close_current() -> None:
    loop_id = _loop_id()
    with _CLIENTS_LOCK:
        client = _CLIENTS_BY_LOOP.pop(loop_id, None)
    if client is None:
        return
    try:
        await client.close()
        await client.connection_pool.disconnect(inuse_connections=True)
        log.info("redis_closed", loop_id=loop_id)
    except Exception:
        log.exception("redis_close_failed", loop_id=loop_id)


async def close() -> None:
    await close_current()


async def close_all() -> None:
    with _CLIENTS_LOCK:
        clients = list(_CLIENTS_BY_LOOP.items())
        _CLIENTS_BY_LOOP.clear()
    for loop_id, client in clients:
        try:
            await client.close()
            await client.connection_pool.disconnect(inuse_connections=True)
            log.info("redis_closed", loop_id=loop_id)
        except Exception:
            log.exception("redis_close_failed", loop_id=loop_id)
