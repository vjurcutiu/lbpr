from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from core.tokenizer import count_tokens
from .models import WorkflowSourceFile

# Keep this module independent from registry.py so source building can use it
# without importing the workflow handler registry.
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
    "exclusivity": "Exclusivity",
    "warranties": "Warranties / Service Levels",
    "dispute_resolution": "Dispute Resolution",
    "change_control": "Change Control",
    "notices": "Notices",
}

LEGAL_CLAUSE_FAMILY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "confidentiality": ("confidential", "non-disclosure", "non disclosure", "proprietary information", "trade secret"),
    "indemnity": ("indemn", "defend", "hold harmless", "third-party claim", "third party claim"),
    "limitation_of_liability": ("limitation of liability", "liability", "consequential", "damages", "cap", "excluded damages"),
    "termination": ("terminate", "termination", "expiration", "survive", "survival", "wind-down", "wind down"),
    "renewal": ("renew", "renewal", "auto-renew", "non-renew", "anniversary"),
    "ip_ownership": ("intellectual property", "work product", "ownership", "license", "source code", "deliverable"),
    "data_protection": ("data", "security", "privacy", "breach", "incident", "encryption", "personal information", "personal data", "protected health"),
    "governing_law": ("governing law", "jurisdiction", "venue", "courts", "laws of"),
    "payment": ("payment", "fees", "invoice", "invoicing", "tax", "charges", "payable"),
    "assignment": ("assign", "assignment", "change of control", "successor", "affiliate"),
    "audit": ("audit", "inspect", "assessment", "certification", "soc", "penetration test", "questionnaire"),
    "insurance": ("insurance", "insured", "coverage", "policy", "certificate"),
    "non_solicit": ("non-solicit", "non solicit", "solicit", "employee", "recruit"),
    "exclusivity": ("exclusive", "exclusivity", "standstill", "compete", "restriction"),
    "warranties": ("warrant", "service level", "sla", "uptime", "availability", "remedy", "mttr"),
    "dispute_resolution": ("dispute", "arbitration", "mediation", "injunctive", "equitable relief", "jury"),
    "change_control": ("change order", "change request", "approval", "approve", "review", "comment"),
    "notices": ("notice", "notify", "written notice", "facsimile", "mail"),
}

WORKFLOW_REQUIRED_CLAUSE_FAMILIES: dict[str, tuple[str, ...]] = {
    "legal_nda_review": (
        "confidentiality",
        "termination",
        "assignment",
        "governing_law",
        "dispute_resolution",
        "non_solicit",
        "exclusivity",
    ),
    "legal_msa_review": (
        "payment",
        "termination",
        "renewal",
        "warranties",
        "limitation_of_liability",
        "indemnity",
        "ip_ownership",
        "data_protection",
        "audit",
        "insurance",
        "assignment",
        "change_control",
        "notices",
        "governing_law",
        "dispute_resolution",
    ),
    "legal_contract_review": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_contract_risk_matrix": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_clause_extraction": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_fallback_language": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_negotiation_brief": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_obligation_tracker": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
    "legal_matter_handoff": tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()),
}

_FACT_MAP_START = "CONTRACT_FACT_MAP_JSON_START"
_FACT_MAP_END = "CONTRACT_FACT_MAP_JSON_END"

_HEADING_RE = re.compile(
    r"(?m)^(?:\s*(?:section|article|clause|schedule|exhibit|appendix)\s+[\w.()\-]+\s*[:\-–]?\s+.+|\s*\d+(?:\.\d+)*\s+.+|\s*[A-Z][A-Z0-9 /&(),.\-]{6,})$"
)


def normalize_contract_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def required_clause_families(workflow_id: str) -> tuple[str, ...]:
    return WORKFLOW_REQUIRED_CLAUSE_FAMILIES.get(workflow_id, tuple(LEGAL_CLAUSE_FAMILY_LABELS.keys()))


def _sentence_window(text: str, index: int, *, radius: int = 900) -> str:
    start = max(0, index - radius)
    end = min(len(text), index + radius)
    # Prefer sentence-ish boundaries but do not spend too much time trying to parse SEC text.
    left = text.rfind(".", 0, index)
    if left >= 0 and left > start:
        start = left + 1
    right = text.find(".", index, end)
    if right >= 0:
        end = right + 1
    snippet = re.sub(r"\s+", " ", text[start:end]).strip()
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet += "…"
    return snippet


def _nearest_heading(text: str, index: int) -> str | None:
    window_start = max(0, index - 3500)
    before = text[window_start:index]
    matches = list(_HEADING_RE.finditer(before))
    if not matches:
        return None
    heading = matches[-1].group(0).strip()
    heading = re.sub(r"\s+", " ", heading)
    return heading[:160]


