import logging
import os
import sys
import json
from datetime import datetime

_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "level": record.levelname,
            "name": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            data["exc_info"] = self.formatException(record.exc_info)
        # Attach any extra fields placed on the record
        for k, v in record.__dict__.items():
            if k not in (
                "name","msg","args","levelname","levelno","pathname",
                "filename","module","exc_info","exc_text","stack_info",
                "lineno","funcName","created","msecs","relativeCreated",
                "thread","threadName","processName","process","stacklevel"
            ):
                try:
                    json.dumps({k: v})
                    data[k] = v
                except Exception:
                    data[k] = str(v)
        return json.dumps(data, ensure_ascii=False)

_ORIG_LOG = None

def _patch_logging_to_allow_kv():
    """Monkey-patch logging.Logger._log to accept key=value kwargs.

    Any unexpected keyword args passed to logger methods (info, warning, etc.)
    are merged into the `extra` dict, so code like:
        log.info("event_name", user_id=123, status="ok")
    works without raising `TypeError: Logger._log() got an unexpected keyword arg ...`.
    """
    global _ORIG_LOG
    if _ORIG_LOG is not None:
        return
    _ORIG_LOG = logging.Logger._log

    def _log(self, level, msg, args,
             exc_info=None, extra=None, stack_info=False, stacklevel=1, **kwargs):
        # Merge arbitrary kv into `extra`.
        if kwargs:
            if extra is None:
                extra = {}
            # don't let kwargs overwrite reserved keys in record
            reserved = {
                "name","msg","args","levelname","levelno","pathname",
                "filename","module","exc_info","exc_text","stack_info",
                "lineno","funcName","created","msecs","relativeCreated",
                "thread","threadName","processName","process","stacklevel"
            }
            for k in list(kwargs.keys()):
                if k in reserved:
                    # prefix if someone accidentally used a reserved key
                    kwargs[f"field_{k}"] = kwargs.pop(k)
            extra.update(kwargs)
        return _ORIG_LOG(self, level, msg, args,
                         exc_info=exc_info, extra=extra,
                         stack_info=stack_info, stacklevel=stacklevel)

    logging.Logger._log = _log

def setup_logging() -> None:
    # Ensure kv logging works before any handlers process records.
    _patch_logging_to_allow_kv()

    root = logging.getLogger()
    if root.handlers:
        return  # already configured
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(_LEVEL)
