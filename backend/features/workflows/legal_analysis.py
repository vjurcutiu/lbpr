from __future__ import annotations

import json
import re
from typing import Any

from .legal_clause_map import (
    CLAUSE_MAP_JSON_END,
    CLAUSE_MAP_JSON_START,
    LEGAL_CLAUSE_FAMILY_LABELS,
    LEGAL_CLAUSE_FAMILY_KEYWORDS,
    WORKFLOW_REQUIRED_CLAUSE_FAMILIES,
    build_clause_map_source,
    normalize_contract_text,
    parse_clause_map_from_text,
    required_clause_families,
)
from .models import WorkflowSourceFile

# Backward-compatible legacy markers. Older runs may still contain contract fact
# map support records, so readers accept both. New runs should use the contract
# clause map generated from stored chunks.
_FACT_MAP_START = "CONTRACT_FACT_MAP_JSON_START"
_FACT_MAP_END = "CONTRACT_FACT_MAP_JSON_END"


def _parse_legacy_fact_map_from_text(text: str) -> dict[str, Any] | None:
    match = re.search(rf"{re.escape(_FACT_MAP_START)}\s*(.*?)\s*{re.escape(_FACT_MAP_END)}", text or "", re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    payload.setdefault("coverage_status", "full_text_scanned")
    payload.setdefault("coverage_method", "legacy_full_text_keyword_scan")
    return payload


def parse_fact_map_from_text(text: str) -> dict[str, Any] | None:
    return parse_clause_map_from_text(text) or _parse_legacy_fact_map_from_text(text)


def fact_maps_from_sources(sources: list[WorkflowSourceFile]) -> list[dict[str, Any]]:
    maps: list[dict[str, Any]] = []
    for source in sources:
        if source.source_kind not in {"contract_clause_map", "contract_fact_map"}:
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


def _coverage_source_summary(fact_map: dict[str, Any]) -> dict[str, Any]:
    source = fact_map.get("source_file") if isinstance(fact_map.get("source_file"), dict) else {}
    found = sorted(str(item) for item in fact_map.get("found_clause_families") or [] if str(item).strip())
    not_found = sorted(str(item) for item in fact_map.get("not_found_clause_families") or [] if str(item).strip())
    uncertain = sorted(str(item) for item in fact_map.get("uncertain_clause_families") or [] if str(item).strip())
    if not found and not not_found and not uncertain:
        for item in fact_map.get("clause_inventory") or []:
            if not isinstance(item, dict):
                continue
            family = str(item.get("clause_family") or "").strip()
            status = str(item.get("status") or "").strip()
            if not family:
                continue
            if status == "found":
                found.append(family)
            elif status == "uncertain":
                uncertain.append(family)
            elif status.startswith("not_found"):
                not_found.append(family)
    return {
        "clause_map_id": fact_map.get("clause_map_id"),
        "artifact_path": fact_map.get("artifact_path"),
        "coverage_status": fact_map.get("coverage_status"),
        "coverage_method": fact_map.get("coverage_method"),
        "file_id": source.get("file_id"),
        "name": source.get("name"),
        "chunk_count": source.get("chunk_count"),
        "full_text_chars": source.get("full_text_chars"),
        "found_clause_families": sorted(set(found)),
        "not_found_clause_families": sorted(set(not_found)),
        "uncertain_clause_families": sorted(set(uncertain)),
    }


def build_legal_coverage_metadata(sources: list[WorkflowSourceFile]) -> dict[str, Any]:
    fact_maps = fact_maps_from_sources(sources)
    if not fact_maps:
        return {
            "coverage_status": "excerpt_only",
            "clause_map_ids": [],
            "clause_maps": [],
            "found_clause_families": [],
            "not_found_clause_families": [],
            "uncertain_clause_families": [],
        }

    found: set[str] = set()
    not_found: set[str] = set()
    uncertain: set[str] = set()
    summaries: list[dict[str, Any]] = []
    coverage_statuses: set[str] = set()
    for fact_map in fact_maps:
        summaries.append(_coverage_source_summary(fact_map))
        coverage_statuses.add(str(fact_map.get("coverage_status") or "unknown"))
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
                uncertain.discard(family)
            elif status == "uncertain" and family not in found:
                uncertain.add(family)
                not_found.discard(family)
            elif status.startswith("not_found") and family not in found and family not in uncertain:
                not_found.add(family)

    if "full_chunk_scan" in coverage_statuses:
        status = "full_chunk_scan"
    elif "full_text_scanned" in coverage_statuses:
        status = "full_contract_fact_map"
    else:
        status = sorted(coverage_statuses)[0] if coverage_statuses else "unknown"

    return {
        "coverage_status": status,
        "clause_map_ids": [item.get("clause_map_id") for item in summaries if item.get("clause_map_id")],
        "clause_maps": summaries,
        "found_clause_families": sorted(found),
        "not_found_clause_families": sorted(not_found),
        "uncertain_clause_families": sorted(uncertain),
    }


def supplement_metadata_from_fact_maps(metadata: dict[str, Any], sources: list[WorkflowSourceFile]) -> dict[str, Any]:
    out = dict(metadata or {})
    coverage = build_legal_coverage_metadata(sources)
    out["legal_coverage"] = coverage
    fact_maps = fact_maps_from_sources(sources)
    if not fact_maps:
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
                "current_position": item.get("summary") or "Clause found in full stored-chunk clause map.",
                "source_basis": item.get("source_basis") or item.get("summary") or "Found by full stored-chunk clause scan.",
                "concern": "Review this located clause in context before final approval.",
                "recommended_position": "Assess against the selected risk tolerance and house position.",
                "coverage_status": "found_in_full_chunk_clause_map",
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
    text = " ".join([markdown or "", json.dumps(metadata or {}, ensure_ascii=False)]).lower()
    issues: list[dict[str, Any]] = []
    missing_patterns = (
        "missing {label}",
        "no {label}",
        "{label} is not shown",
        "{label} terms are not shown",
        "{label} language is not shown",
        "{label} not visible",
        "{label} was not found",
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
                    "message": f"Output may describe {LEGAL_CLAUSE_FAMILY_LABELS.get(family, family)} as missing even though the full stored-chunk clause map found it.",
                    "source_basis": item.get("source_basis") or item.get("summary") or "Found in full stored-chunk clause map.",
                }
            )
    return issues


# Backward-compatible name used by older toolkit imports. New code should call
# legal_clause_map.build_clause_map_source directly.
def build_fact_map_source(*args, **kwargs):
    return build_clause_map_source(*args, **kwargs)
