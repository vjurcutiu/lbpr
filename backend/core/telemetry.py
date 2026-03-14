from __future__ import annotations

import os
from typing import Optional

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.urllib3 import URLLib3Instrumentor
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.trace.sampling import ALWAYS_OFF, ALWAYS_ON, ParentBased, TraceIdRatioBased

_INITIALIZED = False


def _split_csv(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def _parse_resource_attributes(value: str | None) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for item in _split_csv(value):
        key, sep, raw_value = item.partition("=")
        if sep and key.strip():
            attrs[key.strip()] = raw_value.strip()
    return attrs


def _build_sampler():
    sampler_name = os.getenv("OTEL_TRACES_SAMPLER", "parentbased_always_on").strip().lower()
    sampler_arg = os.getenv("OTEL_TRACES_SAMPLER_ARG", "1.0").strip()

    if sampler_name == "always_off":
        return ALWAYS_OFF
    if sampler_name == "always_on":
        return ALWAYS_ON
    if sampler_name == "traceidratio":
        try:
            return TraceIdRatioBased(float(sampler_arg))
        except ValueError:
            return TraceIdRatioBased(1.0)
    if sampler_name == "parentbased_always_off":
        return ParentBased(ALWAYS_OFF)
    if sampler_name == "parentbased_traceidratio":
        try:
            return ParentBased(TraceIdRatioBased(float(sampler_arg)))
        except ValueError:
            return ParentBased(TraceIdRatioBased(1.0))
    return ParentBased(ALWAYS_ON)


def _should_enable_tracing() -> bool:
    exporters = set(_split_csv(os.getenv("OTEL_TRACES_EXPORTER", "otlp")))
    if "none" in exporters and exporters == {"none"}:
        return False
    if "console" in exporters:
        return True
    return bool(
        os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
        or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    )


def current_trace_id_hex() -> Optional[str]:
    span = trace.get_current_span()
    ctx = span.get_span_context() if span else None
    if not ctx or not getattr(ctx, "is_valid", False):
        return None
    return format(ctx.trace_id, "032x")


def setup_telemetry(app=None) -> None:
    global _INITIALIZED
    if _INITIALIZED or not _should_enable_tracing():
        return

    resource_attributes = _parse_resource_attributes(os.getenv("OTEL_RESOURCE_ATTRIBUTES"))
    service_name = os.getenv("OTEL_SERVICE_NAME", "lbpr-api")

    resource = Resource.create({SERVICE_NAME: service_name, **resource_attributes})
    provider = TracerProvider(resource=resource, sampler=_build_sampler())

    exporters = set(_split_csv(os.getenv("OTEL_TRACES_EXPORTER", "otlp")))
    if "otlp" in exporters:
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    if "console" in exporters:
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)

    if app is not None:
        FastAPIInstrumentor.instrument_app(
            app,
            excluded_urls=os.getenv("OTEL_PYTHON_FASTAPI_EXCLUDED_URLS")
            or os.getenv("OTEL_PYTHON_EXCLUDED_URLS")
            or "/healthz,/v1/healthz",
        )

    RedisInstrumentor().instrument()
    URLLib3Instrumentor().instrument()
    HTTPXClientInstrumentor().instrument()
    _INITIALIZED = True
