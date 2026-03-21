from __future__ import annotations

import argparse
import asyncio
import os
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Ensure imports like `from core...` and `from main...` work when the script is run as
# `python scripts/seed_telemetry.py` from inside the container. In that mode, Python
# puts `/app/scripts` on sys.path, not the backend root `/app`.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Default to deterministic fake auth for the in-process seed app.
# Set SEED_USE_FAKE_AUTH=0 to disable.
if os.getenv("SEED_USE_FAKE_AUTH", "1") == "1":
    os.environ.setdefault("AUTH_FAKE", "1")

from fastapi.testclient import TestClient

from core.plan import sync_caps_and_plan
from core.rate_limit import (
    DEFAULT_CAP_MESSAGES,
    DEFAULT_CAP_UPLOAD_TOKENS,
    _load_meta,
    _period_id_for_user,
    _usage_key,
)
from core.redis_utils import get_client
from main import app


@dataclass
class StepResult:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class UsageBackup:
    key: str
    fields: dict[str, str]


SEED_UID = "u_test"


def _print_step(result: StepResult) -> None:
    prefix = "✓" if result.ok else "✗"
    if result.detail:
        print(f"{prefix} {result.name}: {result.detail}")
    else:
        print(f"{prefix} {result.name}")


async def _usage_key_and_period(uid: str) -> tuple[str, int, int, dict[str, str]]:
    meta = await _load_meta(uid)
    period_id, start_ts, end_ts = _period_id_for_user(meta)
    return _usage_key(uid, period_id), start_ts, end_ts, meta


async def _backup_usage(uid: str) -> UsageBackup:
    key, _start_ts, _end_ts, _meta = await _usage_key_and_period(uid)
    r = await get_client()
    fields = await r.hgetall(key)
    return UsageBackup(key=key, fields={str(k): str(v) for k, v in (fields or {}).items()})


async def _restore_usage(backup: UsageBackup) -> None:
    r = await get_client()
    if backup.fields:
        await r.delete(backup.key)
        await r.hset(backup.key, mapping=backup.fields)
    else:
        await r.delete(backup.key)


async def _set_usage_at_cap(uid: str, *, metric: str, cap: int) -> None:
    key, start_ts, end_ts, _meta = await _usage_key_and_period(uid)
    r = await get_client()
    await r.hset(
        key,
        mapping={
            metric: str(max(0, int(cap))),
            "period_start_ts": str(start_ts),
            "period_end_ts": str(end_ts),
        },
    )


async def _get_caps(uid: str) -> tuple[int, int]:
    await sync_caps_and_plan(uid)
    meta = await _load_meta(uid)
    cap_messages = int(meta.get("cap_messages") or DEFAULT_CAP_MESSAGES)
    cap_upload_tokens = int(meta.get("cap_upload_tokens") or DEFAULT_CAP_UPLOAD_TOKENS)
    return cap_messages, cap_upload_tokens


def _seed_text() -> str:
    return (
        "LexBot Pro telemetry seed document. "
        "This document exists to drive ingest, retrieval, upload, chat, and quota telemetry into Grafana. "
        "It contains enough text to create chunks and produce a non-empty answer during query flows."
    )


def _request_ok(resp: Any, expected_status: int | tuple[int, ...], *, body_preview: int = 220) -> str:
    allowed = expected_status if isinstance(expected_status, tuple) else (expected_status,)
    if resp.status_code in allowed:
        return ""
    preview = getattr(resp, "text", "") or ""
    preview = preview[:body_preview].replace("\n", " ")
    return f"status={resp.status_code} body={preview}"