def _find_keyword_hits(text: str, keywords: tuple[str, ...], *, limit: int = 4) -> list[dict[str, Any]]:
    lowered = text.lower()
    hits: list[dict[str, Any]] = []
    seen_spans: set[tuple[int, int]] = set()
    for keyword in keywords:
        pattern = re.escape(keyword.lower())
        for match in re.finditer(pattern, lowered):
            idx = match.start()
            span_key = (max(0, idx - 200), min(len(text), idx + 200))
            if span_key in seen_spans:
                continue
            seen_spans.add(span_key)
            hits.append(
                {
                    "keyword": keyword,
                    "char_start": idx,
                    "char_end": match.end(),
                    "section_title": _nearest_heading(text, idx),
                    "source_excerpt": _sentence_window(text, idx),
                }
            )
            if len(hits) >= limit:
                return sorted(hits, key=lambda item: int(item.get("char_start") or 0))
    return sorted(hits, key=lambda item: int(item.get("char_start") or 0))


def _summarize_position_from_hit(hit: dict[str, Any], label: str) -> str:
    excerpt = str(hit.get("source_excerpt") or "")
    compact = re.sub(r"\s+", " ", excerpt).strip(" …")
    if not compact:
        return f"{label} language was located in the full-contract scan."
    return compact[:420].rstrip(" ,;:-")


def build_contract_fact_map(
    *,
    file_id: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
    full_text: str,
    workflow_id: str,
) -> dict[str, Any]:
    normalized = normalize_contract_text(full_text)
    token_count = count_tokens(normalized) if normalized else 0
    required = required_clause_families(workflow_id)
    inventory: list[dict[str, Any]] = []
    for family in required:
        label = LEGAL_CLAUSE_FAMILY_LABELS.get(family, family.replace("_", " ").title())
        hits = _find_keyword_hits(normalized, LEGAL_CLAUSE_FAMILY_KEYWORDS.get(family, ()))
        if hits:
            first = hits[0]
            inventory.append(
                {
                    "clause_family": family,
                    "clause_family_label": label,
                    "status": "found",
                    "section_title": first.get("section_title"),
                    "summary": _summarize_position_from_hit(first, label),
                    "source_basis": first.get("source_excerpt"),
                    "source_excerpt": first.get("source_excerpt"),
                    "hits": hits,
                    "confidence": "medium",
                }
            )
        else:
            inventory.append(
                {
                    "clause_family": family,
                    "clause_family_label": label,
                    "status": "not_found_after_full_text_scan",
                    "section_title": None,
                    "summary": f"No {label} clause was found by the full-text clause scan.",
                    "source_basis": "Full-text keyword scan did not find matching clause language.",
                    "source_excerpt": "",
                    "hits": [],
                    "confidence": "medium",
                }
            )
    return {
        "version": 1,
        "source_file": {
            "file_id": file_id,
            "name": name,
            "folder_path": folder_path,
            "content_type": content_type,
            "full_text_chars": len(normalized),
            "estimated_tokens": token_count,
        },
        "workflow_id": workflow_id,
        "coverage_method": "deterministic_full_text_clause_scan",
        "coverage_status": "full_text_scanned",
        "required_clause_families": list(required),
        "clause_inventory": inventory,
    }


def render_contract_fact_map(fact_map: dict[str, Any]) -> str:
    source = fact_map.get("source_file") if isinstance(fact_map.get("source_file"), dict) else {}
    lines = [
        "# Contract Fact Map",
        "",
        "This is a full-contract clause inventory generated before the workflow artifact. Use it as coverage control: do not say a clause is missing if this inventory marks it as found.",
        "",
        f"Source: {source.get('name') or 'selected contract'}",
        f"Coverage: {fact_map.get('coverage_status') or 'unknown'}",
        "",
        "## Clause Inventory",
    ]
    for item in fact_map.get("clause_inventory") or []:
        if not isinstance(item, dict):
            continue
        label = item.get("clause_family_label") or item.get("clause_family") or "Clause"
        status = item.get("status") or "unknown"
        summary = item.get("summary") or item.get("source_basis") or "No summary available."
        lines.append(f"- {label}: {status} — {summary}")
    encoded = json.dumps(fact_map, ensure_ascii=False, separators=(",", ":"))
    return "\n".join(lines).strip() + f"\n\n{_FACT_MAP_START}\n{encoded}\n{_FACT_MAP_END}"


