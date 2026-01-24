from __future__ import annotations

import base64
import hashlib
import logging
import re
import secrets
import string
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from core.config import settings
from core.request_context import get_request_context

from firebase_admin import firestore

log = logging.getLogger("pii")
audit_log = logging.getLogger("pii.audit")


# Token format is intentionally filename/path-safe (no slashes/spaces).
# Example: __PII_EMAIL_ADDRESS_3P6J7X...__
TOKEN_RE = re.compile(r"__PII_(?P<type>[A-Z0-9_]+)_(?P<token>[A-Z0-9]+)__")


@dataclass(frozen=True)
class PiiFinding:
    start: int
    end: int
    info_type: str



def _is_enabled() -> bool:
    return bool(settings.PII_ENABLED)


def _audit_enabled() -> bool:
    return _is_enabled() and bool(getattr(settings, "PII_AUDIT_ENABLED", False))


def _audit_plaintext() -> bool:
    # Plaintext audit logs are only allowed in local dev and must be explicitly enabled.
    return _audit_enabled() and settings.ENV == "dev" and bool(getattr(settings, "PII_AUDIT_PLAINTEXT", False))


def _audit_preview_chars() -> int:
    try:
        return int(getattr(settings, "PII_AUDIT_PREVIEW_CHARS", 240) or 240)
    except Exception:
        return 240


def _audit_max_items() -> int:
    try:
        return int(getattr(settings, "PII_AUDIT_MAX_ITEMS", 25) or 25)
    except Exception:
        return 25


def _sha256_short(s: str, n: int = 12) -> str:
    if s is None:
        return ""
    h = hashlib.sha256(s.encode("utf-8", errors="replace")).hexdigest()
    return h[:n]


def _preview(s: str) -> str:
    if not s:
        return ""
    m = _audit_preview_chars()
    return s[:m]


def _dlp_project() -> str:
    return (settings.PII_DLP_PROJECT_ID or settings.FIREBASE_PROJECT_ID or "").strip()


def _dlp_parent() -> str:
    proj = _dlp_project()
    if not proj:
        raise RuntimeError("PII_DLP_PROJECT_ID or FIREBASE_PROJECT_ID must be set when PII_ENABLED=1")
    loc = (settings.PII_DLP_LOCATION or "global").strip() or "global"
    # Docs: use projects/<project>/locations/<location> for regional endpoints.
    return f"projects/{proj}/locations/{loc}"


def _kms_key_name() -> str:
    name = (settings.PII_KMS_KEY_NAME or "").strip()
    if not name:
        raise RuntimeError("PII_KMS_KEY_NAME must be set when PII_ENABLED=1")
    return name


def _info_types() -> List[str]:
    raw = (settings.PII_DLP_INFOTYPES or "").strip()
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if not parts:
        # DLP best practices: always specify infoTypes explicitly.
        parts = ["EMAIL_ADDRESS", "PHONE_NUMBER"]
    return parts


def _min_likelihood() -> str:
    ml = (settings.PII_DLP_MIN_LIKELIHOOD or "LIKELY").strip().upper()
    allowed = {"VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY", "LIKELIHOOD_UNSPECIFIED"}
    return ml if ml in allowed else "LIKELY"


def extract_tokens(text: str) -> Set[str]:
    if not text:
        return set()
    return {m.group("token") for m in TOKEN_RE.finditer(text)}


def _has_tokens(text: str) -> bool:
    return bool(text and "__PII_" in text)


# ------------------------- Firestore token vault ---------------------------

def _cust_ref(uid: str):
    return firestore.client().collection("customers").document(uid)


def _token_ref(uid: str, token: str):
    return _cust_ref(uid).collection("pii_tokens").document(token)


def _hash_ref(uid: str, h: str):
    return _cust_ref(uid).collection("pii_hash").document(h)


# Small per-process cache to reduce decrypt traffic.
_PLAINTEXT_CACHE: Dict[Tuple[str, str], str] = {}
_CACHE_MAX = 20000


def _cache_get(uid: str, token: str) -> Optional[str]:
    return _PLAINTEXT_CACHE.get((uid, token))