def run_seed(*, dataset_prefix: str, skip_upload: bool, skip_contracts_chat: bool) -> int:
    dataset = f"{dataset_prefix}-{int(time.time())}"
    results: list[StepResult] = []

    with TestClient(app) as client:
        usage_backup = asyncio.run(_backup_usage(SEED_UID))
        try:
            resp = client.post("/auth/session", json={"id_token": "good-token"})
            detail = _request_ok(resp, 200)
            results.append(StepResult("auth session success", not detail, detail))

            resp = client.post("/auth/session", json={"id_token": "bad-token"})
            detail = _request_ok(resp, 401)
            results.append(StepResult("auth session failure", not detail, detail))

            for path in ("/session", "/me", "/limits/me"):
                resp = client.get(path)
                detail = _request_ok(resp, 200)
                results.append(StepResult(f"GET {path}", not detail, detail))

            resp = client.post(
                "/features/rag/ingest",
                json={
                    "dataset": dataset,
                    "text": _seed_text(),
                    "metadata": {"title": "telemetry-seed.txt", "source": "seed-script"},
                },
            )
            detail = _request_ok(resp, 200)
            results.append(StepResult("RAG ingest success", not detail, detail))

            resp = client.post(
                "/features/rag/query",
                json={
                    "dataset": dataset,
                    "query": "What is this telemetry seed document for?",
                    "with_sources": True,
                    "k": 5,
                },
            )
            detail = _request_ok(resp, 200)
            results.append(StepResult("RAG query success", not detail, detail))

            if not skip_contracts_chat:
                resp = client.post(
                    "/v1/chat",
                    json={
                        "dataset": dataset,
                        "message": "Summarize the telemetry seed document.",
                        "with_sources": True,
                        "k": 5,
                    },
                )
                detail = _request_ok(resp, 200)
                results.append(StepResult("contracts chat flow", not detail, detail))

            if not skip_upload:
                with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as tmp:
                    tmp.write(
                        "This uploaded file exists to seed upload and upload-ingest telemetry.\n"
                        "Grafana should receive file upload started/completed plus ingest started/completed.\n"
                    )
                    tmp_path = Path(tmp.name)
                try:
                    with tmp_path.open("rb") as fh:
                        resp = client.post(
                            f"/v1/files?dataset={dataset}",
                            files={"file": ("telemetry-upload.txt", fh, "text/plain")},
                        )
                    detail = _request_ok(resp, 202)
                    results.append(StepResult("file upload success", not detail, detail))
                finally:
                    try:
                        tmp_path.unlink(missing_ok=True)
                    except Exception:
                        pass

            cap_messages, cap_upload_tokens = asyncio.run(_get_caps(SEED_UID))

            asyncio.run(_set_usage_at_cap(SEED_UID, metric="messages", cap=cap_messages))
            resp = client.post(
                "/features/rag/query",
                json={
                    "dataset": dataset,
                    "query": "This request should hit the message cap.",
                    "with_sources": False,
                    "k": 3,
                },
            )
            detail = _request_ok(resp, 429)
            results.append(StepResult("message limit hit", not detail, detail))

            asyncio.run(_set_usage_at_cap(SEED_UID, metric="upload_tokens", cap=cap_upload_tokens))
            resp = client.post(
                "/features/rag/ingest",
                json={
                    "dataset": dataset,
                    "text": "This text is intentionally longer than one token so upload-token accounting runs.",
                    "metadata": {"title": "telemetry-limit-hit.txt", "source": "seed-script"},
                },
            )
            detail = _request_ok(resp, 429)
            results.append(StepResult("upload-token limit hit", not detail, detail))
        finally:
            asyncio.run(_restore_usage(usage_backup))

    print(f"dataset={dataset}")
    for result in results:
        _print_step(result)

    failures = [r for r in results if not r.ok]
    if failures:
        print("seed completed with failures", file=sys.stderr)
        return 1

    print("seed completed successfully")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed Grafana-visible telemetry by driving live app flows in-process.")
    parser.add_argument("--dataset-prefix", default=os.getenv("SEED_DATASET_PREFIX", "telemetry-seed"))
    parser.add_argument("--skip-upload", action="store_true")
    parser.add_argument("--skip-contracts-chat", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(
        run_seed(
            dataset_prefix=args.dataset_prefix,
            skip_upload=args.skip_upload,
            skip_contracts_chat=args.skip_contracts_chat,
        )
    )
