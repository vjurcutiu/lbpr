import logging
from typing import AsyncIterator, Optional
from redis.asyncio import Redis
from contextlib import asynccontextmanager

log = logging.getLogger("redis")

_client: Optional[Redis] = None

async def get_client() -> Redis:
    assert _client is not None, "Redis client not initialized"
    return _client

async def init(redis_url: str) -> Redis:
    global _client
    if _client is None:
        log.info("redis_connecting", url=redis_url)
        _client = Redis.from_url(redis_url, encoding="utf-8", decode_responses=True)
        try:
            pong = await _client.ping()
            log.info("redis_connected", ping=pong)
        except Exception as e:
            log.exception("redis_ping_failed")
            raise
    return _client

async def close() -> None:
    global _client
    if _client is not None:
        try:
            await _client.close()
            await _client.connection_pool.disconnect(inuse_connections=True)
            log.info("redis_closed")
        finally:
            _client = None
