"""Helpers for extracting useful details from Google/gRPC exceptions.

We intentionally keep this dependency-light (no grpcio-status) so it works in dev/prod
with just google-cloud-* libraries installed.

The main purpose is to surface the server-provided error string (often much more
actionable than the default exception __str__()).
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def _safe_call(obj: Any, name: str) -> Optional[Any]:
    """Get attr and call it if callable. Return None on any error."""
    try:
        attr = getattr(obj, name, None)
        if attr is None:
            return None
        if callable(attr):
            try:
                return attr()
            except Exception:
                return None
        return attr
    except Exception:
        return None


def extract_grpc_error_info(err: Exception) -> Dict[str, Any]:
    """Best-effort extraction of details from grpc/google exceptions.

    Returns a dict safe to attach to structured logs.
    """
    info: Dict[str, Any] = {
        "exc_type": type(err).__name__,
    }

    # Common google.api_core exceptions expose a message/details via __str__
    try:
        info["exc_str"] = str(err)
    except Exception:
        pass

    # grpc RpcError (or compatible wrappers) often provide these callables.
    code = _safe_call(err, "code")
    details = _safe_call(err, "details")
    debug = _safe_call(err, "debug_error_string")

    # Some wrappers return enums; stringify for JSON logs.
    if code is not None:
        info["grpc_code"] = str(code)
    if details:
        # Keep details bounded; it's sometimes large.
        s = str(details)
        info["grpc_details"] = s if len(s) <= 2000 else (s[:2000] + "…")
    if debug:
        s = str(debug)
        info["grpc_debug_error_string"] = s if len(s) <= 2000 else (s[:2000] + "…")

    # Try to detect underlying grpc.RpcError if err wraps it.
    # google.api_core exceptions sometimes store the original as .response or .cause
    for candidate_attr in ("cause", "__cause__", "original_exception", "response"):
        inner = _safe_call(err, candidate_attr)
        if inner and inner is not err:
            inner_code = _safe_call(inner, "code")
            inner_details = _safe_call(inner, "details")
            inner_debug = _safe_call(inner, "debug_error_string")
            if inner_code is not None and "grpc_code" not in info:
                info["grpc_code"] = str(inner_code)
            if inner_details and "grpc_details" not in info:
                s = str(inner_details)
                info["grpc_details"] = s if len(s) <= 2000 else (s[:2000] + "…")
            if inner_debug and "grpc_debug_error_string" not in info:
                s = str(inner_debug)
                info["grpc_debug_error_string"] = s if len(s) <= 2000 else (s[:2000] + "…")

    return info


def format_grpc_error_for_user(err: Exception) -> str:
    """Produce a short, user-facing error string, prioritizing server details."""
    info = extract_grpc_error_info(err)
    code = info.get("grpc_code")
    details = info.get("grpc_details")

    if code and details:
        return f"{code}: {details}"
    if details:
        return str(details)
    # fallback
    return info.get("exc_str") or str(err)
