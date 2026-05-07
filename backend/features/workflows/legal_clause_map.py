from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any, Iterable

from features.files import service as files_service
from features.rag import chunk_store
from .models import WorkflowSourceFile

try:  # Optional at test time and in local dev without OpenAI installed.
    from features.rag.adapters.openai_chat import OpenAIChat  # type: ignore
except Exception:  # pragma: no cover
    OpenAIChat = None  # type: ignore

log = logging.getLogger("workflows.legal_clause_map")

CLAUSE_MAP_VERSION = 1
CLAUSE_MAP_ARTIFACT_NAME = "contract_clause_map.v1.json"
CLAUSE_MAP_JSON_START = "CONTRACT_CLAUSE_MAP_JSON_START"
CLAUSE_MAP_JSON_END = "CONTRACT_CLAUSE_MAP_JSON_END"
CLAUSE_MAP_NANO_MODEL_ENV = "LEGAL_CLAUSE_MAP_NANO_MODEL"
CLAUSE_MAP_INGEST_ENABLED_ENV = "LEGAL_CLAUSE_MAP_INGEST_ENABLED"
CLAUSE_MAP_LLM_ENABLED_ENV = "LEGAL_CLAUSE_MAP_LLM_ENABLED"
DEFAULT_CLAUSE_MAP_NANO_MODEL = "gpt-5-nano"
MAX_LLM_CHUNKS = 80
MAX_CHARS_PER_LLM_CHUNK = 6500

LEGAL_CLAUSE_FAMILY_LABELS: dict[str, str] = {
    "confidentiality": "Confidentiality",
    "indemnity": "Indemnity",
    "limitation_of_liability": "Limitation of Liability",
    "termination": "Termination",
    "renewal": "Renewal",
    "ip_ownership": "IP Ownership",
    "data_protection": "Data Protection",
    "governing_law": "Governing Law",
    "payment": "Payment",
    "assignment": "Assignment",
    "audit": "Audit",
    "insurance": "Insurance",
    "non_solicit": "Non-Solicit",
    "exclusivity": "Exclusivity / Standstill",
    "warranties": "Warranties / Service Levels",
    "dispute_resolution": "Dispute Resolution",
    "change_control": "Change Control",
    "notices": "Notices",
}

# Phrases are intentionally specific. Short/ambiguous terms are allowed only as
# weak signals; a clause is marked found only when the combined chunk signal is
# strong enough and not just a table of contents / heading hit.
LEGAL_CLAUSE_FAMILY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "confidentiality": (
        "confidential information", "confidentiality", "non-disclosure", "non disclosure",
        "proprietary information", "trade secret", "recipient shall keep", "receiving party shall",
    ),
    "indemnity": (
        "indemnify", "indemnification", "defend", "hold harmless", "third-party claim",
        "third party claim", "indemnified party", "indemnifying party",
    ),
    "limitation_of_liability": (
        "limitation of liability", "aggregate liability", "total liability", "liability cap",
        "consequential damages", "indirect damages", "special damages", "punitive damages",
        "lost profits", "loss of data", "business interruption",
    ),
    "termination": (
        "termination", "terminate this agreement", "terminate the agreement", "termination for cause",
        "termination for convenience", "effect of termination", "upon termination", "survival",
        "wind-down", "wind down", "transition assistance",
    ),
    "renewal": (
        "renewal", "renew automatically", "auto-renew", "automatic renewal", "non-renewal",
        "initial term", "renewal term", "expiration of the term",
    ),
    "ip_ownership": (
        "intellectual property", "work product", "deliverables", "ownership", "pre-existing materials",
        "background ip", "foreground ip", "license to use", "source code", "assignment of rights",
    ),
    "data_protection": (
        "data protection", "data security", "personal data", "personal information", "security breach",
        "breach notification", "incident", "unauthorized access", "encryption", "subprocessor",
        "protected health", "customer data", "client data",
    ),
    "governing_law": (
        "governing law", "governed by", "laws of the state", "laws of", "jurisdiction",
        "venue", "courts located", "exclusive jurisdiction",
    ),
    "payment": (
        "payment", "fees", "invoice", "invoicing", "taxes", "charges", "payable",
        "disputed invoice", "payment terms", "late fees", "expenses",
    ),
    "assignment": (
        "assignment", "assign", "may not assign", "change of control", "successor", "affiliate",
        "transfer this agreement", "merger", "acquisition",
    ),
    "audit": (
        "audit", "inspect", "inspection", "records", "soc 1", "soc 2", "certification",
        "penetration test", "assessment", "questionnaire", "audit report",
    ),
    "insurance": (
        "insurance", "insured", "coverage", "policy", "certificate of insurance", "additional insured",
        "workers compensation", "professional liability", "cyber liability",
    ),
    "non_solicit": (
        "non-solicit", "non solicit", "solicit employees", "solicitation", "recruit", "hire away",
        "employees of", "no hire",
    ),
    "exclusivity": (
        "exclusive", "exclusivity", "standstill", "non-compete", "non compete", "not compete",
        "restrictive covenant", "most favored", "preferred provider",
    ),
    "warranties": (
        "warranty", "warranties", "represents and warrants", "service levels", "service level",
        "sla", "uptime", "availability", "service credits", "remedy", "performance standards",
    ),
    "dispute_resolution": (
        "dispute resolution", "arbitration", "mediation", "injunctive relief", "equitable relief",
        "jury trial", "venue", "exclusive jurisdiction", "courts", "litigation",
    ),
    "change_control": (
        "change order", "change request", "change control", "statement of work", "sow",
        "approval", "approved in writing", "amendment", "modification",
    ),
    "notices": (
        "notices", "notice", "written notice", "notify", "address for notices", "mail", "courier",
        "email notice", "facsimile",
    ),
}

