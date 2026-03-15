from __future__ import annotations

import logging
import os
import socket
from typing import Optional

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.urllib3 import URLLib3Instrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    ConsoleMetricExporter,
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.trace.sampling import ALWAYS_OFF, ALWAYS_ON, ParentBased, TraceIdRatioBased

from core.business_metrics import init_business_metrics, reset_business_metrics

_INITIALIZED = False
_TRACER_PROVIDER: TracerProvider | None = None
_METER_PROVIDER: MeterProvider | None = None
_LOG = logging.getLogger("telemetry")


def _split_csv(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def _parse_resource_attributes(value: str | None) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for item in _split_csv(value):
        key, sep, raw_value = item.partition("=")
        if sep and key.strip():
            attrs[key.strip()] = raw_value.strip()
    return attrs


def _build_resource() -> Resource:
    resource_attributes = _parse_resource_attributes(os.getenv("OTEL_RESOURCE_ATTRIBUTES"))
    service_name = os.getenv("OTEL_SERVICE_NAME", "lbpr-api")

    deployment_env = resource_attributes.get("deployment.environment")
    deployment_env_name = resource_attributes.get("deployment.environment.name")
    env_fallback = (os.getenv("ENV") or "").strip().lower()
    if env_fallback == "prod":
        env_fallback = "production"
    elif env_fallback == "dev":
        env_fallback = "development"

    resolved_env = deployment_env_name or deployment_env or env_fallback
    if resolved_env:
        resource_attributes.setdefault("deployment.environment", resolved_env)
        resource_attributes.setdefault("deployment.environment.name", resolved_env)

    resource_attributes.setdefault(
        "service.instance.id",
        os.getenv("HOSTNAME") or socket.gethostname(),
    )

    return Resource.create({SERVICE_NAME: service_name, **resource_attributes})


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
    if exporters == {"none"}:
        return False
    if "console" in exporters:
        return True
    return bool(
        os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
        or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    )


def _should_enable_metrics() -> bool:
    exporters = set(_split_csv(os.getenv("OTEL_METRICS_EXPORTER", "otlp")))
    if exporters == {"none"}:
        return False
    if "console" in exporters:
        return True
    return bool(
        os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT")
        or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    )


def _metric_export_interval(default_ms: int) -> int:
    raw = os.getenv("OTEL_METRIC_EXPORT_INTERVAL")
    if raw:
        try:
            return max(1000, int(raw))
        except ValueError:
            _LOG.warning("invalid_metric_export_interval", raw=raw)
    return default_ms


def _metric_export_timeout(default_ms: int) -> int:
    raw = os.getenv("OTEL_METRIC_EXPORT_TIMEOUT")
    if raw:
        try:
            return max(1000, int(raw))
        except ValueError:
            _LOG.warning("invalid_metric_export_timeout", raw=raw)
    return default_ms


def current_trace_id_hex() -> Optional[str]:
    span = trace.get_current_span()
    ctx = span.get_span_context() if span else None
    if not ctx or not getattr(ctx, "is_valid", False):
        return None
    return format(ctx.trace_id, "032x")


def setup_telemetry(app=None) -> None:
    global _INITIALIZED, _TRACER_PROVIDER, _METER_PROVIDER
    if _INITIALIZED:
        return

    enable_tracing = _should_enable_tracing()
    enable_metrics = _should_enable_metrics()
    if not enable_tracing and not enable_metrics:
        return

    resource = _build_resource()

    if enable_tracing:
        tracer_provider = TracerProvider(resource=resource, sampler=_build_sampler())
        trace_exporters = set(_split_csv(os.getenv("OTEL_TRACES_EXPORTER", "otlp")))
        if "otlp" in trace_exporters:
            tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        if "console" in trace_exporters:
            tracer_provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
        trace.set_tracer_provider(tracer_provider)
        _TRACER_PROVIDER = tracer_provider

    if enable_metrics:
        metric_readers: list[PeriodicExportingMetricReader] = []
        metric_exporters = set(_split_csv(os.getenv("OTEL_METRICS_EXPORTER", "otlp")))
        if "otlp" in metric_exporters:
            metric_readers.append(
                PeriodicExportingMetricReader(
                    OTLPMetricExporter(),
                    export_interval_millis=_metric_export_interval(60000),
                    export_timeout_millis=_metric_export_timeout(30000),
                )
            )
        if "console" in metric_exporters:
            metric_readers.append(
                PeriodicExportingMetricReader(
                    ConsoleMetricExporter(),
                    export_interval_millis=_metric_export_interval(10000),
                )
            )

        meter_provider = MeterProvider(resource=resource, metric_readers=metric_readers)
        metrics.set_meter_provider(meter_provider)
        _METER_PROVIDER = meter_provider
        init_business_metrics()

    excluded_urls = (
        os.getenv("OTEL_PYTHON_FASTAPI_EXCLUDED_URLS")
        or os.getenv("OTEL_PYTHON_EXCLUDED_URLS")
        or "/healthz,/v1/healthz"
    )

    if app is not None:
        FastAPIInstrumentor.instrument_app(
            app,
            tracer_provider=_TRACER_PROVIDER,
            meter_provider=_METER_PROVIDER,
            excluded_urls=excluded_urls,
        )

    HTTPXClientInstrumentor().instrument(
        tracer_provider=_TRACER_PROVIDER,
        meter_provider=_METER_PROVIDER,
    )
    URLLib3Instrumentor().instrument(
        tracer_provider=_TRACER_PROVIDER,
        meter_provider=_METER_PROVIDER,
        excluded_urls=excluded_urls,
    )
    RedisInstrumentor().instrument(tracer_provider=_TRACER_PROVIDER)

    _INITIALIZED = True


def shutdown_telemetry() -> None:
    global _INITIALIZED, _TRACER_PROVIDER, _METER_PROVIDER

    try:
        if _METER_PROVIDER is not None:
            _METER_PROVIDER.shutdown()
    except Exception:
        _LOG.exception("meter_provider_shutdown_failed")

    try:
        if _TRACER_PROVIDER is not None:
            _TRACER_PROVIDER.shutdown()
    except Exception:
        _LOG.exception("tracer_provider_shutdown_failed")

    _TRACER_PROVIDER = None
    _METER_PROVIDER = None
    reset_business_metrics()
    _INITIALIZED = False
