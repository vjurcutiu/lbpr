# core/logging.py
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# -----------------------------
# Reserved LogRecord attributes
# -----------------------------
RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename", "module",
    "exc_info", "exc_text", "stack_info", "lineno", "funcName", "created",
    "msecs", "relativeCreated", "thread", "threadName", "processName", "process",
    "asctime", "message"
}

_SANITIZE_PREFIX = "x_"

def _sanitize_extra(extra: Any) -> Any:
    if not isinstance(extra, dict):
        return extra
    safe: Dict[str, Any] = {}
    for k, v in extra.items():
        safe[k if k not in RESERVED else f"{_SANITIZE_PREFIX}{k}"] = v
    return safe

# -------------------------------------------------------------------------
# Monkey-patch Logger._log to:
# - Sanitize extra
# - Fold arbitrary kwargs (non-standard) into extra for backward compat
# -------------------------------------------------------------------------
_ORIG_LOG = logging.Logger._log  # original

# Avoid double-patching in hot-reload scenarios
if not getattr(logging.Logger, "_lbpr_patched", False):
    def _patched_log(self: logging.Logger, level, msg, args, **kwargs):
        # stdlib-supported kwargs
        allowed = {"extra", "exc_info", "stack_info", "stacklevel"}

        # Pull out user-provided extra (may be None)
        user_extra = kwargs.get("extra") or {}

        # Collect any *non-standard* kwargs and fold them into extra
        folded: Dict[str, Any] = {}
        for k in list(kwargs.keys()):
            if k not in allowed:
                folded[k] = kwargs.pop(k)  # remove unknown kw and fold

        # Merge folded kwargs into extra, user extra wins on conflicts
        if folded:
            if not isinstance(user_extra, dict):
                user_extra = {}
            # Do not overwrite keys already in extra
            for k, v in folded.items():
                user_extra.setdefault(k, v)

        # Sanitize for reserved collisions
        if user_extra:
            kwargs["extra"] = _sanitize_extra(user_extra)

        return _ORIG_LOG(self, level, msg, args, **kwargs)

    logging.Logger._log = _patched_log
    logging.Logger._lbpr_patched = True  # type: ignore[attr-defined]

# --------------------------
# JSON Log Formatter
# --------------------------
class JSONFormatter(logging.Formatter):
    """
    Emits logs as structured JSON similar to:
      {"ts":"2025-10-08T16:05:02.644Z","level":"INFO","name":"app","msg":"http_response", ...}

    Backward compatibility:
      - Keeps base keys: ts, level, name, msg
      - Preserves existing extra fields used across the app
      - Re-exposes sanitized keys (x_<reserved>) as their original names in JSON
    """
    def __init__(self, *, default_level: str = "INFO"):
        super().__init__()
        self.default_level = default_level

    @staticmethod
    def _utc_iso_now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": self._utc_iso_now(),
            "level": record.levelname,
            "name": record.name,
            "msg": record.getMessage(),
        }

        # Common request fields
        for key in ("method", "path", "query", "status", "dur_ms",
                    "client", "trace_id", "request_id", "tenant_id"):
            val = getattr(record, key, None)
            if val is not None:
                payload[key] = val

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack_info"] = self.formatStack(record.stack_info)

        skip = {
            # Built-in
            "name","msg","args","levelname","levelno","pathname","filename","module",
            "exc_info","exc_text","stack_info","lineno","funcName","created","msecs",
            "relativeCreated","thread","threadName","processName","process",
            "asctime","message",
            # already copied
            "method","path","query","status","dur_ms","client","trace_id","request_id","tenant_id",
            # our guard
            "_lbpr_patched",
        }

        extras: Dict[str, Any] = {}
        for attr, value in record.__dict__.items():
            if attr.startswith("_") or attr in skip:
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                extras[attr] = value
            else:
                try:
                    json.dumps(value)  # test
                    extras[attr] = value
                except Exception:
                    extras[attr] = repr(value)

        # Re-expose sanitized reserved keys
        for attr in list(extras.keys()):
            if attr.startswith(_SANITIZE_PREFIX):
                original = attr[len(_SANITIZE_PREFIX):]
                if original in RESERVED:
                    payload[original] = extras.pop(attr)

        payload.update(extras)
        return json.dumps(payload, ensure_ascii=False)

# --------------------------
# Optional plain-text formatter
# --------------------------
class PlainFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        base = f"{ts} {record.levelname} {record.name}: {record.getMessage()}"
        parts = []
        for key in ("method","path","status","dur_ms","trace_id","request_id","tenant_id"):
            val = getattr(record, key, None)
            if val is not None:
                parts.append(f"{key}={val}")
        if record.exc_info:
            parts.append(self.formatException(record.exc_info))
        if parts:
            base += " | " + " ".join(parts)
        return base

# --------------------------
# Configuration helper
# --------------------------
_LEVEL_MAP = {
    "CRITICAL": logging.CRITICAL,
    "ERROR": logging.ERROR,
    "WARNING": logging.WARNING,
    "INFO": logging.INFO,
    "DEBUG": logging.DEBUG,
    "NOTSET": logging.NOTSET,
}

def configure_logging(level: Optional[str] = None) -> None:
    """
    Configure root logger once.
    Respects LOG_LEVEL and LOG_FORMAT (json|plain). Defaults to JSON.
    """
    root = logging.getLogger()
    if getattr(root, "_json_configured", False):
        return

    env_level = (level or os.getenv("LOG_LEVEL") or "INFO").upper()
    lvl = _LEVEL_MAP.get(env_level, logging.INFO)
    root.setLevel(lvl)

    for h in list(root.handlers):
        root.removeHandler(h)

    fmt = (os.getenv("LOG_FORMAT") or "json").lower().strip()
    handler = logging.StreamHandler(stream=sys.stdout)
    if fmt == "plain":
        handler.setFormatter(PlainFormatter())
    else:
        handler.setFormatter(JSONFormatter())

    root.addHandler(handler)

    # quiet noisy libs (tweak as needed)
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("watchfiles").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    root._json_configured = True  # type: ignore[attr-defined]

# --------------------------
# Convenience
# --------------------------
def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)

# --- Backward-compat alias -------------------------------------------------
def setup_logging(level: Optional[str] = None) -> None:
    """Deprecated: use configure_logging(). Kept for backward compatibility."""
    return configure_logging(level)

__all__ = ["configure_logging", "setup_logging", "get_logger"]
