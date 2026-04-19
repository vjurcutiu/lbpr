from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class FakeCounter:
    def __init__(self, name: str):
        self.name = name
        self.calls: list[tuple[float, dict[str, str]]] = []

    def add(self, amount: float, attributes: dict[str, Any] | None = None) -> None:
        self.calls.append((float(amount), _stringify(attributes)))


class FakeHistogram:
    def __init__(self, name: str):
        self.name = name
        self.calls: list[tuple[float, dict[str, str]]] = []

    def record(self, value: float, attributes: dict[str, Any] | None = None) -> None:
        self.calls.append((float(value), _stringify(attributes)))


@dataclass
class FakeBusinessInstruments:
    auth_session_success_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_auth_session_success_total"))
    auth_session_error_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_auth_session_error_total"))
    file_upload_started_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_file_upload_started_total"))
    file_upload_completed_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_file_upload_completed_total"))
    file_upload_error_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_file_upload_error_total"))
    ingest_started_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_ingest_started_total"))
    ingest_completed_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_ingest_completed_total"))
    ingest_error_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_ingest_error_total"))
    chat_started_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_chat_started_total"))
    chat_completed_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_chat_completed_total"))
    chat_error_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_chat_error_total"))
    plan_limit_hit_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_plan_limit_hit_total"))
    messages_used_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_messages_used_total"))
    upload_tokens_used_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_upload_tokens_used_total"))
    file_processing_tokens_used_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_file_processing_tokens_used_total"))
    chat_duration_ms: FakeHistogram = field(default_factory=lambda: FakeHistogram("lbpr_chat_duration_ms"))
    ingest_duration_ms: FakeHistogram = field(default_factory=lambda: FakeHistogram("lbpr_ingest_duration_ms"))
    openai_call_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_openai_call_total"))
    openai_duration_ms: FakeHistogram = field(default_factory=lambda: FakeHistogram("lbpr_openai_duration_ms"))
    pinecone_operation_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_pinecone_operation_total"))
    pinecone_duration_ms: FakeHistogram = field(default_factory=lambda: FakeHistogram("lbpr_pinecone_duration_ms"))
    workflow_started_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_workflow_started_total"))
    workflow_completed_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_workflow_completed_total"))
    workflow_failed_total: FakeCounter = field(default_factory=lambda: FakeCounter("lbpr_workflow_failed_total"))
    workflow_duration_ms: FakeHistogram = field(default_factory=lambda: FakeHistogram("lbpr_workflow_duration_ms"))


def _stringify(attributes: dict[str, Any] | None) -> dict[str, str]:
    return {str(k): str(v) for k, v in (attributes or {}).items()}


def assert_call(calls: list[tuple[float, dict[str, str]]], *, amount: float | None = None, **attrs: str) -> None:
    for got_amount, got_attrs in calls:
        if amount is not None and got_amount != float(amount):
            continue
        if all(got_attrs.get(k) == str(v) for k, v in attrs.items()):
            return
    raise AssertionError(f"No metric call matched amount={amount!r}, attrs={attrs!r}. Seen={calls!r}")
