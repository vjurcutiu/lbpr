from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Optional, Tuple


_trace_id: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)
_request_id: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
_tenant_id: ContextVar[Optional[str]] = ContextVar("tenant_id", default=None)


@dataclass(frozen=True)
class RequestContext:
    trace_id: Optional[str] = None
    request_id: Optional[str] = None
    tenant_id: Optional[str] = None


def set_request_context(*, trace_id: Optional[str], request_id: Optional[str], tenant_id: Optional[str]) -> Tuple[object, object, object]:
    """Set per-request contextvars and return tokens for reset."""
    t1 = _trace_id.set(trace_id)
    t2 = _request_id.set(request_id)
    t3 = _tenant_id.set(tenant_id)
    return (t1, t2, t3)


def reset_request_context(tokens: Tuple[object, object, object]) -> None:
    """Reset contextvars using the tokens returned from set_request_context()."""
    t1, t2, t3 = tokens
    _trace_id.reset(t1)  # type: ignore[arg-type]
    _request_id.reset(t2)  # type: ignore[arg-type]
    _tenant_id.reset(t3)  # type: ignore[arg-type]


def get_request_context() -> RequestContext:
    return RequestContext(
        trace_id=_trace_id.get(),
        request_id=_request_id.get(),
        tenant_id=_tenant_id.get(),
    )
