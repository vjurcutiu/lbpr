from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Awaitable, Callable

from core.config import settings
from core import redis_utils

log = logging.getLogger("background.jobs")

_EXECUTOR: ThreadPoolExecutor | None = None
_LOCK = threading.Lock()


def start_background_jobs() -> None:
    global _EXECUTOR
    with _LOCK:
        if _EXECUTOR is None:
            workers = max(1, int(getattr(settings, "BACKGROUND_JOB_WORKERS", 2) or 2))
            _EXECUTOR = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="lbpr-bg")
            log.info("background_jobs_started", workers=workers)


def stop_background_jobs(*, wait: bool = False) -> None:
    global _EXECUTOR
    with _LOCK:
        executor = _EXECUTOR
        _EXECUTOR = None
    if executor is not None:
        executor.shutdown(wait=wait, cancel_futures=False)
        log.info("background_jobs_stopped", wait=wait)


def _executor() -> ThreadPoolExecutor:
    executor = _EXECUTOR
    if executor is None:
        start_background_jobs()
        executor = _EXECUTOR
    if executor is None:
        raise RuntimeError("Background job executor is unavailable")
    return executor


def _attach_logging(job_name: str, future: Future[Any]) -> Future[Any]:
    def _callback(done: Future[Any]) -> None:
        try:
            done.result()
        except Exception:
            # already logged in worker runner
            return

    future.add_done_callback(_callback)
    return future


def submit(job_name: str, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Future[Any]:
    executor = _executor()

    def _runner() -> Any:
        log.info("background_job_started", job_name=job_name)
        try:
            return fn(*args, **kwargs)
        except Exception:
            log.exception("background_job_failed", job_name=job_name)
            raise
        finally:
            log.info("background_job_finished", job_name=job_name)

    future = executor.submit(_runner)
    return _attach_logging(job_name, future)


def submit_async(job_name: str, coro_fn: Callable[..., Awaitable[Any]], *args: Any, **kwargs: Any) -> Future[Any]:
    """Run an async function inside a worker thread with its own event loop.

    Important: the worker loop must not reuse loop-bound async clients from the main
    application loop. redis_utils uses loop-local clients, and we explicitly close the
    worker loop's client when the coroutine finishes.
    """

    executor = _executor()

    async def _runner_async() -> Any:
        try:
            return await coro_fn(*args, **kwargs)
        finally:
            await redis_utils.close_current()

    def _runner() -> Any:
        log.info("background_job_started", job_name=job_name)
        try:
            return asyncio.run(_runner_async())
        except Exception:
            log.exception("background_job_failed", job_name=job_name)
            raise
        finally:
            log.info("background_job_finished", job_name=job_name)

    future = executor.submit(_runner)
    return _attach_logging(job_name, future)
