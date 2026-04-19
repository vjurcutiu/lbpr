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
    file_processing_tokens_used_total: Any
    chat_duration_ms: Any
    ingest_duration_ms: Any
    openai_call_total: Any
    openai_duration_ms: Any
    pinecone_operation_total: Any
    pinecone_duration_ms: Any
    workflow_started_total: Any
    workflow_completed_total: Any
    workflow_failed_total: Any
    workflow_duration_ms: Any


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
            description="Legacy upload-token metric consumed against plan quotas.",
        ),
        file_processing_tokens_used_total=meter.create_counter(
            "lbpr_file_processing_tokens_used_total",
            unit="1",
            description="Unified file processing tokens consumed against plan quotas.",
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
        openai_call_total=meter.create_counter(
            "lbpr_openai_call_total",
            description="Observed OpenAI API calls by operation and status.",
        ),
        openai_duration_ms=meter.create_histogram(
            "lbpr_openai_duration_ms",
            unit="ms",
            description="Duration of OpenAI API calls.",
        ),
        pinecone_operation_total=meter.create_counter(
            "lbpr_pinecone_operation_total",
            description="Observed Pinecone operations by operation and status.",
        ),
        pinecone_duration_ms=meter.create_histogram(
            "lbpr_pinecone_duration_ms",
            unit="ms",
            description="Duration of Pinecone operations.",
        ),
        workflow_started_total=meter.create_counter(
            "lbpr_workflow_started_total",
            description="Workflow runs started.",
        ),
        workflow_completed_total=meter.create_counter(
            "lbpr_workflow_completed_total",
            description="Workflow runs completed successfully.",
        ),
        workflow_failed_total=meter.create_counter(
            "lbpr_workflow_failed_total",
            description="Workflow runs that failed.",
        ),
        workflow_duration_ms=meter.create_histogram(
            "lbpr_workflow_duration_ms",
            unit="ms",
            description="Duration of workflow runs.",
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


def record_file_processing_tokens_used(*, amount: int, plan: str, category: str = "general") -> None:
    if amount <= 0:
        return
    _ins().file_processing_tokens_used_total.add(
        amount,
        {
            "plan": _clean_str(plan, default="free").lower(),
            "category": _clean_str(category),
        },
    )


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
    attrs = {"operation": _clean_str(operation), "status": _clean_str(status)}
    _ins().openai_call_total.add(1, attrs)
    _ins().openai_duration_ms.record(float(max(0, dur_ms)), attrs)


def record_pinecone_duration(*, operation: str, dur_ms: int | float, status: str) -> None:
    attrs = {"operation": _clean_str(operation), "status": _clean_str(status)}
    _ins().pinecone_operation_total.add(1, attrs)
    _ins().pinecone_duration_ms.record(float(max(0, dur_ms)), attrs)


def record_workflow_started(*, workflow_id: str, capability: str) -> None:
    _ins().workflow_started_total.add(1, {"workflow_id": _clean_str(workflow_id), "capability": _clean_str(capability)})


def record_workflow_completed(*, workflow_id: str, capability: str) -> None:
    _ins().workflow_completed_total.add(1, {"workflow_id": _clean_str(workflow_id), "capability": _clean_str(capability)})


def record_workflow_failed(*, workflow_id: str, capability: str, stage: str) -> None:
    _ins().workflow_failed_total.add(
        1,
        {
            "workflow_id": _clean_str(workflow_id),
            "capability": _clean_str(capability),
            "stage": _clean_str(stage),
        },
    )


def record_workflow_duration(*, workflow_id: str, capability: str, dur_ms: int | float, status: str) -> None:
    _ins().workflow_duration_ms.record(
        float(max(0, dur_ms)),
        {
            "workflow_id": _clean_str(workflow_id),
            "capability": _clean_str(capability),
            "status": _clean_str(status),
        },
    )