def _cache_put(uid: str, token: str, value: str) -> None:
    if not uid or not token:
        return
    if len(_PLAINTEXT_CACHE) >= _CACHE_MAX:
        # Very simple eviction: drop 10% of the cache.
        for k in list(_PLAINTEXT_CACHE.keys())[: max(1, _CACHE_MAX // 10)]:
            _PLAINTEXT_CACHE.pop(k, None)
    _PLAINTEXT_CACHE[(uid, token)] = value


def _normalize_value(info_type: str, value: str) -> str:
    v = (value or "").strip()
    if not v:
        return ""
    t = info_type.upper()
    if t == "EMAIL_ADDRESS":
        return v.lower()
    if t == "PHONE_NUMBER":
        # Keep leading +, strip punctuation/spaces.
        out = []
        for ch in v:
            if ch.isdigit() or ch == "+":
                out.append(ch)
        return "".join(out)
    # Names, addresses, etc.: collapse whitespace.
    return " ".join(v.split())


def _value_hash(uid: str, info_type: str, value: str) -> str:
    norm = _normalize_value(info_type, value)
    h = hashlib.sha256(f"{uid}|{info_type.upper()}|{norm}".encode("utf-8")).hexdigest()
    return h


def _new_token_id(nbytes: int = 10) -> str:
    # base32 without padding, uppercase; filename/path safe.
    b = secrets.token_bytes(nbytes)
    return base64.b32encode(b).decode("ascii").rstrip("=")


def _kms_encrypt(uid: str, info_type: str, plaintext: str) -> str:
    from google.cloud import kms  # imported lazily

    client = kms.KeyManagementServiceClient()
    aad = f"{uid}:{info_type.upper()}".encode("utf-8")
    resp = client.encrypt(
        request={
            "name": _kms_key_name(),
            "plaintext": plaintext.encode("utf-8"),
            "additional_authenticated_data": aad,
        }
    )
    return base64.b64encode(resp.ciphertext).decode("ascii")


def _kms_decrypt(uid: str, info_type: str, ciphertext_b64: str) -> str:
    from google.cloud import kms  # imported lazily

    client = kms.KeyManagementServiceClient()
    aad = f"{uid}:{info_type.upper()}".encode("utf-8")
    resp = client.decrypt(
        request={
            "name": _kms_key_name(),
            "ciphertext": base64.b64decode(ciphertext_b64.encode("ascii")),
            "additional_authenticated_data": aad,
        }
    )
    return resp.plaintext.decode("utf-8", errors="replace")


def _get_or_create_token_internal(uid: str, info_type: str, value: str) -> tuple[str, bool]:
    """Return (token, created).

    created=True means we created a new mapping (hash doc did not exist at time of call).
    """
    if not _is_enabled():
        return ("", False)
    if not uid:
        raise RuntimeError("uid required")

    info_type = (info_type or "UNKNOWN").upper()
    raw = (value or "")
    if not raw.strip():
        return ("", False)

    h = _value_hash(uid, info_type, raw)
    href = _hash_ref(uid, h)
    snap = href.get()
    if snap.exists:
        tok = str((snap.to_dict() or {}).get("token") or "")
        if tok:
            return (tok, False)

    created = True
    token = _new_token_id()

    # Try to create the hash doc; if it already exists, use the existing token.
    try:
        href.create({"token": token, "type": info_type, "created_at_ts": firestore.SERVER_TIMESTAMP})
    except Exception:
        snap2 = href.get()
        if snap2.exists:
            tok = str((snap2.to_dict() or {}).get("token") or "")
            if tok:
                token = tok
                created = False

    # Ensure token doc exists (idempotent).
    tref = _token_ref(uid, token)
    if not tref.get().exists:
        ct = _kms_encrypt(uid, info_type, raw)
        tref.set(
            {
                "ciphertext": ct,
                "type": info_type,
                "hash": h,
                "kms_key": _kms_key_name(),
                "created_at_ts": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    return (token, created)


def get_or_create_token_meta(uid: str, info_type: str, value: str) -> tuple[str, bool]:
    """Return (token, created)."""
    return _get_or_create_token_internal(uid, info_type, value)


def get_or_create_token(uid: str, info_type: str, value: str) -> str:
    """Return a stable token for the (uid, info_type, value) triple."""
    tok, _created = _get_or_create_token_internal(uid, info_type, value)
    return tok



def resolve_tokens(uid: str, tokens: Sequence[str]) -> Dict[str, str]:
    """Resolve token ids to plaintext values."""
    out: Dict[str, str] = {}
    if not _is_enabled() or not uid or not tokens:
        return out

    missing: List[str] = []
    for t in tokens:
        v = _cache_get(uid, t)
        if v is not None:
            out[t] = v
        else:
            missing.append(t)

    if not missing:
        return out

    refs = [_token_ref(uid, t) for t in missing]
    snaps = firestore.client().get_all(refs)
    for snap in snaps:
        if not snap.exists:
            continue
        d = snap.to_dict() or {}
        tok = snap.id
        ct = str(d.get("ciphertext") or "")
        typ = str(d.get("type") or "UNKNOWN").upper()
        if not ct:
            continue
        try:
            pt = _kms_decrypt(uid, typ, ct)
            out[tok] = pt
            _cache_put(uid, tok, pt)
        except Exception as e:
            log.warning("pii_decrypt_failed", extra={"uid": uid, "token": tok, "error": str(e)})
            continue
    return out


# ------------------------------- DLP scan ----------------------------------

def _dlp_findings(text: str, *, allow_tokens: bool = False) -> List[PiiFinding]:
    """Use Google Sensitive Data Protection (DLP API) to find PII spans."""
    if not _is_enabled() or not text:
        return []
    if _has_tokens(text) and not allow_tokens:
        # Avoid double-tokenization in normal flows.
        return []

    from google.cloud import dlp_v2  # imported lazily

    client = dlp_v2.DlpServiceClient()
    inspect_config = {
        "info_types": [{"name": it} for it in _info_types()],
        "min_likelihood": _min_likelihood(),
        "include_quote": True,
        "limits": {"max_findings_per_request": 0},
    }
    item = {"value": text}
    resp = client.inspect_content(request={"parent": _dlp_parent(), "inspect_config": inspect_config, "item": item})

    findings: List[PiiFinding] = []
    for f in resp.result.findings:
        try:
            info = str(f.info_type.name or "UNKNOWN").upper()
        except Exception:
            info = "UNKNOWN"

        start = None
        end = None
        try:
            loc = f.location
            if getattr(loc, "codepoint_range", None):
                start = int(loc.codepoint_range.start)
                end = int(loc.codepoint_range.end)
            elif getattr(loc, "byte_range", None):
                start = int(loc.byte_range.start)
                end = int(loc.byte_range.end)
        except Exception:
            start = None
            end = None

        if start is None or end is None:
            continue
        if start < 0 or end <= start or end > len(text):
            continue
        findings.append(PiiFinding(start=start, end=end, info_type=info))

    if not findings:
        return []

    # Sort by start asc, then longer spans first.
    findings.sort(key=lambda x: (x.start, -(x.end - x.start)))

    # De-overlap: keep first, drop anything that overlaps an accepted span.
    filtered: List[PiiFinding] = []
    last_end = -1
    for f in findings:
        if f.start < last_end:
            continue
        filtered.append(f)
        last_end = f.end
    return filtered


def tokenize_text(uid: str, text: str) -> str:
    """Tokenize PII in text using DLP spans and the vault.

    When audit logging is enabled, emits a structured log containing counts, hashes, and (optionally)
    plaintext previews in dev only.
    """
    if not _is_enabled() or not text:
        return text
    spans = _dlp_findings(text)
    if not spans:
        return text

    before = text
    out = text
    replacements = []
    created_count = 0
    # Replace from end to start to preserve offsets.
    for f in sorted(spans, key=lambda x: x.start, reverse=True):
        raw = out[f.start : f.end]
        tok, created = get_or_create_token_meta(uid, f.info_type, raw)
        if not tok:
            continue
        created_count += 1 if created else 0
        token_str = f"__PII_{f.info_type}_{tok}__"
        replacements.append({
            'type': f.info_type,
            'start': f.start,
            'end': f.end,
            'raw_len': len(raw),
            'raw_sha256_8': hashlib.sha256(raw.encode('utf-8')).hexdigest()[:8],
            'token': tok,
        })
        out = out[: f.start] + token_str + out[f.end :]

    if _audit_enabled():
        ctx = get_request_context()
        # By default we only log hashes/lengths. Plaintext previews are dev-only and require explicit opt-in.
        include_plain = _audit_plaintext()
        max_items = _audit_max_items()
        preview_n = _audit_preview_chars()
        post_findings = []
        post_count = None
        try:
            if bool(settings.PII_AUDIT_VERIFY_POST):
                post_findings = _dlp_findings(out, allow_tokens=True)
                post_count = len(post_findings)
        except Exception as e:
            audit_log.warning('pii_post_verify_failed', error=str(e), trace_id=ctx.trace_id, request_id=ctx.request_id, tenant_id=ctx.tenant_id, uid=uid)
        # Aggregate types
        types = {}
        for r in replacements:
            types[r['type']] = types.get(r['type'], 0) + 1
        extra = {
            'event': 'pii_tokenize_audit',
            'uid': uid,
            'trace_id': ctx.trace_id,
            'request_id': ctx.request_id,
            'tenant_id': ctx.tenant_id,
            'before_len': len(before),
            'after_len': len(out),
            'finding_count': len(spans),
            'types': types,
            'created_mappings': created_count,
            'before_sha256_12': hashlib.sha256(before.encode('utf-8')).hexdigest()[:12],
            'after_sha256_12': hashlib.sha256(out.encode('utf-8')).hexdigest()[:12],
            'post_findings_count': post_count,
            'replacements': list(reversed(replacements))[:max_items],
        }
        if include_plain:
            extra['before_preview'] = before[:preview_n]
            extra['after_preview'] = out[:preview_n]
        audit_log.info('pii_tokenize', **extra)

    return out


def detokenize_text(uid: str, text: str) -> str:
    """Replace tokens back to plaintext for user-facing output.

    When audit logging is enabled, emits a structured log about detokenization.
    """
    if not _is_enabled() or not text:
        return text
    if '__PII_' not in text:
        return text

    before = text
    token_ids = extract_tokens(text)
    if not token_ids:
        return text
    mapping = resolve_tokens(uid, list(token_ids))

    def _repl(m: re.Match) -> str:
        tok = m.group('token')
        return mapping.get(tok, m.group(0))

    out = TOKEN_RE.sub(_repl, text)

    if _audit_enabled():
        ctx = get_request_context()
        include_plain = _audit_plaintext()
        preview_n = _audit_preview_chars()
        unresolved = len(token_ids) - len(mapping)
        extra = {
            'event': 'pii_detokenize_audit',
            'uid': uid,
            'trace_id': ctx.trace_id,
            'request_id': ctx.request_id,
            'tenant_id': ctx.tenant_id,
            'token_count': len(token_ids),
            'resolved_count': len(mapping),
            'unresolved_count': unresolved,
            'before_len': len(before),
            'after_len': len(out),
            'before_sha256_12': hashlib.sha256(before.encode('utf-8')).hexdigest()[:12],
            'after_sha256_12': hashlib.sha256(out.encode('utf-8')).hexdigest()[:12],
        }
        if include_plain:
            extra['before_preview'] = before[:preview_n]
            extra['after_preview'] = out[:preview_n]
        audit_log.info('pii_detokenize', **extra)

    return out


def detokenize_many(uid: str, texts: Sequence[str]) -> List[str]:
    if not _is_enabled() or not texts:
        return list(texts)
    # Batch resolve across all strings.
    toks: Set[str] = set()
    for t in texts:
        toks |= extract_tokens(t or "")
    mapping = resolve_tokens(uid, list(toks)) if toks else {}

    def _sub_one(s: str) -> str:
        if not s or "__PII_" not in s:
            return s

        def _repl(m: re.Match) -> str:
            tok = m.group("token")
            return mapping.get(tok, m.group(0))

        return TOKEN_RE.sub(_repl, s)

    return [_sub_one(s) for s in texts]
