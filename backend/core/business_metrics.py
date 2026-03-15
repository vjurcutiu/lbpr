from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from opentelemetry import metrics


@dataclass
class _Instruments:
    auth_session_success_total: Any
    auth_session_error_total: Any
    file_upload_started_total: Any
    file_upload_completed_total: Any
    file_upload_error_total: Any
    ingest_started_total: Any
    ingest_completed_total: Any
    ingest_error_total: Any
    chat_started_total: Any
    chat_completed_total: Any
    chat_error_total: Any
    plan_limit_hit_total: Any
    messages_used_total: Any
    upload_tokens_used_total: Any
    chat_duration_ms: Any
    ingest_duration_ms: Any
    openai_duration_ms: Any
    pinecone_duration_ms: Any


_INSTRUMENTS: _Instruments | None = None


def _clean_str(value: Any, default: str = "unknown") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def init_business_metrics() -> None:
    global _INSTRUMENTS
    if _INSTRUMENTS is not None:
        return

    meter = metrics.get_meter("lbpr.business", version="1.0.0")
    _INSTRUMENTS = _Instruments(
        auth_session_success_total=meter.create_counter(
            "lbpr_auth_session_success_total",
            description="Successful auth session creations.",
        ),
        auth_session_error_total=meter.create_counter(
            "lbpr_auth_session_error_total",
            description="Failed auth session creations.",
        ),
        file_upload_started_total=meter.create_counter(
            "lbpr_file_upload_started_total",
            description="File uploads started.",
        ),
        file_upload_completed_total=meter.create_counter(
            "lbpr_file_upload_completed_total",
            description="File uploads completed successfully.",
        ),
        file_upload_error_total=meter.create_counter(
            "lbpr_file_upload_error_total",
            description="File uploads that failed or were blocked.",
        ),
        ingest_started_total=meter.create_counter(
            "lbpr_ingest_started_total",
            description="Ingest operations started.",
        ),
        ingest_completed_total=meter.create_counter(
            "lbpr_ingest_completed_total",
            description="Ingest operations completed successfully.",
        ),
        ingest_error_total=meter.create_counter(
            "lbpr_ingest_error_total",
            description="Ingest operations that failed.",
        ),
        chat_started_total=meter.create_counter(
            "lbpr_chat_started_total",
            description="Chat or query requests started.",
        ),
        chat_completed_total=meter.create_counter(
            "lbpr_chat_completed_total",
            description="Chat or query requests completed successfully.",
        ),
        chat_error_total=meter.create_counter(
            "lbpr_chat_error_total",
            description="Chat or query requests that failed.",
        ),
        plan_limit_hit_total=meter.create_counter(
            "lbpr_plan_limit_hit_total",
            description="Times a plan or quota limit was reached.",
        ),
        messages_used_total=meter.create_counter(
            "lbpr_messages_used_total",
            unit="1",
            description="Messages consumed against plan quotas.",
        ),
        upload_tokens_used_total=meter.create_counter(
            "lbpr_upload_tokens_used_total",
            unit="1",
            description="Upload tokens consumed against plan quotas.",
        ),
        chat_duration_ms=meter.create_histogram(
            "lbpr_chat_duration_ms",
            unit="ms",
            description="End-to-end duration of chat and query requests.",
        ),
        ingest_duration_ms=meter.create_histogram(
            "lbpr_ingest_duration_ms",
            unit="ms",
            description="End-to-end duration of ingest operations.",
        ),
        openai_duration_ms=meter.create_histogram(
            "lbpr_openai_duration_ms",
            unit="ms",
            description="Duration of OpenAI API calls.",
        ),
        pinecone_duration_ms=meter.create_histogram(
            "lbpr_pinecone_duration_ms",
            unit="ms",
            description="Duration of Pinecone operations.",
        ),
    )


def reset_business_metrics() -> None:
    global _INSTRUMENTS
    _INSTRUMENTS = None


