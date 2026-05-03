from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Iterable

from features.files import service as files_service
from features.rag import chunk_store
from .models import WorkflowSourceFile

log = logging.getLogger("workflows.legal_clause_map")

CLAUSE_MAP_VERSION = 1
CLAUSE_MAP_ARTIFACT_NAME = "contract_clause_map.v1.json"
CLAUSE_MAP_JSON_START = "CONTRACT_CLAUSE_MAP_JSON_START"
CLAUSE_MAP_JSON_END = "CONTRACT_CLAUSE_MAP_JSON_END"

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


def build_clause_map(
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
    }


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
) -> dict[str, Any]:
    fingerprint = chunk_fingerprint(chunks)
    if store:
        existing = _load_stored_clause_map(uid, file_id, fingerprint)
        if existing is not None:
            existing.setdefault("workflow_id", workflow_id)
            existing.setdefault("required_clause_families", list(required_clause_families(workflow_id)))
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
    return {
        "version": clause_map.get("version") or CLAUSE_MAP_VERSION,
        "clause_map_id": clause_map.get("clause_map_id"),
        "artifact_path": clause_map.get("artifact_path"),
        "coverage_method": clause_map.get("coverage_method"),
        "coverage_status": clause_map.get("coverage_status"),
        "workflow_id": clause_map.get("workflow_id"),
        "source_file": source,
        "required_clause_families": clause_map.get("required_clause_families") or [],
        "found_clause_families": clause_map.get("found_clause_families") or [],
        "not_found_clause_families": clause_map.get("not_found_clause_families") or [],
        "uncertain_clause_families": clause_map.get("uncertain_clause_families") or [],
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
        "## Clause Inventory",
    ]
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