WORKFLOW_REQUIRED_CLAUSE_FAMILIES: dict[str, tuple[str, ...]] = {
    "legal_nda_review": (
        "confidentiality", "termination", "assignment", "governing_law",
        "dispute_resolution", "non_solicit", "exclusivity",
    ),
    "legal_msa_review": (
        "payment", "termination", "renewal", "warranties", "limitation_of_liability",
        "indemnity", "ip_ownership", "data_protection", "audit", "insurance",
        "assignment", "change_control", "notices", "governing_law", "dispute_resolution",
    ),
    "legal_contract_review": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_contract_risk_matrix": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_clause_extraction": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_fallback_language": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_negotiation_brief": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_obligation_tracker": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_matter_handoff": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
}

_OPERATIVE_TERMS = (
    "shall", "must", "will", "may", "agrees", "agree", "liable", "liability", "indemnify",
    "defend", "pay", "provide", "maintain", "warrant", "terminate", "assign", "notify",
    "confidential", "obligation", "right", "remedy", "consent", "approval", "breach",
)
_WEAK_ONLY_TERMS = {"data", "notice", "approval", "employee", "affiliate", "courts", "records", "tax", "charges"}
_TOC_HINT_RE = re.compile(r"\b(table of contents|contents|index)\b", re.IGNORECASE)
_HEADING_LINE_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)*|[A-Z]|ARTICLE|SECTION|EXHIBIT|SCHEDULE)\b", re.IGNORECASE)


def normalize_contract_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def required_clause_families(workflow_id: str) -> tuple[str, ...]:
    return WORKFLOW_REQUIRED_CLAUSE_FAMILIES.get(workflow_id, tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()))


def clause_map_artifact_path(file_id: str) -> str:
    base = str(file_id or "").rsplit("/", 1)[0]
    return f"{base}/{CLAUSE_MAP_ARTIFACT_NAME}" if base else CLAUSE_MAP_ARTIFACT_NAME


def _bucket_blob(path: str):
    return files_service._bucket().blob(path)  # type: ignore[attr-defined]


def chunk_fingerprint(chunks: Iterable[chunk_store.StoredChunk]) -> str:
    h = hashlib.sha256()
    count = 0
    for chunk in chunks:
        count += 1
        h.update(str(chunk.chunk_id).encode("utf-8"))
        h.update(b"\0")
        h.update(str(chunk.chunk_index).encode("utf-8"))
        h.update(b"\0")
        h.update(chunk.text.encode("utf-8", errors="ignore"))
        h.update(b"\0")
    h.update(str(count).encode("utf-8"))
    return h.hexdigest()