def _ins() -> _Instruments:
    if _INSTRUMENTS is None:
        init_business_metrics()
    assert _INSTRUMENTS is not None
    return _INSTRUMENTS


def record_auth_session_success(*, method: str = "id_token") -> None:
    _ins().auth_session_success_total.add(1, {"method": _clean_str(method)})


def record_auth_session_error(*, reason: str, method: str = "id_token") -> None:
    _ins().auth_session_error_total.add(
        1,
        {"method": _clean_str(method), "reason": _clean_str(reason)},
    )


def record_file_upload_started(*, flow: str = "upload") -> None:
    _ins().file_upload_started_total.add(1, {"flow": _clean_str(flow)})


def record_file_upload_completed(*, flow: str = "upload") -> None:
    _ins().file_upload_completed_total.add(1, {"flow": _clean_str(flow)})


def record_file_upload_error(*, stage: str, flow: str = "upload") -> None:
    _ins().file_upload_error_total.add(
        1,
        {"flow": _clean_str(flow), "stage": _clean_str(stage)},
    )


def record_ingest_started(*, flow: str) -> None:
    _ins().ingest_started_total.add(1, {"flow": _clean_str(flow)})


def record_ingest_completed(*, flow: str, chunks: int | None = None) -> None:
    attrs = {"flow": _clean_str(flow)}
    if chunks is not None:
        attrs["chunk_bucket"] = "0" if chunks <= 0 else "1" if chunks == 1 else "2_5" if chunks <= 5 else "6_plus"
    _ins().ingest_completed_total.add(1, attrs)


def record_ingest_error(*, flow: str, stage: str) -> None:
    _ins().ingest_error_total.add(
        1,
        {"flow": _clean_str(flow), "stage": _clean_str(stage)},
    )


def record_chat_started(*, flow: str) -> None:
    _ins().chat_started_total.add(1, {"flow": _clean_str(flow)})


def record_chat_completed(*, flow: str, with_sources: bool | None = None) -> None:
    attrs = {"flow": _clean_str(flow)}
    if with_sources is not None:
        attrs["with_sources"] = "true" if with_sources else "false"
    _ins().chat_completed_total.add(1, attrs)


def record_chat_error(*, flow: str, stage: str) -> None:
    _ins().chat_error_total.add(
        1,
        {"flow": _clean_str(flow), "stage": _clean_str(stage)},
    )


def record_plan_limit_hit(*, metric: str, plan: str) -> None:
    _ins().plan_limit_hit_total.add(
        1,
        {"metric": _clean_str(metric), "plan": _clean_str(plan, default="free").lower()},
    )


def record_messages_used(*, amount: int, plan: str) -> None:
    if amount <= 0:
        return
    _ins().messages_used_total.add(amount, {"plan": _clean_str(plan, default="free").lower()})


def record_upload_tokens_used(*, amount: int, plan: str) -> None:
    if amount <= 0:
        return
    _ins().upload_tokens_used_total.add(amount, {"plan": _clean_str(plan, default="free").lower()})


def record_chat_duration(*, flow: str, dur_ms: int | float, status: str) -> None:
    _ins().chat_duration_ms.record(
        float(max(0, dur_ms)),
        {"flow": _clean_str(flow), "status": _clean_str(status)},
    )


def record_ingest_duration(*, flow: str, dur_ms: int | float, status: str) -> None:
    _ins().ingest_duration_ms.record(
        float(max(0, dur_ms)),
        {"flow": _clean_str(flow), "status": _clean_str(status)},
    )


def record_openai_duration(*, operation: str, dur_ms: int | float, status: str) -> None:
    _ins().openai_duration_ms.record(
        float(max(0, dur_ms)),
        {"operation": _clean_str(operation), "status": _clean_str(status)},
    )


def record_pinecone_duration(*, operation: str, dur_ms: int | float, status: str) -> None:
    _ins().pinecone_duration_ms.record(
        float(max(0, dur_ms)),
        {"operation": _clean_str(operation), "status": _clean_str(status)},
    )