def parse_fact_map_from_text(text: str) -> dict[str, Any] | None:
    match = re.search(rf"{re.escape(_FACT_MAP_START)}\s*(.*?)\s*{re.escape(_FACT_MAP_END)}", text or "", re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def fact_maps_from_sources(sources: list[WorkflowSourceFile]) -> list[dict[str, Any]]:
    maps: list[dict[str, Any]] = []
    for source in sources:
        if source.source_kind != "contract_fact_map":
            continue
        payload = parse_fact_map_from_text(source.excerpt)
        if payload is not None:
            maps.append(payload)
    return maps


def _found_inventory_by_family(fact_maps: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for fact_map in fact_maps:
        for item in fact_map.get("clause_inventory") or []:
            if not isinstance(item, dict):
                continue
            family = str(item.get("clause_family") or "").strip()
            status = str(item.get("status") or "").strip()
            if family and status == "found":
                found.setdefault(family, item)
    return found


def build_legal_coverage_metadata(sources: list[WorkflowSourceFile]) -> dict[str, Any]:
    fact_maps = fact_maps_from_sources(sources)
    if not fact_maps:
        return {
            "coverage_status": "excerpt_only",
            "contract_fact_maps": [],
            "found_clause_families": [],
            "not_found_clause_families": [],
        }
    found: set[str] = set()
    not_found: set[str] = set()
    for fact_map in fact_maps:
        for item in fact_map.get("clause_inventory") or []:
            if not isinstance(item, dict):
                continue
            family = str(item.get("clause_family") or "").strip()
            status = str(item.get("status") or "").strip()
            if not family:
                continue
            if status == "found":
                found.add(family)
                not_found.discard(family)
            elif family not in found:
                not_found.add(family)
    return {
        "coverage_status": "full_contract_fact_map",
        "contract_fact_maps": fact_maps,
        "found_clause_families": sorted(found),
        "not_found_clause_families": sorted(not_found),
    }


def supplement_metadata_from_fact_maps(metadata: dict[str, Any], sources: list[WorkflowSourceFile]) -> dict[str, Any]:
    out = dict(metadata or {})
    coverage = build_legal_coverage_metadata(sources)
    out["legal_coverage"] = coverage
    fact_maps = coverage.get("contract_fact_maps") or []
    if not isinstance(fact_maps, list) or not fact_maps:
        return out

    found = _found_inventory_by_family(fact_maps)
    existing_clause_families = {
        str(item.get("clause_family") or "").strip()
        for item in out.get("clause_items") or []
        if isinstance(item, dict)
    }
    clause_items = list(out.get("clause_items") or []) if isinstance(out.get("clause_items"), list) else []
    for family, item in found.items():
        if family in existing_clause_families:
            continue
        clause_items.append(
            {
                "clause_family": family,
                "current_position": item.get("summary") or "Clause found in full-contract fact map.",
                "source_basis": item.get("source_basis") or item.get("summary") or "Found by full-contract clause scan.",
                "concern": "Review this located clause in context before final approval.",
                "recommended_position": "Assess against the selected risk tolerance and house position.",
                "coverage_status": "found_in_full_contract_fact_map",
            }
        )
    out["clause_items"] = clause_items
    return out


def verify_output_against_fact_maps(metadata: dict[str, Any], markdown: str, sources: list[WorkflowSourceFile]) -> list[dict[str, Any]]:
    fact_maps = fact_maps_from_sources(sources)
    if not fact_maps:
        return []
    found = _found_inventory_by_family(fact_maps)
    if not found:
        return []
    text = " ".join(
        [markdown or "", json.dumps(metadata or {}, ensure_ascii=False)]
    ).lower()
    issues: list[dict[str, Any]] = []
    missing_patterns = (
        "missing {label}",
        "no {label}",
        "{label} is not shown",
        "{label} terms are not shown",
        "{label} language is not shown",
        "{label} not visible",
        "not visible in the excerpt",
    )
    for family, item in found.items():
        label = LEGAL_CLAUSE_FAMILY_LABELS.get(family, family.replace("_", " ")).lower()
        family_words = family.replace("_", " ").lower()
        family_present = label in text or family_words in text
        if not family_present:
            continue
        local_issue = False
        for pattern in missing_patterns:
            if pattern.format(label=label) in text or pattern.format(label=family_words) in text:
                local_issue = True
                break
        if local_issue:
            issues.append(
                {
                    "type": "possible_false_missing_clause",
                    "clause_family": family,
                    "message": f"Output may describe {LEGAL_CLAUSE_FAMILY_LABELS.get(family, family)} as missing even though the full-contract fact map found it.",
                    "source_basis": item.get("source_basis") or item.get("summary") or "Found in full-contract fact map.",
                }
            )
    return issues


def build_fact_map_source(
    *,
    file_id: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
    full_text: str,
    workflow_id: str,
) -> WorkflowSourceFile:
    fact_map = build_contract_fact_map(
        file_id=file_id,
        name=name,
        folder_path=folder_path,
        content_type=content_type,
        full_text=full_text,
        workflow_id=workflow_id,
    )
    rendered = render_contract_fact_map(fact_map)
    return WorkflowSourceFile(
        file_id=file_id,
        name=f"{name} — contract fact map",
        folder_path=folder_path,
        content_type="application/json+contract-fact-map",
        excerpt=rendered,
        full_text_chars=int((fact_map.get("source_file") or {}).get("full_text_chars") or len(full_text or "")),
        excerpt_chars=len(rendered),
        truncated=False,
        source_kind="contract_fact_map",
        chunk_ids=[],
        chunk_count=0,
    )