def _load_stored_clause_map(uid: str, file_id: str, fingerprint: str) -> dict[str, Any] | None:
    try:
        files_service._assert_user_owns(uid, file_id)  # type: ignore[attr-defined]
        blob = _bucket_blob(clause_map_artifact_path(file_id))
        if not blob.exists():
            return None
        payload = json.loads(blob.download_as_bytes().decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        source = payload.get("source_file") if isinstance(payload.get("source_file"), dict) else {}
        if source.get("chunk_fingerprint") != fingerprint:
            return None
        return payload
    except Exception:
        log.debug("legal_clause_map_load_failed", uid=uid, file_id=file_id, exc_info=True)
        return None


def _persist_clause_map(uid: str, file_id: str, payload: dict[str, Any]) -> str | None:
    try:
        files_service._assert_user_owns(uid, file_id)  # type: ignore[attr-defined]
        path = clause_map_artifact_path(file_id)
        _bucket_blob(path).upload_from_string(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            content_type="application/json",
        )
        return path
    except Exception:
        log.warning("legal_clause_map_store_failed", uid=uid, file_id=file_id, exc_info=True)
        return None


def _line_shape(text: str) -> tuple[int, int]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    headingish = sum(1 for line in lines if len(line) <= 120 and _HEADING_LINE_RE.search(line))
    return len(lines), headingish


def _looks_like_toc_or_heading_only(text: str, keyword_hits: list[str]) -> bool:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        return True
    if _TOC_HINT_RE.search(clean[:800]):
        lines, headingish = _line_shape(text)
        if lines >= 5 and headingish >= max(3, lines // 2):
            return True
    if len(clean) < 260 and not any(term in clean.lower() for term in _OPERATIVE_TERMS):
        return True
    # A chunk with only a heading phrase like "Limitation of Liability" should not
    # become a found operative clause.
    if len(clean) < 180 and keyword_hits and all(hit.lower() in clean.lower() for hit in keyword_hits[:1]):
        return not any(term in clean.lower() for term in _OPERATIVE_TERMS)
    return False


def _keyword_hits(text: str, keywords: tuple[str, ...]) -> list[str]:
    lowered = (text or "").lower()
    hits: list[str] = []
    for keyword in keywords:
        if keyword.lower() in lowered:
            hits.append(keyword)
    return hits


def _score_chunk(text: str, family: str, keywords: tuple[str, ...]) -> tuple[float, list[str]]:
    clean = text or ""
    lowered = clean.lower()
    hits = _keyword_hits(clean, keywords)
    if not hits:
        return 0.0, []
    score = 0.0
    for hit in hits:
        key = hit.lower()
        if key in _WEAK_ONLY_TERMS:
            score += 0.35
        elif len(key) >= 12 or " " in key or "-" in key:
            score += 2.0
        else:
            score += 0.85
    if any(term in lowered for term in _OPERATIVE_TERMS):
        score += 1.0
    if _looks_like_toc_or_heading_only(clean, hits):
        score -= 2.5
    # Family-specific high signal boosts.
    if family == "limitation_of_liability" and ("consequential" in lowered or "aggregate liability" in lowered or "liability cap" in lowered):
        score += 1.25
    if family == "indemnity" and ("indemnify" in lowered or "indemnification" in lowered):
        score += 1.25
    if family == "data_protection" and ("breach" in lowered or "personal data" in lowered or "security" in lowered):
        score += 0.75
    if family == "governing_law" and ("governed by" in lowered or "governing law" in lowered):
        score += 1.5
    return score, hits


def _excerpt(text: str, keywords: list[str], *, limit: int = 1200) -> str:
    clean = normalize_contract_text(text)
    if len(clean) <= limit:
        return clean
    lowered = clean.lower()
    positions = [lowered.find(hit.lower()) for hit in keywords if lowered.find(hit.lower()) >= 0]
    center = min(positions) if positions else 0
    start = max(0, center - limit // 3)
    end = min(len(clean), start + limit)
    snippet = clean[start:end].strip()
    if start > 0:
        snippet = "…" + snippet
    if end < len(clean):
        snippet += "…"
    return snippet


def _merge_candidate_text(chunks: list[chunk_store.StoredChunk], center_idx: int, *, radius_before: int = 1, radius_after: int = 1) -> tuple[str, list[chunk_store.StoredChunk]]:
    by_index = {chunk.chunk_index: chunk for chunk in chunks}
    selected: list[chunk_store.StoredChunk] = []
    for idx in range(max(0, center_idx - radius_before), center_idx + radius_after + 1):
        item = by_index.get(idx)
        if item is not None:
            selected.append(item)
    if not selected:
        selected = [chunk for chunk in chunks if chunk.chunk_index == center_idx]
    return "\n\n".join(chunk.text for chunk in selected), selected


def _source_spans(selected: list[chunk_store.StoredChunk]) -> list[dict[str, Any]]:
    return [
        {
            "chunk_id": chunk.chunk_id,
            "chunk_index": chunk.chunk_index,
            "span": chunk.span,
        }
        for chunk in selected
    ]


def _best_candidates(chunks: list[chunk_store.StoredChunk], family: str) -> list[dict[str, Any]]:
    keywords = LEGAL_CLAUSE_FAMILY_KEYWORDS.get(family, ())
    candidates: list[dict[str, Any]] = []
    for chunk in chunks:
        score, hits = _score_chunk(chunk.text, family, keywords)
        if score <= 0:
            continue
        candidates.append({"chunk": chunk, "score": score, "hits": hits})
    candidates.sort(key=lambda item: float(item.get("score") or 0.0), reverse=True)
    return candidates[:5]


def _inventory_item(chunks: list[chunk_store.StoredChunk], family: str) -> dict[str, Any]:
    label = LEGAL_CLAUSE_FAMILY_LABELS.get(family, family.replace("_", " ").title())
    candidates = _best_candidates(chunks, family)
    if not candidates:
        return {
            "clause_family": family,
            "clause_family_label": label,
            "status": "not_found_after_full_chunk_scan",
            "confidence": "medium",
            "summary": f"No {label} clause was found after scanning all stored chunks.",
            "source_basis": "Full stored chunk scan did not find qualifying clause language.",
            "source_spans": [],
            "source_excerpt": "",
            "candidate_count": 0,
        }

    best = candidates[0]
    chunk = best["chunk"]
    score = float(best.get("score") or 0.0)
    hits = list(best.get("hits") or [])
    merged_text, selected_chunks = _merge_candidate_text(chunks, int(chunk.chunk_index))
    heading_only = _looks_like_toc_or_heading_only(chunk.text, hits)
    if score >= 2.25 and not heading_only:
        status = "found"
        confidence = "high" if score >= 4.0 else "medium"
        summary = _excerpt(merged_text, hits, limit=420).strip(" …") or f"{label} language was found in the stored chunk scan."
        source_basis = f"Found by full stored chunk scan in chunk(s): {', '.join(item.chunk_id for item in selected_chunks)}."
    else:
        status = "uncertain"
        confidence = "low"
        summary = f"Potential {label} language was detected, but it may be a heading, cross-reference, definition, or weak match. Confirm before treating it as an operative clause."
        source_basis = f"Weak candidate detected in chunk {chunk.chunk_id}; score={score:.2f}; hits={', '.join(hits[:4])}."

    return {
        "clause_family": family,
        "clause_family_label": label,
        "status": status,
        "confidence": confidence,
        "summary": summary,
        "source_basis": source_basis,
        "source_spans": _source_spans(selected_chunks),
        "source_excerpt": _excerpt(merged_text, hits, limit=1200),
        "candidate_count": len(candidates),
        "top_hits": hits[:6],
        "score": round(score, 2),
    }


def _env_enabled(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _base_clause_map(
    *,
    file_id: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
    chunks: list[chunk_store.StoredChunk],
    workflow_id: str,
    artifact_path: str | None = None,
) -> dict[str, Any]:
    families = tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys())
    fingerprint = chunk_fingerprint(chunks)
    inventory = [_inventory_item(chunks, family) for family in families]
    found = sorted(item["clause_family"] for item in inventory if item.get("status") == "found")
    not_found = sorted(item["clause_family"] for item in inventory if item.get("status") == "not_found_after_full_chunk_scan")
    uncertain = sorted(item["clause_family"] for item in inventory if item.get("status") == "uncertain")
    full_text_chars = sum(len(chunk.text) for chunk in chunks)
    clause_map_id = f"contract_clause_map.v1:{hashlib.sha256((file_id + ':' + fingerprint).encode('utf-8')).hexdigest()[:16]}"
    return {
        "version": CLAUSE_MAP_VERSION,
        "clause_map_id": clause_map_id,
        "artifact_path": artifact_path,
        "workflow_id": workflow_id,
        "coverage_method": "deterministic_full_stored_chunk_clause_scan_v1",
        "coverage_status": "full_chunk_scan",
        "source_file": {
            "file_id": file_id,
            "name": name,
            "folder_path": folder_path,
            "content_type": content_type,
            "full_text_chars": full_text_chars,
            "chunk_count": len(chunks),
            "chunk_fingerprint": fingerprint,
        },
        "required_clause_families": list(required_clause_families(workflow_id)),
        "found_clause_families": found,
        "not_found_clause_families": not_found,
        "uncertain_clause_families": uncertain,
        "clause_inventory": inventory,
        "discovered_clauses": [],
        "generation": {
            "method": "deterministic",
            "generated_at": _now_iso(),
        },
    }


def _json_from_model_text(text: str) -> dict[str, Any] | None:
    clean = str(text or "").strip()
    if not clean:
        return None
    fence = re.search(r"```(?:json)?\s*(.*?)\s*```", clean, re.DOTALL | re.IGNORECASE)
    if fence:
        clean = fence.group(1).strip()
    try:
        payload = json.loads(clean)
        return payload if isinstance(payload, dict) else None
    except Exception:
        pass
    start = clean.find("{")
    end = clean.rfind("}")
    if start >= 0 and end > start:
        try:
            payload = json.loads(clean[start:end + 1])
            return payload if isinstance(payload, dict) else None
        except Exception:
            return None
    return None


def _slug(value: str, *, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")
    return slug[:80] or fallback


def _chunk_by_id(chunks: list[chunk_store.StoredChunk]) -> dict[str, chunk_store.StoredChunk]:
    out: dict[str, chunk_store.StoredChunk] = {}
    for chunk in chunks:
        out[chunk.chunk_id] = chunk
        out[f"ch_{chunk.chunk_index}"] = chunk
    return out


def _normalize_source_spans(raw_spans: Any, *, chunks: list[chunk_store.StoredChunk], file_id: str) -> list[dict[str, Any]]:
    by_id = _chunk_by_id(chunks)
    spans: list[dict[str, Any]] = []
    for raw in raw_spans or []:
        if not isinstance(raw, dict):
            continue
        chunk_id = str(raw.get("chunk_id") or raw.get("id") or "").strip()
        chunk_index = raw.get("chunk_index")
        if not chunk_id and chunk_index is not None:
            chunk_id = f"ch_{chunk_index}"
        stored = by_id.get(chunk_id)
        if stored is None and chunk_index is not None:
            stored = by_id.get(f"ch_{chunk_index}")
        if stored is None:
            continue
        spans.append({
            "file_id": file_id,
            "chunk_id": stored.chunk_id,
            "chunk_index": stored.chunk_index,
            "span": stored.span,
        })
    # Preserve order, remove duplicates.
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for span in spans:
        key = (str(span.get("file_id") or file_id), str(span.get("chunk_id") or ""))
        if key in seen:
            continue
        seen.add(key)
        out.append(span)
    return out


def _excerpt_from_spans(chunks: list[chunk_store.StoredChunk], spans: list[dict[str, Any]], *, limit: int = 1800) -> str:
    by_id = _chunk_by_id(chunks)
    parts: list[str] = []
    for span in spans[:3]:
        chunk = by_id.get(str(span.get("chunk_id") or ""))
        if chunk is not None:
            parts.append(chunk.text)
    return _excerpt("\n\n".join(parts), [], limit=limit) if parts else ""


def _normalize_discovered_clauses(payload: dict[str, Any], *, chunks: list[chunk_store.StoredChunk], file_id: str) -> list[dict[str, Any]]:
    raw_clauses = payload.get("clauses") or payload.get("discovered_clauses") or payload.get("clause_map") or []
    if isinstance(raw_clauses, dict):
        raw_clauses = list(raw_clauses.values())
    clauses: list[dict[str, Any]] = []
    for idx, raw in enumerate(raw_clauses or []):
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or raw.get("clause_title") or raw.get("name") or raw.get("type") or f"Clause {idx + 1}").strip()
        normalized_type = str(raw.get("normalized_type") or raw.get("type") or raw.get("clause_type") or title).strip()
        clause_family = str(raw.get("clause_family") or raw.get("family") or "").strip() or None
        spans = _normalize_source_spans(raw.get("source_spans") or raw.get("spans") or raw.get("sources") or [], chunks=chunks, file_id=file_id)
        if not spans:
            # A model-produced entry without a chunk anchor is not useful for source-grounded workflows.
            continue
        entry_id = str(raw.get("clause_id") or raw.get("id") or _slug(f"{normalized_type}_{idx + 1}", fallback=f"clause_{idx + 1}"))
        source_excerpt = str(raw.get("source_excerpt") or raw.get("excerpt") or "").strip()
        if not source_excerpt:
            source_excerpt = _excerpt_from_spans(chunks, spans)
        clauses.append({
            "clause_id": entry_id,
            "title": title,
            "normalized_type": normalized_type,
            "clause_family": clause_family,
            "status": str(raw.get("status") or "found"),
            "confidence": str(raw.get("confidence") or "medium"),
            "summary": str(raw.get("summary") or raw.get("description") or "").strip(),
            "key_terms": [str(item).strip() for item in (raw.get("key_terms") or []) if str(item).strip()][:12],
            "obligations": [str(item).strip() for item in (raw.get("obligations") or []) if str(item).strip()][:12],
            "risk_signals": [str(item).strip() for item in (raw.get("risk_signals") or raw.get("risks") or []) if str(item).strip()][:12],
            "cross_references": [str(item).strip() for item in (raw.get("cross_references") or raw.get("references") or []) if str(item).strip()][:12],
            "source_spans": spans,
            "source_excerpt": source_excerpt,
        })
    return clauses


def _chunks_for_llm(chunks: list[chunk_store.StoredChunk]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for chunk in chunks[:MAX_LLM_CHUNKS]:
        text = normalize_contract_text(chunk.text)
        if len(text) > MAX_CHARS_PER_LLM_CHUNK:
            text = text[:MAX_CHARS_PER_LLM_CHUNK].rstrip() + "…"
        out.append({
            "chunk_id": chunk.chunk_id,
            "chunk_index": chunk.chunk_index,
            "span": chunk.span,
            "text": text,
        })
    return out


def _build_nano_clause_map(base: dict[str, Any], *, chunks: list[chunk_store.StoredChunk]) -> dict[str, Any] | None:
    if OpenAIChat is None or not _env_enabled(CLAUSE_MAP_LLM_ENABLED_ENV, True):
        return None
    model_name = os.getenv(CLAUSE_MAP_NANO_MODEL_ENV, DEFAULT_CLAUSE_MAP_NANO_MODEL).strip() or DEFAULT_CLAUSE_MAP_NANO_MODEL
    source = base.get("source_file") if isinstance(base.get("source_file"), dict) else {}
    system = (
        "You create source-grounded contract clause maps. Return JSON only. "
        "Do not use hidden reasoning. Do not invent clauses. Every clause must cite chunk_id/source span(s). "
        "Prefer the contract's own clause titles and discovered structure over a predefined taxonomy."
    )
    user = json.dumps(
        {
            "task": "Create a clause map from these contract chunks.",
            "source_file": {
                "file_id": source.get("file_id"),
                "name": source.get("name"),
                "chunk_count": source.get("chunk_count"),
            },
            "schema": {
                "clauses": [
                    {
                        "clause_id": "stable_snake_case_id",
                        "title": "contract clause title or best short title",
                        "normalized_type": "plain-language type discovered from the clause",
                        "clause_family": "optional broad family if obvious; otherwise null",
                        "status": "found|uncertain",
                        "confidence": "high|medium|low",
                        "summary": "1-2 sentence user-safe summary",
                        "key_terms": ["material terms, thresholds, dates, caps"],
                        "obligations": ["party obligation summaries"],
                        "risk_signals": ["unusual, one-sided, missing, or commercially important signals"],
                        "cross_references": ["Section or Exhibit references mentioned by the clause"],
                        "source_spans": [{"chunk_id": "ch_0", "chunk_index": 0}],
                    }
                ]
            },
            "chunks": _chunks_for_llm(chunks),
        },
        ensure_ascii=False,
    )
    try:
        response = OpenAIChat(model=model_name).generate_with_usage(system=system, user=user)
        payload = _json_from_model_text(response.text)
        if not payload:
            return None
        clauses = _normalize_discovered_clauses(payload, chunks=chunks, file_id=str(source.get("file_id") or ""))
        if not clauses:
            return None
        next_map = dict(base)
        next_map["coverage_method"] = "nano_model_clause_map_v1"
        next_map["coverage_status"] = "nano_clause_map_with_source_spans"
        next_map["discovered_clauses"] = clauses
        next_map["generation"] = {
            "method": "nano_model",
            "model": model_name,
            "operation": response.operation,
            "generated_at": _now_iso(),
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
            "usage_approximate": response.usage.approximate,
            "fallback_inventory_method": "deterministic_full_stored_chunk_clause_scan_v1",
        }
        return next_map
    except Exception:
        log.warning("legal_clause_map_nano_generation_failed", file_id=source.get("file_id"), model=model_name, exc_info=True)
        return None


def build_clause_map(
    *,
    file_id: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
    chunks: list[chunk_store.StoredChunk],
    workflow_id: str,
    artifact_path: str | None = None,
    prefer_llm: bool | None = None,
) -> dict[str, Any]:
    base = _base_clause_map(
        file_id=file_id,
        name=name,
        folder_path=folder_path,
        content_type=content_type,
        chunks=chunks,
        workflow_id=workflow_id,
        artifact_path=artifact_path,
        prefer_llm=prefer_llm,
    )
    if prefer_llm is None:
        prefer_llm = _env_enabled(CLAUSE_MAP_LLM_ENABLED_ENV, True)
    if prefer_llm:
        generated = _build_nano_clause_map(base, chunks=chunks)
        if generated is not None:
            return generated
    return base


def load_or_build_clause_map(
    *,
    uid: str,
    file_id: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
    chunks: list[chunk_store.StoredChunk],
    workflow_id: str,
    store: bool = True,
    prefer_llm: bool | None = None,
) -> dict[str, Any]:
    fingerprint = chunk_fingerprint(chunks)
    if store:
        existing = _load_stored_clause_map(uid, file_id, fingerprint)
        if existing is not None:
            existing.setdefault("workflow_id", workflow_id)
            existing.setdefault("required_clause_families", list(required_clause_families(workflow_id)))
            has_discovered = bool(existing.get("discovered_clauses"))
            wants_llm = _env_enabled(CLAUSE_MAP_LLM_ENABLED_ENV, True) if prefer_llm is None else bool(prefer_llm)
            if not wants_llm or has_discovered:
                return existing
            upgraded = _build_nano_clause_map(existing, chunks=chunks)
            if upgraded is not None:
                stored_path = _persist_clause_map(uid, file_id, upgraded)
                if stored_path:
                    upgraded["artifact_path"] = stored_path
                return upgraded
            return existing
    artifact_path = clause_map_artifact_path(file_id) if store else None
    payload = build_clause_map(
        file_id=file_id,
        name=name,
        folder_path=folder_path,
        content_type=content_type,
        chunks=chunks,
        workflow_id=workflow_id,
        artifact_path=artifact_path,
        prefer_llm=prefer_llm,
    )
    if store:
        stored_path = _persist_clause_map(uid, file_id, payload)
        if stored_path:
            payload["artifact_path"] = stored_path
    return payload


def _compact_clause_map_for_prompt(clause_map: dict[str, Any]) -> dict[str, Any]:
    source = clause_map.get("source_file") if isinstance(clause_map.get("source_file"), dict) else {}
    compact_inventory: list[dict[str, Any]] = []
    for item in clause_map.get("clause_inventory") or []:
        if not isinstance(item, dict):
            continue
        compact_inventory.append(
            {
                "clause_family": item.get("clause_family"),
                "clause_family_label": item.get("clause_family_label"),
                "status": item.get("status"),
                "confidence": item.get("confidence"),
                "summary": item.get("summary"),
                "source_basis": item.get("source_basis"),
                "source_spans": item.get("source_spans") or [],
                "source_excerpt": _excerpt(str(item.get("source_excerpt") or ""), [], limit=320),
            }
        )
    discovered: list[dict[str, Any]] = []
    for item in clause_map.get("discovered_clauses") or []:
        if not isinstance(item, dict):
            continue
        discovered.append({
            "clause_id": item.get("clause_id"),
            "title": item.get("title"),
            "normalized_type": item.get("normalized_type"),
            "clause_family": item.get("clause_family"),
            "status": item.get("status"),
            "confidence": item.get("confidence"),
            "summary": item.get("summary"),
            "key_terms": item.get("key_terms") or [],
            "obligations": item.get("obligations") or [],
            "risk_signals": item.get("risk_signals") or [],
            "cross_references": item.get("cross_references") or [],
            "source_spans": item.get("source_spans") or [],
            "source_excerpt": _excerpt(str(item.get("source_excerpt") or ""), [], limit=420),
        })
    return {
        "version": clause_map.get("version") or CLAUSE_MAP_VERSION,
        "clause_map_id": clause_map.get("clause_map_id"),
        "artifact_path": clause_map.get("artifact_path"),
        "coverage_method": clause_map.get("coverage_method"),
        "coverage_status": clause_map.get("coverage_status"),
        "workflow_id": clause_map.get("workflow_id"),
        "generation": clause_map.get("generation") or {},
        "source_file": source,
        "required_clause_families": clause_map.get("required_clause_families") or [],
        "found_clause_families": clause_map.get("found_clause_families") or [],
        "not_found_clause_families": clause_map.get("not_found_clause_families") or [],
        "uncertain_clause_families": clause_map.get("uncertain_clause_families") or [],
        "discovered_clauses": discovered,
        "clause_inventory": compact_inventory,
    }


def render_clause_map_summary(clause_map: dict[str, Any]) -> str:
    compact = _compact_clause_map_for_prompt(clause_map)
    source = compact.get("source_file") if isinstance(compact.get("source_file"), dict) else {}
    lines = [
        "# Contract Clause Map",
        "",
        "This is a full stored-chunk clause coverage map generated before the workflow artifact. Use it as coverage control: do not say a clause is missing if this map marks that clause family as found.",
        "",
        f"Source: {source.get('name') or 'selected contract'}",
        f"Coverage: {compact.get('coverage_status') or 'unknown'}",
        f"Found clause families: {', '.join(compact.get('found_clause_families') or []) or 'none'}",
        f"Not found after full chunk scan: {', '.join(compact.get('not_found_clause_families') or []) or 'none'}",
        f"Uncertain: {', '.join(compact.get('uncertain_clause_families') or []) or 'none'}",
        "",
        "## Discovered Clauses",
    ]
    for item in compact.get("discovered_clauses") or []:
        if not isinstance(item, dict):
            continue
        title = item.get("title") or item.get("normalized_type") or "Clause"
        status = item.get("status") or "found"
        confidence = item.get("confidence") or "unknown"
        summary = item.get("summary") or "No summary available."
        spans = item.get("source_spans") or []
        span_text = ", ".join(str((span or {}).get("chunk_id") or "") for span in spans if isinstance(span, dict))
        lines.append(f"- {title}: {status} ({confidence}) — {summary} [chunks: {span_text or 'none'}]")
    lines.extend(["", "## Legacy Clause Inventory"] )
    for item in compact.get("clause_inventory") or []:
        if not isinstance(item, dict):
            continue
        label = item.get("clause_family_label") or item.get("clause_family") or "Clause"
        status = item.get("status") or "unknown"
        confidence = item.get("confidence") or "unknown"
        summary = item.get("summary") or item.get("source_basis") or "No summary available."
        lines.append(f"- {label}: {status} ({confidence}) — {summary}")
    encoded = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))
    return "\n".join(lines).strip() + f"\n\n{CLAUSE_MAP_JSON_START}\n{encoded}\n{CLAUSE_MAP_JSON_END}"


def parse_clause_map_from_text(text: str) -> dict[str, Any] | None:
    match = re.search(rf"{re.escape(CLAUSE_MAP_JSON_START)}\s*(.*?)\s*{re.escape(CLAUSE_MAP_JSON_END)}", text or "", re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None



def clause_map_entries_for_agent(clause_map: dict[str, Any]) -> list[dict[str, Any]]:
    source = clause_map.get("source_file") if isinstance(clause_map.get("source_file"), dict) else {}
    file_id = str(source.get("file_id") or "")
    source_name = str(source.get("name") or "")
    entries: list[dict[str, Any]] = []

    for raw in clause_map.get("discovered_clauses") or []:
        if not isinstance(raw, dict):
            continue
        spans = []
        for span in raw.get("source_spans") or []:
            if isinstance(span, dict):
                spans.append({**span, "file_id": span.get("file_id") or file_id})
        entries.append({
            "clause_map_id": clause_map.get("clause_map_id"),
            "source_file_id": file_id,
            "source_name": source_name,
            "entry_kind": "discovered_clause",
            "entry_id": raw.get("clause_id"),
            "title": raw.get("title") or raw.get("normalized_type"),
            "normalized_type": raw.get("normalized_type"),
            "clause_family": raw.get("clause_family"),
            "status": raw.get("status") or "found",
            "confidence": raw.get("confidence"),
            "summary": raw.get("summary"),
            "key_terms": raw.get("key_terms") or [],
            "obligations": raw.get("obligations") or [],
            "risk_signals": raw.get("risk_signals") or [],
            "cross_references": raw.get("cross_references") or [],
            "source_spans": spans,
            "source_excerpt": raw.get("source_excerpt") or "",
        })

    if entries:
        return entries

    # Fallback for old deterministic artifacts: expose the legacy inventory as
    # clause-map entries, preserving exact chunk spans for retrieval.
    for raw in clause_map.get("clause_inventory") or []:
        if not isinstance(raw, dict):
            continue
        spans = []
        for span in raw.get("source_spans") or []:
            if isinstance(span, dict):
                spans.append({**span, "file_id": span.get("file_id") or file_id})
        entries.append({
            "clause_map_id": clause_map.get("clause_map_id"),
            "source_file_id": file_id,
            "source_name": source_name,
            "entry_kind": "legacy_clause_family",
            "entry_id": raw.get("clause_family"),
            "title": raw.get("clause_family_label") or raw.get("clause_family"),
            "normalized_type": raw.get("clause_family_label") or raw.get("clause_family"),
            "clause_family": raw.get("clause_family"),
            "status": raw.get("status"),
            "confidence": raw.get("confidence"),
            "summary": raw.get("summary"),
            "key_terms": raw.get("top_hits") or [],
            "obligations": [],
            "risk_signals": [],
            "cross_references": [],
            "source_spans": spans,
            "source_excerpt": raw.get("source_excerpt") or "",
        })
    return entries


def compact_clause_map_for_eval(clause_map: dict[str, Any]) -> dict[str, Any]:
    compact = _compact_clause_map_for_prompt(clause_map)
    compact["generation"] = clause_map.get("generation") or {}
    compact["discovered_clauses"] = [
        {
            "clause_id": entry.get("clause_id"),
            "title": entry.get("title"),
            "normalized_type": entry.get("normalized_type"),
            "clause_family": entry.get("clause_family"),
            "status": entry.get("status"),
            "confidence": entry.get("confidence"),
            "summary": entry.get("summary"),
            "key_terms": entry.get("key_terms") or [],
            "obligations": entry.get("obligations") or [],
            "risk_signals": entry.get("risk_signals") or [],
            "cross_references": entry.get("cross_references") or [],
            "source_spans": entry.get("source_spans") or [],
            "source_excerpt": _excerpt(str(entry.get("source_excerpt") or ""), [], limit=420),
        }
        for entry in clause_map.get("discovered_clauses") or []
        if isinstance(entry, dict)
    ]
    return compact


def _selection_catalog(clause_maps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for clause_map in clause_maps:
        for entry in clause_map_entries_for_agent(clause_map):
            catalog.append({
                "entry_id": entry.get("entry_id"),
                "entry_kind": entry.get("entry_kind"),
                "clause_map_id": entry.get("clause_map_id"),
                "source_file_id": entry.get("source_file_id"),
                "source_name": entry.get("source_name"),
                "title": entry.get("title"),
                "normalized_type": entry.get("normalized_type"),
                "clause_family": entry.get("clause_family"),
                "status": entry.get("status"),
                "confidence": entry.get("confidence"),
                "summary": entry.get("summary"),
                "key_terms": entry.get("key_terms") or [],
                "obligations": entry.get("obligations") or [],
                "risk_signals": entry.get("risk_signals") or [],
                "cross_references": entry.get("cross_references") or [],
                "source_spans": entry.get("source_spans") or [],
            })
    return catalog


def _fallback_select_clause_entries(catalog: list[dict[str, Any]], *, workflow_id: str, limit: int) -> list[dict[str, Any]]:
    # This is intentionally a fallback: prefer model-discovered clauses and
    # source-anchored entries. Predefined families are used only when the model
    # selection path is unavailable.
    wanted = set(required_clause_families(workflow_id))
    ranked: list[tuple[int, int, dict[str, Any]]] = []
    for idx, entry in enumerate(catalog):
        score = 0
        if entry.get("source_spans"):
            score += 5
        if entry.get("entry_kind") == "discovered_clause":
            score += 3
        if str(entry.get("status") or "").lower() == "found":
            score += 2
        if entry.get("clause_family") in wanted:
            score += 1
        if entry.get("risk_signals") or entry.get("obligations"):
            score += 1
        ranked.append((score, -idx, entry))
    ranked.sort(reverse=True, key=lambda item: (item[0], item[1]))
    return [item[2] for item in ranked[:limit]]


def select_clause_map_entries_for_workflow(
    *,
    clause_maps: list[dict[str, Any]],
    workflow_id: str,
    focus: str = "",
    max_entries: int = 12,
) -> dict[str, Any]:
    catalog = _selection_catalog(clause_maps)
    if not catalog:
        return {"method": "none", "selected_entries": [], "reason": "No clause-map entries were available."}

    model_name = os.getenv("LEGAL_CLAUSE_MAP_SELECTION_MODEL", os.getenv(CLAUSE_MAP_NANO_MODEL_ENV, DEFAULT_CLAUSE_MAP_NANO_MODEL)).strip() or DEFAULT_CLAUSE_MAP_NANO_MODEL
    selected_ids: list[str] = []
    reason = ""
    method = "fallback"
    if OpenAIChat is not None and _env_enabled(CLAUSE_MAP_LLM_ENABLED_ENV, True):
        system = (
            "Select source-grounded clause-map entries for a legal workflow. Return JSON only. "
            "Do not use hidden reasoning. Select by entry_id. Prefer entries with source_spans. "
            "Do not select more entries than requested."
        )
        user = json.dumps(
            {
                "workflow_id": workflow_id,
                "focus": focus,
                "max_entries": max_entries,
                "selection_goal": "Choose the clause-map entries needed to build the workflow output; RAG will fetch exact chunks and neighbors from these spans.",
                "schema": {"selected_entry_ids": ["entry_id"], "reason": "short user-safe rationale"},
                "entries": catalog,
            },
            ensure_ascii=False,
        )
        try:
            response = OpenAIChat(model=model_name).generate_with_usage(system=system, user=user)
            payload = _json_from_model_text(response.text) or {}
            selected_ids = [str(item).strip() for item in (payload.get("selected_entry_ids") or payload.get("entry_ids") or []) if str(item).strip()]
            reason = str(payload.get("reason") or payload.get("rationale") or "").strip()
            if selected_ids:
                method = "nano_model"
        except Exception:
            log.warning("legal_clause_map_selection_failed", workflow_id=workflow_id, model=model_name, exc_info=True)

    by_id = {str(entry.get("entry_id")): entry for entry in catalog if str(entry.get("entry_id") or "").strip()}
    selected = [by_id[item] for item in selected_ids if item in by_id][:max_entries]
    if not selected:
        selected = _fallback_select_clause_entries(catalog, workflow_id=workflow_id, limit=max_entries)
        method = "fallback"
        reason = reason or "Model selection was unavailable or returned no usable source-anchored entries; used deterministic fallback over the clause map."

    return {
        "method": method,
        "model": model_name if method == "nano_model" else None,
        "reason": reason,
        "selected_entries": selected,
        "selected_entry_count": len(selected),
        "available_entry_count": len(catalog),
    }

def build_clause_map_source(
    *,
    uid: str,
    file_id: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
    chunks: list[chunk_store.StoredChunk],
    workflow_id: str,
    store: bool = True,
    prefer_llm: bool | None = None,
) -> WorkflowSourceFile:
    clause_map = load_or_build_clause_map(
        uid=uid,
        file_id=file_id,
        name=name,
        folder_path=folder_path,
        content_type=content_type,
        chunks=chunks,
        workflow_id=workflow_id,
        store=store,
        prefer_llm=prefer_llm,
    )
    rendered = render_clause_map_summary(clause_map)
    source = clause_map.get("source_file") if isinstance(clause_map.get("source_file"), dict) else {}
    return WorkflowSourceFile(
        file_id=file_id,
        name=f"{name} — contract clause map",
        folder_path=folder_path,
        content_type="application/json+contract-clause-map",
        excerpt=rendered,
        full_text_chars=int(source.get("full_text_chars") or sum(len(chunk.text) for chunk in chunks)),
        excerpt_chars=len(rendered),
        truncated=False,
        source_kind="contract_clause_map",
        chunk_ids=[],
        chunk_count=len(chunks),
    )
