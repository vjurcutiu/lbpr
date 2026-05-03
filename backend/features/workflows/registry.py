from __future__ import annotations

import json
import logging
import re
import textwrap
from collections import Counter
from typing import Any, Callable

from .domain_packs import (
    DOMAIN_WORKFLOW_SPECS,
    LEGAL_CLAUSE_FAMILIES,
    LEGAL_HOUSE_POSITION_SUMMARY,
    LEGAL_RISK_LEVELS,
    get_domain_workflow_spec,
)
from .models import WorkflowManifest, WorkflowResult, WorkflowRun, WorkflowSourceFile
from .legal_analysis import (
    build_legal_coverage_metadata,
    supplement_metadata_from_fact_maps,
    verify_output_against_fact_maps,
)

try:
    from features.rag.adapters.openai_chat import OpenAIChat  # type: ignore
except Exception:
    OpenAIChat = None  # type: ignore

log = logging.getLogger("workflows.registry")

WorkflowHandler = Callable[[WorkflowRun, list[WorkflowSourceFile]], WorkflowResult]

_SUMMARY_LAYER_LABELS = {
    "snapshot": "Quick read",
    "standard": "Key takeaways",
    "deep_dive": "Details",
}


_STOPWORDS = {
    "about", "after", "again", "against", "also", "between", "could", "first", "from", "have", "into",
    "just", "more", "most", "other", "over", "same", "should", "that", "their", "there", "these", "this",
    "those", "through", "using", "very", "what", "when", "where", "which", "with", "would", "your", "than",
}


def _selection_phrase(run: WorkflowRun) -> str:
    files = len(run.selection.file_ids)
    folders = len(run.selection.folder_paths)
    parts: list[str] = []
    if files:
        parts.append(f"{files} file{'s' if files != 1 else ''}")
    if folders:
        parts.append(f"{folders} folder{'s' if folders != 1 else ''}")
    if not parts:
        parts.append("the current workspace context")
    current_folder = run.selection.current_folder.strip() or "Root"
    return f"{', '.join(parts)} from {current_folder}"


def _focus_text(run: WorkflowRun, fallback: str) -> str:
    focus = str(run.inputs.get("focus") or "").strip()
    return focus or fallback


def _source_label(source: WorkflowSourceFile) -> str:
    return source.name or source.file_id


def _display_source_label(source: WorkflowSourceFile) -> str:
    label = _source_label(source).strip()
    return label.replace(" — retrieved evidence", "").strip() or source.file_id


def _source_manifest_lines(sources: list[WorkflowSourceFile]) -> list[str]:
    lines: list[str] = []
    for source in sources:
        suffix = f" ({source.folder_path})" if source.folder_path else ""
        trunc = " — excerpt truncated" if source.truncated else ""
        lines.append(f"- {_display_source_label(source)}{suffix}{trunc}")
    return lines




def _source_file_identity(source: WorkflowSourceFile) -> str:
    return str(source.file_id or _display_source_label(source)).strip()


def _unique_customer_source_files(sources: list[WorkflowSourceFile]) -> list[WorkflowSourceFile]:
    by_key: dict[str, WorkflowSourceFile] = {}
    order: list[str] = []
    for source in sources:
        key = _source_file_identity(source)
        if not key:
            continue
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = source
            order.append(key)
            continue
        # Targeted retrieval can add one or more records for the same selected
        # file. Prefer the coverage/original record so the user sees the file
        # once, not every retrieved chunk.
        if existing.source_kind in {"contract_fact_map", "contract_clause_map"} and source.source_kind not in {"contract_fact_map", "contract_clause_map"}:
            by_key[key] = source
            continue
        if source.source_kind in {"contract_fact_map", "contract_clause_map"}:
            continue
        if existing.source_kind == "retrieved" and source.source_kind != "retrieved":
            by_key[key] = source
    return [by_key[key] for key in order if key in by_key]


def _unique_source_file_ids(sources: list[WorkflowSourceFile]) -> set[str]:
    return {str(source.file_id).strip() for source in sources if str(source.file_id).strip()}


def _source_file_count(sources: list[WorkflowSourceFile]) -> int:
    unique_ids = _unique_source_file_ids(sources)
    return len(unique_ids) if unique_ids else len(sources)


def _is_single_source_output(sources: list[WorkflowSourceFile]) -> bool:
    return _source_file_count(sources) == 1


def _customer_visible_sources(sources: list[WorkflowSourceFile]) -> list[WorkflowSourceFile]:
    # Targeted retrieval can add multiple source records for the same selected
    # file. Keep full metadata for inspection/export, but render only one
    # customer-facing source entry per underlying file.
    return _unique_customer_source_files(sources)


def _single_source_labels(sources: list[WorkflowSourceFile]) -> list[str]:
    labels: set[str] = set()
    for source in sources:
        label = _source_label(source).strip()
        if not label:
            continue
        labels.add(label)
        labels.add(label.replace(" — retrieved evidence", "").strip())
        if source.folder_path:
            labels.add(f"{label} · {source.folder_path}".strip())
            labels.add(f"{label} ({source.folder_path})".strip())
    return sorted((label for label in labels if label), key=len, reverse=True)


def _strip_markdown_source_sections(text: str) -> str:
    cleaned = str(text or "")
    for heading in ("Sources used", "Source used", "Sources", "Source material"):
        pattern = rf"(?ims)^\s*#+\s+{re.escape(heading)}\s*$.*?(?=^\s*#+\s+|\Z)"
        cleaned = re.sub(pattern, "", cleaned)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def _strip_single_source_text(text: str, sources: list[WorkflowSourceFile]) -> str:
    cleaned = str(text or "").strip()
    if not cleaned or not _is_single_source_output(sources):
        return cleaned

    cleaned = _strip_markdown_source_sections(cleaned)
    for label in _single_source_labels(sources):
        escaped = re.escape(label)
        cleaned = re.sub(rf"\s*\(({escaped})\)", "", cleaned)
        cleaned = re.sub(rf"\s*\[({escaped})\]", "", cleaned)
        cleaned = re.sub(rf"(?im)^\s*(?:source|file)\s*:\s*{escaped}\s*$", "", cleaned)
        cleaned = re.sub(rf"(?im)^\s*[-*]\s*{escaped}\s*(?:— excerpt truncated)?\s*$", "", cleaned)
        cleaned = re.sub(rf"(?im)^\s*{escaped}\s*:\s*", "", cleaned)
        cleaned = re.sub(rf"(?i)(?:from|using|in|based on|grounded in)\s+{escaped}", "", cleaned)
        cleaned = re.sub(rf"(?<!\w){escaped}(?!\w)", "", cleaned)

    cleaned = re.sub(r"(?im)^\s*(?:source|sources used|source used)\s*:\s*$", "", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned)
    cleaned = re.sub(r"\b(from|using|in|based on|grounded in)\s*([,.;:])", r"\2", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


def _strip_single_source_list(items: list[str], sources: list[WorkflowSourceFile]) -> list[str]:
    return [item for item in (_strip_single_source_text(str(item), sources) for item in items) if item]


def _without_single_source_evidence_labels(items: list[dict[str, Any]], sources: list[WorkflowSourceFile]) -> list[dict[str, Any]]:
    if not _is_single_source_output(sources):
        return items

    cleaned_items: list[dict[str, Any]] = []
    for item in items:
        next_item = dict(item)
        next_item["claim"] = _strip_single_source_text(str(next_item.get("claim") or ""), sources)
        next_item["sources"] = []
        evidence_items: list[dict[str, str]] = []
        for evidence in next_item.get("evidence") or []:
            if not isinstance(evidence, dict):
                continue
            excerpt = _strip_single_source_text(str(evidence.get("excerpt") or ""), sources)
            if excerpt:
                evidence_items.append({"excerpt": excerpt})
        next_item["evidence"] = evidence_items
        if str(next_item.get("claim") or "").strip():
            cleaned_items.append(next_item)
    return cleaned_items


def _append_sources_used_section(text: str, sources: list[WorkflowSourceFile]) -> str:
    cleaned = _strip_markdown_source_sections(str(text or "").strip())
    visible_sources = _customer_visible_sources(sources)
    if not visible_sources:
        return cleaned
    source_lines = ["## Sources used", *_source_manifest_lines(visible_sources)]
    if not cleaned:
        return "\n".join(source_lines).strip()
    return f"{cleaned.rstrip()}\n\n" + "\n".join(source_lines).strip()


def _render_preview(summary: str, bullets: list[str], next_actions: list[str], *, heading: str, sources: list[WorkflowSourceFile]) -> str:
    lines = [f"# {heading}", "", summary.strip(), ""]
    if bullets:
        lines.append("## Highlights")
        lines.extend(f"- {item}" for item in bullets)
        lines.append("")
    if next_actions:
        lines.append("## Suggested next steps")
        lines.extend(f"- {item}" for item in next_actions)
        lines.append("")
    return _append_sources_used_section("\n".join(line for line in lines if line is not None).strip(), sources)


def _result(
    run: WorkflowRun,
    summary: str,
    bullets: list[str],
    next_actions: list[str],
    *,
    sources: list[WorkflowSourceFile],
    preview_markdown: str = "",
    metadata: dict[str, Any] | None = None,
) -> WorkflowResult:
    cleaned_summary = _strip_single_source_text((summary or "").strip() or f"Generated output for {run.title}.", sources)
    cleaned_bullets = _strip_single_source_list([str(item).strip() for item in bullets if str(item).strip()], sources)
    cleaned_actions = _strip_single_source_list([str(item).strip() for item in next_actions if str(item).strip()], sources)
    raw_preview = (preview_markdown or "").strip()
    preview = (
        _append_sources_used_section(_strip_single_source_text(raw_preview, sources), sources)
        if raw_preview
        else _render_preview(
            cleaned_summary,
            cleaned_bullets,
            cleaned_actions,
            heading=run.title,
            sources=sources,
        )
    )
    return WorkflowResult(
        summary=cleaned_summary,
        bullets=cleaned_bullets,
        next_actions=cleaned_actions,
        preview_markdown=preview,
        metadata=dict(metadata or {}),
    )


def _extract_json_payload(raw: str) -> dict[str, Any]:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Empty workflow model response")

    candidates = [raw]
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        candidates.insert(0, fenced.group(1).strip())

    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(raw[start : end + 1])

    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except Exception:
            continue
        if isinstance(data, dict):
            return data

    raise ValueError("Workflow model response was not valid JSON")


def _coerce_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _top_terms(text: str, *, limit: int = 5) -> list[str]:
    counts: Counter[str] = Counter()
    for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{3,}", text or ""):
        lowered = token.lower()
        if lowered in _STOPWORDS:
            continue
        counts[lowered] += 1
    return [term for term, _ in counts.most_common(limit)]




def _workflow_title_prefix(run: WorkflowRun) -> str:
    domain_spec = get_domain_workflow_spec(run.workflow_id)
    if domain_spec is not None:
        return domain_spec.title
    labels = {
        "summarize": "Summary",
        "compare": "Compare",
        "extract": "Extract",
        "draft": "Draft",
        "report": "Report",
        "plan": "Action Plan",
    }
    return labels.get(run.capability, run.title or "Workflow")


def _clean_title_topic(value: str) -> str:
    text = str(value or "").rsplit("/", 1)[-1]
    text = re.sub(r"\.[A-Za-z0-9]{1,8}$", "", text)
    text = re.sub(r"[_-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .:-_—–")
    if not text:
        return "selected files"

    def _title_word(word: str) -> str:
        return word if any(char.isupper() for char in word[1:]) or any(char.isdigit() for char in word) else word.capitalize()

    return " ".join(_title_word(part) for part in text.split())


def _fallback_title_topic(sources: list[WorkflowSourceFile]) -> str:
    visible_sources = _customer_visible_sources(sources)
    names = [_clean_title_topic(_display_source_label(source)) for source in visible_sources if _display_source_label(source)]
    names = [name for name in names if name and name.lower() != "selected files"]
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} vs {names[1]}"
    if len(names) > 2:
        combined = " ".join(source.excerpt for source in visible_sources[:4])
        terms = [term.replace("_", " ").title() for term in _top_terms(combined, limit=2)]
        if terms:
            return f"{names[0]} + {len(names) - 1} more on {' and '.join(terms)}"
        return f"{names[0]} + {len(names) - 1} more"

    terms = [term.replace("_", " ").title() for term in _top_terms(" ".join(source.excerpt for source in sources), limit=3)]
    return " and ".join(terms) if terms else "selected files"


def _fallback_workflow_title(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> str:
    return _sanitize_generated_title(f"{_workflow_title_prefix(run)}: {_fallback_title_topic(sources)}", run)


def _sanitize_generated_title(candidate: str, run: WorkflowRun) -> str:
    prefix = _workflow_title_prefix(run)
    text = str(candidate or "").strip()
    if not text:
        return f"{prefix}: selected files"
    # Reject JSON-like or multi-line responses. Title generation should return a
    # plain title; anything else falls back to deterministic file-based naming.
    if "{" in text or "}" in text:
        return ""
    text = text.splitlines()[0].strip()
    text = re.sub(r"^#+\s*", "", text)
    text = re.sub(r"^[\"'‘’“”]+|[\"'‘’“”]+$", "", text).strip()
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" .:-_—–")
    if len(text) < 4:
        return ""
    if not text.lower().startswith(prefix.lower()):
        text = f"{prefix}: {text}"
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 96:
        text = text[:96].rsplit(" ", 1)[0].strip(" .:-_—–")
    return text or f"{prefix}: selected files"



def _title_metadata_from_candidate(
    run: WorkflowRun,
    sources: list[WorkflowSourceFile],
    candidate: Any,
    *,
    source: str = "ai",
) -> dict[str, Any]:
    fallback = _fallback_workflow_title(run, sources)
    raw_title = str(candidate or "").strip()
    title = _sanitize_generated_title(raw_title, run) if raw_title else ""
    metadata: dict[str, Any] = {}
    if title:
        metadata["generated_title"] = title
        metadata["workflow_title_source"] = source
    else:
        metadata["generated_title"] = fallback
        metadata["workflow_title_source"] = "fallback"
        if candidate is not None:
            metadata["rejected_generated_title"] = True
    return metadata


def _ensure_result_title_metadata(
    result: WorkflowResult,
    run: WorkflowRun,
    sources: list[WorkflowSourceFile],
    *,
    candidate: Any = None,
    source: str = "fallback",
) -> WorkflowResult:
    metadata = dict(result.metadata or {})
    if not str(metadata.get("generated_title") or "").strip():
        metadata.update(_title_metadata_from_candidate(run, sources, candidate, source=source))
    result.metadata = metadata
    return result

def _first_insight_lines(sources: list[WorkflowSourceFile], *, limit: int = 4) -> list[str]:
    lines: list[str] = []
    for source in sources:
        for part in re.split(r"(?<=[.!?])\s+|\n+", source.excerpt):
            clean = re.sub(r"\s+", " ", part).strip(" -•\t")
            if len(clean) < 24:
                continue
            lines.append(clean)
            if len(lines) >= limit:
                return lines
    return lines


def _input_text(run: WorkflowRun, key: str, default: str) -> str:
    value = str(run.inputs.get(key) or "").strip()
    return value or default


def _summary_focus(run: WorkflowRun) -> str:
    return _focus_text(run, "the material that matters most")


def _summary_default_layer(value: Any) -> str:
    key = str(value or "").strip()
    return key if key in _SUMMARY_LAYER_LABELS else "standard"


def _summary_evidence_from_sources(sources: list[WorkflowSourceFile], *, limit: int = 4) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for source in sources:
        evidence_lines = _first_insight_lines([source], limit=2)
        if not evidence_lines:
            continue
        claim = evidence_lines[0]
        evidence = [{"source_name": _source_label(source), "excerpt": line} for line in evidence_lines[:2]]
        items.append(
            {
                "claim": claim,
                "importance": "high" if source.source_kind == "retrieved" else "medium",
                "sources": [_source_label(source)],
                "evidence": evidence,
            }
        )
        if len(items) >= limit:
            break
    return items


def _summary_layers_from_result(result: WorkflowResult, sources: list[WorkflowSourceFile]) -> list[dict[str, str]]:
    snapshot = (result.summary or "").strip()
    standard_parts = [snapshot] if snapshot else []
    standard_parts.extend(f"• {item}" for item in (result.bullets or [])[:4])
    deep_insights = _first_insight_lines(sources, limit=6)
    deep_text = "\n".join(f"- {item}" for item in deep_insights) if deep_insights else "- Review the cited source material for more detail."
    return [
        {"key": "snapshot", "label": _SUMMARY_LAYER_LABELS["snapshot"], "text": snapshot or "No summary available yet."},
        {
            "key": "standard",
            "label": _SUMMARY_LAYER_LABELS["standard"],
            "text": "\n".join(part for part in standard_parts if part).strip() or snapshot or "No standard brief available yet.",
        },
        {"key": "deep_dive", "label": _SUMMARY_LAYER_LABELS["deep_dive"], "text": deep_text},
    ]


def _normalize_summary_layers(value: Any, *, fallback: list[dict[str, str]]) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            label = _SUMMARY_LAYER_LABELS.get(key) or str(item.get("label") or "").strip()
            text = str(item.get("text") or "").strip()
            if key and text:
                cleaned.append({"key": key, "label": label or key.replace("_", " ").title(), "text": text})
    if cleaned:
        return cleaned
    return fallback


def _normalize_evidence_highlights(value: Any, *, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            claim = str(item.get("claim") or "").strip()
            if not claim:
                continue
            sources = [str(source).strip() for source in item.get("sources") or [] if str(source).strip()]
            evidence_items: list[dict[str, str]] = []
            for evidence in item.get("evidence") or []:
                if not isinstance(evidence, dict):
                    continue
                excerpt = str(evidence.get("excerpt") or "").strip()
                if not excerpt:
                    continue
                evidence_items.append(
                    {
                        "source_name": str(evidence.get("source_name") or "Source").strip(),
                        "excerpt": excerpt,
                    }
                )
            cleaned.append(
                {
                    "claim": claim,
                    "importance": str(item.get("importance") or "medium").strip() or "medium",
                    "sources": sources,
                    "evidence": evidence_items,
                }
            )
    return cleaned or fallback


def _summary_actions(focus: str) -> list[dict[str, str]]:
    return [
        {
            "kind": "workflow",
            "label": "Generate report",
            "workflow_id": "generate_report",
            "focus": f"Turn the summary into a polished report. Keep the emphasis on {focus}.",
            "description": "Turn this summary into a more presentation-ready deliverable.",
        },
        {
            "kind": "workflow",
            "label": "Create action plan",
            "workflow_id": "create_action_plan",
            "focus": f"Create a practical follow-up plan from this summary, with priorities, owners, and timelines for {focus}.",
            "description": "Convert the summary into concrete next steps.",
        },
        {
            "kind": "workflow",
            "label": "Draft memo",
            "workflow_id": "draft_from_sources",
            "focus": f"Write a clear memo that captures the summary, decisions, risks, and implications for {focus}.",
            "description": "Start a reusable draft from the same source material.",
        },
    ]


def _render_summary_preview(
    run: WorkflowRun,
    *,
    summary: str,
    bullets: list[str],
    next_actions: list[str],
    sources: list[WorkflowSourceFile],
    layers: list[dict[str, str]],
    evidence_highlights: list[dict[str, Any]],
) -> str:
    lines = [f"# {run.title}", ""]
    for layer in layers:
        lines.append(f"## {layer.get('label') or layer.get('key', 'Summary').replace('_', ' ').title()}")
        lines.append(str(layer.get("text") or "").strip())
        lines.append("")
    if bullets:
        lines.append("## Evidence-backed highlights")
        lines.extend(f"- {item}" for item in bullets)
        lines.append("")
    show_source_labels = not _is_single_source_output(sources)
    if evidence_highlights:
        lines.append("## Supporting evidence")
        for item in evidence_highlights:
            claim = _strip_single_source_text(str(item.get("claim") or "").strip(), sources)
            sources_line = ", ".join(str(source).strip() for source in item.get("sources") or [] if str(source).strip()) if show_source_labels else ""
            if claim:
                lines.append(f"- {claim}{f' [{sources_line}]' if sources_line else ''}")
            for evidence in item.get("evidence") or []:
                if not isinstance(evidence, dict):
                    continue
                excerpt = _strip_single_source_text(str(evidence.get("excerpt") or "").strip(), sources)
                if not excerpt:
                    continue
                source_name = str(evidence.get("source_name") or "Source").strip()
                if show_source_labels and source_name:
                    lines.append(f"  - {source_name}: {excerpt}")
                else:
                    lines.append(f"  - {excerpt}")
        lines.append("")
    if next_actions:
        lines.append("## Suggested next steps")
        lines.extend(f"- {item}" for item in next_actions)
        lines.append("")
    return _append_sources_used_section("\n".join(line for line in lines if line is not None).strip(), sources)


def _normalize_summary_result(run: WorkflowRun, result: WorkflowResult, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    focus = _summary_focus(run)
    metadata = dict(result.metadata or {})
    profile = metadata.get("summary_profile") if isinstance(metadata.get("summary_profile"), dict) else {}
    profile = {
        "focus": str(profile.get("focus") or focus).strip() or focus,
        "default_layer": _summary_default_layer(profile.get("default_layer")),
    }
    metadata["summary_profile"] = profile
    metadata["focus"] = profile["focus"]
    # Older runs could carry audience/depth values from a previous launcher. Keep
    # them out of customer-facing metadata so they do not leak back into the UI.
    metadata.pop("audience", None)
    metadata.pop("depth", None)

    layers = _normalize_summary_layers(
        metadata.get("summary_layers"),
        fallback=_summary_layers_from_result(result, sources),
    )
    if _is_single_source_output(sources):
        layers = [
            {**layer, "text": _strip_single_source_text(str(layer.get("text") or ""), sources)}
            for layer in layers
        ]
    metadata["summary_layers"] = layers

    evidence_highlights = _normalize_evidence_highlights(
        metadata.get("evidence_highlights"),
        fallback=_summary_evidence_from_sources(sources),
    )
    evidence_highlights = _without_single_source_evidence_labels(evidence_highlights, sources)
    metadata["evidence_highlights"] = evidence_highlights

    if evidence_highlights:
        result.bullets = [
            f"{item['claim']} ({', '.join(item['sources'])})" if item.get("sources") else str(item["claim"])
            for item in evidence_highlights[:4]
            if str(item.get("claim") or "").strip()
        ] or result.bullets
    result.summary = _strip_single_source_text(result.summary, sources)
    result.bullets = _strip_single_source_list(result.bullets, sources)
    result.next_actions = _strip_single_source_list(result.next_actions, sources)

    suggested_actions = metadata.get("suggested_actions")
    if not isinstance(suggested_actions, list) or not suggested_actions:
        suggested_actions = _summary_actions(profile["focus"])
    metadata["suggested_actions"] = suggested_actions
    if not result.next_actions:
        result.next_actions = [str(item.get("label") or "").strip() for item in suggested_actions if isinstance(item, dict) and str(item.get("label") or "").strip()]

    result.metadata = metadata
    result.preview_markdown = _render_summary_preview(
        run,
        summary=result.summary,
        bullets=result.bullets,
        next_actions=result.next_actions,
        sources=sources,
        layers=layers,
        evidence_highlights=evidence_highlights,
    )
    return result


def _common_terms(left: WorkflowSourceFile, right: WorkflowSourceFile, *, limit: int = 4) -> list[str]:
    left_terms = set(_top_terms(left.excerpt, limit=12))
    right_terms = set(_top_terms(right.excerpt, limit=12))
    return sorted(left_terms & right_terms)[:limit]


def _only_terms(primary: WorkflowSourceFile, other: WorkflowSourceFile, *, limit: int = 4) -> list[str]:
    primary_terms = set(_top_terms(primary.excerpt, limit=14))
    other_terms = set(_top_terms(other.excerpt, limit=14))
    return sorted(primary_terms - other_terms)[:limit]


def _llm_result(
    run: WorkflowRun,
    sources: list[WorkflowSourceFile],
    *,
    task_brief: str,
    output_requirements: str,
    fallback_factory: Callable[[], WorkflowResult],
) -> WorkflowResult:
    if OpenAIChat is None:
        return _ensure_result_title_metadata(fallback_factory(), run, sources)

    try:
        model = OpenAIChat()
        source_blocks = []
        for idx, source in enumerate(sources, start=1):
            source_blocks.append(
                textwrap.dedent(
                    f"""
                    [{idx}] {_source_label(source)}
                    Folder: {source.folder_path or 'Root'}
                    Content type: {source.content_type or 'unknown'}
                Source kind: {source.source_kind}
                    Excerpt length used: {source.excerpt_chars} of {source.full_text_chars} characters
                    Excerpt:
                    {source.excerpt}
                    """
                ).strip()
            )

        single_source_instruction = (
            "There is one underlying source file. Do not mention the file name or add inline source labels "
            "in the customer-facing summary, bullets, next_actions, or preview_markdown. "
            "The application will add the final Sources used section automatically."
            if _is_single_source_output(sources)
            else "Mention supporting source names only where it helps the reader verify multi-file claims."
        )
        system = textwrap.dedent(
            f"""
            You create workflow outputs for a document workspace.
            Use only the provided source excerpts.
            For Legal Pro workflows, treat any contract fact map as a full-contract coverage control: do not say a clause is missing if the fact map marks that clause family as found. If source text is condensed, say "not found in reviewed material" rather than implying the full agreement lacks the clause.
            Do not invent source facts.
            {single_source_instruction}
            Return valid JSON only.
            The JSON must have exactly these top-level keys:
            title, summary, bullets, next_actions, preview_markdown, metadata.
            - title: short human-readable workflow title. It must start with "{_workflow_title_prefix(run)}:" and describe the source topic
            - summary: short paragraph
            - bullets: array of concise strings
            - next_actions: array of concise strings
            - preview_markdown: complete markdown document content for the user-facing output
            - metadata: object with only workflow-relevant structured data
            """
        ).strip()

        source_excerpt_text = "\n\n".join(source_blocks)
        user = textwrap.dedent(
            f"""
            Workflow type: {_workflow_title_prefix(run)} ({run.workflow_id})
            Current placeholder title: {run.title}
            Generate a better title from the source content and return it in the title field.
            Selection: {_selection_phrase(run)}
            Focus: {_focus_text(run, 'the selected material')}

            Task brief:
            {task_brief}

            Output requirements:
            {output_requirements}

            Source excerpts:
            {source_excerpt_text}
            """
        ).strip()

        response = model.generate_with_usage(system=system, user=user)
        payload = _extract_json_payload(response.text)
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        metadata = dict(metadata)
        metadata.update(_title_metadata_from_candidate(run, sources, payload.get("title"), source="ai"))
        metadata["llm_usage"] = {
            "prompt_tokens": int(response.usage.prompt_tokens or 0),
            "completion_tokens": int(response.usage.completion_tokens or 0),
            "total_tokens": int(response.usage.total_tokens or 0),
            "operation": str(response.operation or "responses.create"),
            "approximate": bool(response.usage.approximate),
        }
        return _result(
            run,
            str(payload.get("summary") or "").strip(),
            _coerce_list(payload.get("bullets")),
            _coerce_list(payload.get("next_actions")),
            sources=sources,
            preview_markdown=str(payload.get("preview_markdown") or "").strip(),
            metadata=metadata,
        )
    except Exception as exc:
        log.exception("workflow_llm_failed", extra={"workflow_id": run.workflow_id})
        fallback_result = _ensure_result_title_metadata(fallback_factory(), run, sources)
        fallback_metadata = dict(fallback_result.metadata or {})
        fallback_metadata["llm_fallback_used"] = True
        fallback_metadata["llm_fallback_reason"] = exc.__class__.__name__
        fallback_result.metadata = fallback_metadata
        return fallback_result


def summarize_handler(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    focus = _summary_focus(run)

    def fallback() -> WorkflowResult:
        evidence_highlights = _summary_evidence_from_sources(sources)
        bullets = [
            _strip_single_source_text(str(item.get("claim") or ""), sources)
            for item in evidence_highlights[:5]
            if str(item.get("claim") or "").strip()
        ]
        if not bullets:
            bullets = _first_insight_lines(sources, limit=5) or ["There was not enough readable text to produce a detailed summary."]

        first_takeaway = bullets[0] if bullets else "the selected material needs a closer review"
        summary = (
            f"The main takeaway is that {first_takeaway[0].lower() + first_takeaway[1:] if first_takeaway else 'the selected material needs a closer review'}"
        ).rstrip(".") + "."
        next_actions = [item["label"] for item in _summary_actions(focus)[:2]]
        preview = textwrap.dedent(
            f"""
            # {run.title}

            {summary}

            ## Summary
            {chr(10).join(f"- {item}" for item in bullets[:5])}

            ## Next steps
            {chr(10).join(f"- {item}" for item in next_actions)}
            """
        ).strip()
        return _result(
            run,
            summary=summary,
            bullets=bullets,
            next_actions=next_actions,
            sources=sources,
            preview_markdown=preview,
            metadata={
                "focus": focus,
                "summary_profile": {"focus": focus},
                "evidence_highlights": _without_single_source_evidence_labels(evidence_highlights, sources),
                "suggested_actions": _summary_actions(focus),
            },
        )

    result = _llm_result(
        run,
        sources,
        task_brief=(
            f"Write a useful, source-grounded summary focused on {focus}. "
            "Prioritize what changed, what matters, practical implications, unresolved questions, risks, and decisions. "
            "Use natural business language. Avoid generic workflow language, filler, and phrases like 'this document discusses' or 'generated a summary'."
        ),
        output_requirements=(
            (
                "For a single source file, do not name the file or use inline source labels anywhere in the user-facing text. "
                if _is_single_source_output(sources)
                else "For multi-file summaries, mention source names only where they help verify a specific claim. "
            )
            + "Make preview_markdown the full user-facing artifact. It should read like a clean summary document, not a dashboard card. "
            "Use headings and bullet points when they improve readability, but do not force sections like key takeaways unless they fit the content. "
            "Keep summary as a short lead paragraph, bullets as 3-6 concrete supporting points, and next_actions as practical revision or follow-up options. "
            "In metadata, include summary_profile with focus only, evidence_highlights if useful, and suggested_actions with label, workflow_id, focus, and description. "
            "Do not include source sections in preview_markdown; the application adds Sources used separately."
        ),
        fallback_factory=fallback,
    )
    metadata = dict(result.metadata or {})
    profile = metadata.get("summary_profile") if isinstance(metadata.get("summary_profile"), dict) else {}
    metadata["summary_profile"] = {"focus": str(profile.get("focus") or focus).strip() or focus}
    metadata["focus"] = metadata["summary_profile"]["focus"]
    metadata.pop("audience", None)
    metadata.pop("depth", None)
    metadata.pop("summary_layers", None)
    if not isinstance(metadata.get("suggested_actions"), list) or not metadata.get("suggested_actions"):
        metadata["suggested_actions"] = _summary_actions(metadata["focus"])
    if isinstance(metadata.get("evidence_highlights"), list):
        metadata["evidence_highlights"] = _without_single_source_evidence_labels(
            _normalize_evidence_highlights(metadata.get("evidence_highlights"), fallback=[]),
            sources,
        )
    result.metadata = metadata
    return result

def compare_handler(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    focus = _focus_text(run, "important differences and missing content")
    left, right = (sources + sources[:1])[:2]

    def fallback() -> WorkflowResult:
        shared = _common_terms(left, right)
        only_left = _only_terms(left, right)
        only_right = _only_terms(right, left)
        differences: list[dict[str, str]] = []
        if shared:
            differences.append(
                {
                    "topic": "Shared themes",
                    "file_a": ", ".join(shared),
                    "file_b": ", ".join(shared),
                    "impact": "Both files cover these topics.",
                }
            )
        if only_left:
            differences.append(
                {
                    "topic": left.name,
                    "file_a": ", ".join(only_left),
                    "file_b": "Not prominent",
                    "impact": f"More emphasis in {left.name}.",
                }
            )
        if only_right:
            differences.append(
                {
                    "topic": right.name,
                    "file_a": "Not prominent",
                    "file_b": ", ".join(only_right),
                    "impact": f"More emphasis in {right.name}.",
                }
            )
        bullets = [
            f"{left.name} excerpt used: {left.excerpt_chars} characters.",
            f"{right.name} excerpt used: {right.excerpt_chars} characters.",
        ]
        if shared:
            bullets.append(f"Shared themes: {', '.join(shared)}.")
        if only_left:
            bullets.append(f"{left.name}-leaning topics: {', '.join(only_left)}.")
        if only_right:
            bullets.append(f"{right.name}-leaning topics: {', '.join(only_right)}.")
        return _result(
            run,
            summary=f"Compared {left.name} and {right.name} with focus on {focus}.",
            bullets=bullets,
            next_actions=[
                "Review the highlighted differences before drafting a response or approval note.",
                "Run Generate Report if you need a stakeholder-facing comparison brief.",
            ],
            sources=sources,
            metadata={"differences": differences, "focus": focus},
        )

    return _llm_result(
        run,
        sources,
        task_brief=f"Compare the two selected files and highlight {focus}.",
        output_requirements=(
            "Include 3-6 bullets, 2-4 next actions, and metadata.differences as an array of objects with topic, file_a, file_b, and impact. "
            "The markdown should include a concise comparison table or clearly separated sections."
        ),
        fallback_factory=fallback,
    )


def extract_handler(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    focus = _focus_text(run, "key dates, names, totals, and obligations")

    def fallback() -> WorkflowResult:
        combined = "\n".join(source.excerpt for source in sources)
        fields: list[dict[str, str]] = []
        for label, pattern in [
            ("Dates", r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b"),
            ("Emails", r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b"),
            ("Amounts", r"(?:[$€£]\s?\d[\d,]*(?:\.\d+)?)"),
        ]:
            matches = [m.group(0) for m in re.finditer(pattern, combined, flags=re.IGNORECASE)]
            if matches:
                fields.append({"field": label, "value": ", ".join(matches[:4]), "confidence": "medium"})
        if not fields:
            for insight in _first_insight_lines(sources, limit=4):
                fields.append({"field": "Extracted detail", "value": insight, "confidence": "low"})
        bullets = [f"Requested focus: {focus}."] + [f"{field['field']}: {field['value']}" for field in fields[:3]]
        return _result(
            run,
            summary=f"Extracted structured details from {_source_file_count(sources)} selected file(s).",
            bullets=bullets,
            next_actions=[
                "Validate the extracted fields before exporting or sharing them.",
                "Use Generate Report if you want the extracted details packaged into a narrative brief.",
            ],
            sources=sources,
            metadata={"fields": fields, "focus": focus},
        )

    return _llm_result(
        run,
        sources,
        task_brief=f"Extract structured information from the source excerpts with emphasis on {focus}.",
        output_requirements=(
            "Include metadata.fields as an array of objects with field, value, and confidence. "
            "The markdown should include a compact table or bullet list of extracted fields."
        ),
        fallback_factory=fallback,
    )


def draft_handler(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    focus = _focus_text(run, "a polished first draft grounded in the selected source material")

    def fallback() -> WorkflowResult:
        opening = _first_insight_lines(sources, limit=2)
        body_points = _first_insight_lines(sources, limit=4)
        preview = textwrap.dedent(
            f"""
            # Draft

            ## Objective
            {focus}

            ## Draft
            {opening[0] if opening else 'This draft is based on the selected files.'}

            {' '.join(body_points[1:3]) if len(body_points) > 1 else 'Use the source material to expand this section with specific details.'}
            """
        ).strip()
        return _result(
            run,
            summary=f"Prepared a first draft using {_source_file_count(sources)} selected file(s).",
            bullets=[f"Draft intent: {focus}."] + body_points[:3],
            next_actions=[
                "Edit the draft tone and audience before sharing it externally.",
                "Run Summarize if you want a shorter supporting brief alongside the draft.",
            ],
            sources=sources,
            preview_markdown=preview,
            metadata={"draft_type": focus},
        )

    return _llm_result(
        run,
        sources,
        task_brief=f"Create a usable first draft based on the selected source material. The draft goal is {focus}.",
        output_requirements=(
            "The markdown should contain the actual draft body, not just bullet points. "
            "Metadata may include draft_type and any optional audience or tone hints you infer from the prompt."
        ),
        fallback_factory=fallback,
    )


def report_handler(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    focus = _focus_text(run, "an executive brief with source-backed recommendations")

    def fallback() -> WorkflowResult:
        highlights = _first_insight_lines(sources, limit=4)
        highlight_lines = "\n".join(f"- {item}" for item in highlights[:4]) if highlights else "- Review the selected files for the most relevant details."
        preview = textwrap.dedent(
            f"""
            # Report

            ## Audience
            {focus}

            ## Executive summary
            This report consolidates the selected material into a concise brief.

            ## Key points
            {highlight_lines}

            ## Recommended follow-up
            - Confirm any critical facts before distribution.
            - Tailor the brief to the final audience before sending.
            """
        ).strip()
        return _result(
            run,
            summary=f"Prepared a reusable report structure from {_source_file_count(sources)} selected file(s).",
            bullets=highlights[:4] or [f"Audience goal: {focus}."],
            next_actions=[
                "Review the report sections and adjust the audience framing if needed.",
                "Copy the markdown into email or export tooling once the content is final.",
            ],
            sources=sources,
            preview_markdown=preview,
            metadata={"audience": focus},
        )

    return _llm_result(
        run,
        sources,
        task_brief=f"Package the selected material into a report or brief for {focus}.",
        output_requirements=(
            "The markdown should read like a report with sections, not just bullets. "
            "Keep the summary concise and include 2-4 practical next actions."
        ),
        fallback_factory=fallback,
    )


def plan_handler(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    focus = _focus_text(run, "recommended next steps, owners, and priorities")

    def fallback() -> WorkflowResult:
        highlights = _first_insight_lines(sources, limit=4)
        plan_items = [
            {
                "action": "Review the selected material and confirm the most urgent issue.",
                "priority": "high",
                "owner": "TBD",
                "timeline": "Now",
            },
            {
                "action": "Turn the key findings into assigned follow-up work.",
                "priority": "medium",
                "owner": "TBD",
                "timeline": "This week",
            },
        ]
        bullets = [f"Planning goal: {focus}."] + highlights[:3]
        return _result(
            run,
            summary=f"Built an action-oriented outline from {_source_file_count(sources)} selected file(s).",
            bullets=bullets,
            next_actions=[item["action"] for item in plan_items],
            sources=sources,
            metadata={"plan_items": plan_items, "focus": focus},
        )

    return _llm_result(
        run,
        sources,
        task_brief=f"Create an actionable plan based on the selected material. Optimize for {focus}.",
        output_requirements=(
            "Include metadata.plan_items as an array of objects with action, priority, owner, and timeline. "
            "The markdown should include sections for priorities and next steps."
        ),
        fallback_factory=fallback,
    )


def _clean_choice(value: Any, default: str) -> str:
    text = str(value or "").strip()
    return text or default


def _humanize_choice(value: str) -> str:
    text = str(value or "").replace("_", " ").replace("/", " / ").strip()
    return re.sub(r"\s+", " ", text).capitalize() if text else "Not specified"


def _legal_profile_from_run(run: WorkflowRun) -> dict[str, Any]:
    document_type = _clean_choice(run.inputs.get("document_type"), "general_contract")
    review_mode = _clean_choice(run.inputs.get("review_mode"), "business_risk")
    counterparty_position = _clean_choice(run.inputs.get("counterparty_position"), "unknown")
    risk_tolerance = _clean_choice(run.inputs.get("risk_tolerance"), "balanced")
    return {
        "document_type": document_type,
        "document_type_label": _humanize_choice(document_type),
        "review_mode": review_mode,
        "review_mode_label": _humanize_choice(review_mode),
        "counterparty_position": counterparty_position,
        "counterparty_position_label": _humanize_choice(counterparty_position),
        "risk_tolerance": risk_tolerance,
        "risk_tolerance_label": _humanize_choice(risk_tolerance),
        "clause_families": list(LEGAL_CLAUSE_FAMILIES),
        "risk_levels": list(LEGAL_RISK_LEVELS),
        "house_position_summary": LEGAL_HOUSE_POSITION_SUMMARY,
    }


def _legal_context_for_prompt(profile: dict[str, Any]) -> str:
    return textwrap.dedent(
        f"""
        Legal pack profile:
        - Document type: {profile.get('document_type_label')}
        - Review mode: {profile.get('review_mode_label')}
        - Counterparty: {profile.get('counterparty_position_label')}
        - Risk tolerance: {profile.get('risk_tolerance_label')}
        - Clause families: {', '.join(LEGAL_CLAUSE_FAMILIES)}
        - Risk levels: {', '.join(LEGAL_RISK_LEVELS)}
        - Default house positions: {LEGAL_HOUSE_POSITION_SUMMARY}
        """
    ).strip()


def _dict_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _metadata_text(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _metadata_first_text(item: dict[str, Any], keys: tuple[str, ...], fallback: str = "") -> str:
    for key in keys:
        text = _metadata_text(item.get(key))
        if text:
            return text
    return fallback


def _legal_clause_family(value: Any, fallback: str = "general_contract") -> str:
    text = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    if text in LEGAL_CLAUSE_FAMILIES:
        return text
    aliases = {
        "liability": "limitation_of_liability",
        "lol": "limitation_of_liability",
        "limitation": "limitation_of_liability",
        "ip": "ip_ownership",
        "intellectual_property": "ip_ownership",
        "data_security": "data_protection",
        "security": "data_protection",
        "privacy": "data_protection",
        "law": "governing_law",
        "venue": "dispute_resolution",
        "fees": "payment",
        "service_levels": "warranties",
        "sla": "warranties",
    }
    return aliases.get(text) or fallback


def _legal_severity(value: Any, fallback: str = "medium") -> str:
    text = str(value or "").strip().lower()
    if text in LEGAL_RISK_LEVELS:
        return text
    aliases = {
        "blocker": "critical",
        "approval_blocker": "critical",
        "material": "high",
        "major": "high",
        "moderate": "medium",
        "review": "medium",
        "minor": "low",
    }
    return aliases.get(text) or fallback


def _metadata_confidence(value: Any, fallback: str = "low") -> str:
    text = str(value or "").strip().lower()
    return text if text in {"low", "medium", "high"} else fallback




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
    "general_contract": "General Contract",
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

_FAMILY_RISK_TITLES: dict[str, str] = {
    "confidentiality": "Confidentiality obligations may be too broad, too narrow, or missing operational guardrails",
    "indemnity": "Indemnity allocation may shift third-party claim exposure beyond the intended deal risk",
    "limitation_of_liability": "Liability cap or damages exclusions may leave material exposure unresolved",
    "termination": "Termination and exit mechanics may not give the business a clean path out",
    "renewal": "Renewal mechanics may create unintended extensions or missed notice windows",
    "ip_ownership": "IP ownership or license rights may not match paid deliverable expectations",
    "data_protection": "Data protection and security obligations may be incomplete or operationally demanding",
    "governing_law": "Governing law and forum terms may affect enforcement cost and leverage",
    "payment": "Payment, fee, tax, or invoice terms may create commercial uncertainty",
    "assignment": "Assignment or change-of-control rights may allow an unwanted counterparty change",
    "audit": "Audit rights may be too narrow for oversight or too broad operationally",
    "insurance": "Insurance requirements may be missing or underspecified",
    "non_solicit": "Non-solicit obligations may restrict recruiting or operating flexibility",
    "exclusivity": "Exclusivity or standstill restrictions may limit strategic flexibility",
    "warranties": "Warranties, service levels, or remedies may not support the expected service quality",
    "dispute_resolution": "Dispute-resolution mechanics may limit practical enforcement or escalation rights",
    "change_control": "Change-control and approval mechanics may create scope or acceptance ambiguity",
    "notices": "Notice mechanics may create administrative risk if delivery methods are outdated or unclear",
}

_FAMILY_RECOMMENDATIONS: dict[str, str] = {
    "confidentiality": "Clarify scope, permitted disclosures, return/destruction, survival, and required flow-down obligations.",
    "indemnity": "Narrow indemnity to claims caused by the responsible party and add procedure, defense-control, and fault carveouts.",
    "limitation_of_liability": "Confirm a reasonable aggregate cap and add narrow carveouts for confidentiality, data/security, IP misuse, payment, and intentional misconduct where appropriate.",
    "termination": "Add clear termination for cause, cure periods, transition support, and post-termination payment/return obligations.",
    "renewal": "Add explicit renewal term, non-renewal notice window, and no unintended evergreen renewal without clear notice.",
    "ip_ownership": "Confirm customer ownership or broad paid-up use rights for paid deliverables while preserving only necessary background-IP rights.",
    "data_protection": "Add specific security controls, breach notice, subprocessor flow-downs, data return/deletion, and audit support.",
    "governing_law": "Confirm governing law, venue, jurisdiction, and any jury waiver are acceptable for the deal.",
    "payment": "Specify fees, invoice timing, dispute windows, taxes, late fees, and withholding rights for disputed amounts.",
    "assignment": "Require consent or at least notice for transfers, with a customer exit right for risky competitor or change-of-control assignments.",
    "audit": "Define audit scope, frequency, notice, cost, confidentiality, and escalated rights for material non-compliance.",
    "insurance": "Add coverage types, minimum limits, certificates, cancellation notice, and cyber/professional coverage where relevant.",
    "non_solicit": "Narrow covered people, duration, and solicitation scope; preserve general solicitation and existing contact carveouts.",
    "exclusivity": "Confirm the business intentionally accepts the restriction; otherwise narrow scope, duration, and exceptions.",
    "warranties": "Tie warranties and service levels to objective metrics, remedies, cure rights, and escalation obligations.",
    "dispute_resolution": "Confirm forum, rules, interim relief, confidentiality, cost allocation, and escalation process.",
    "change_control": "Require written approvals, impact analysis, pricing/schedule controls, and clear acceptance rules.",
    "notices": "Keep formal delivery mechanics but add operational notice contacts where needed.",
}


def _safe_markdown_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).replace("|", "\\|")


def _source_corpus(sources: list[WorkflowSourceFile]) -> str:
    return "\n\n".join(str(source.excerpt or "") for source in sources if str(source.excerpt or "").strip())


def _compact_source_basis(text: str, keywords: tuple[str, ...], *, fallback: str = "Source excerpt should be checked for this clause family.") -> str:
    corpus = re.sub(r"\s+", " ", str(text or "").strip())
    if not corpus:
        return fallback
    lower = corpus.lower()
    hit_index = -1
    hit_keyword = ""
    for keyword in keywords:
        idx = lower.find(keyword.lower())
        if idx >= 0 and (hit_index < 0 or idx < hit_index):
            hit_index = idx
            hit_keyword = keyword
    if hit_index < 0:
        return fallback
    start = max(0, hit_index - 120)
    end = min(len(corpus), hit_index + max(180, len(hit_keyword) + 120))
    snippet = corpus[start:end].strip()
    if start > 0:
        snippet = "…" + snippet
    if end < len(corpus):
        snippet = snippet + "…"
    return snippet


def _requested_clause_families(run: WorkflowRun, *, default: list[str] | None = None) -> list[str]:
    text = " ".join(str(run.inputs.get(key) or "") for key in ("target_issue", "priority_areas", "focus", "desired_position", "output_type")).lower()
    aliases: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("limitation_of_liability", ("limitation of liability", "liability", "damages", "cap", "uncapped")),
        ("indemnity", ("indemnity", "indemnification", "indemnify", "third-party claims", "third party claims")),
        ("termination", ("termination", "terminate", "exit", "survival", "wind-down", "wind down")),
        ("warranties", ("service obligations", "service levels", "service obligation", "sla", "warranty", "warranties", "performance")),
        ("change_control", ("change control", "change order", "change request", "approval", "acceptance", "review")),
        ("data_protection", ("data", "security", "privacy", "breach", "subprocessor", "personal data")),
        ("ip_ownership", ("ip", "intellectual property", "ownership", "work product", "deliverable", "license")),
        ("payment", ("payment", "fees", "invoice", "tax", "charges")),
        ("renewal", ("renewal", "auto-renew", "non-renew", "anniversary")),
        ("audit", ("audit", "inspection", "assessment", "certification")),
        ("assignment", ("assignment", "assign", "change of control")),
        ("confidentiality", ("confidential", "confidentiality", "non-disclosure", "nda")),
        ("insurance", ("insurance", "coverage")),
        ("governing_law", ("governing law", "jurisdiction", "venue")),
        ("dispute_resolution", ("dispute", "arbitration", "injunctive")),
    )
    families: list[str] = []
    for family, terms in aliases:
        if any(term in text for term in terms) and family not in families:
            families.append(family)
    if families:
        return families
    return list(default or [])


def _source_matched_families(sources: list[WorkflowSourceFile], preferred: list[str], *, limit: int = 8) -> list[str]:
    corpus = _source_corpus(sources).lower()
    ordered = list(preferred)
    for family in LEGAL_CLAUSE_FAMILIES:
        if family not in ordered:
            ordered.append(family)
    matched: list[str] = []
    for family in ordered:
        keywords = LEGAL_CLAUSE_FAMILY_KEYWORDS.get(family, ())
        if family in preferred or any(keyword.lower() in corpus for keyword in keywords):
            if family not in matched:
                matched.append(family)
        if len(matched) >= limit:
            break
    return matched or (preferred[:limit] if preferred else ["general_contract"])


def _risk_item_for_family(family: str, sources: list[WorkflowSourceFile], *, requested: bool = False, severity: str = "medium") -> dict[str, Any]:
    keywords = LEGAL_CLAUSE_FAMILY_KEYWORDS.get(family, ())
    basis = _compact_source_basis(
        _source_corpus(sources),
        keywords,
        fallback=("Requested focus; the source excerpt did not provide enough direct clause language for this family." if requested else "Source excerpt should be checked for this clause family."),
    )
    return {
        "issue": _FAMILY_RISK_TITLES.get(family, f"{LEGAL_CLAUSE_FAMILY_LABELS.get(family, _humanize_choice(family))} position needs review"),
        "severity": severity,
        "clause_family": _legal_clause_family(family),
        "business_impact": "Could affect approval, negotiation posture, operating obligations, or recovery if the relationship fails.",
        "source_basis": basis,
        "recommended_change": _FAMILY_RECOMMENDATIONS.get(family, "Confirm the source language and align it with the approved house position."),
        "fallback_position": "Accept only if the business owner approves the residual risk and the clause is documented as an exception.",
        "requires_human_review": severity in {"high", "critical"} or requested,
    }


def _legal_requested_fallback_items(metadata: dict[str, Any], run: WorkflowRun, sources: list[WorkflowSourceFile]) -> list[dict[str, Any]]:
    requested = _requested_clause_families(run)
    if not requested:
        return []
    existing = _normalize_legal_fallback_items(metadata.get("fallback_items"))
    by_family: dict[str, dict[str, Any]] = {str(item.get("clause_family")): item for item in existing}
    risks = _normalize_legal_risk_items(metadata.get("risk_items"))
    clauses = _normalize_legal_clause_items(metadata.get("clause_items"))
    for family in requested:
        canonical = _legal_clause_family(family)
        if canonical in by_family:
            continue
        risk = next((item for item in risks if item.get("clause_family") == canonical), None)
        clause = next((item for item in clauses if item.get("clause_family") == canonical), None)
        basis = _metadata_text((risk or {}).get("source_basis") or (clause or {}).get("source_basis"))
        if not basis:
            basis = _compact_source_basis(_source_corpus(sources), LEGAL_CLAUSE_FAMILY_KEYWORDS.get(canonical, ()), fallback="Requested focus; the source excerpt did not provide enough direct clause language for this family.")
        proposed = _metadata_text((risk or {}).get("recommended_change") or (clause or {}).get("recommended_position"), _FAMILY_RECOMMENDATIONS.get(canonical, "Revise this clause to align with the approved house position."))
        by_family[canonical] = {
            "clause_family": canonical,
            "proposed_language": proposed,
            "rationale": _metadata_text((risk or {}).get("business_impact") or (clause or {}).get("concern"), "This item was requested in the fallback-language target issue and should be handled explicitly before approval."),
            "source_basis": basis,
            "confidence": "medium" if "did not provide enough direct clause language" not in basis else "low",
        }
    return list(by_family.values())


def _markdown_has_heading(markdown: str, heading: str) -> bool:
    return bool(re.search(rf"^\s*#{{1,6}}\s+.*{re.escape(heading)}.*$", markdown or "", re.IGNORECASE | re.MULTILINE))


def _append_section(markdown: str, heading: str, body: str) -> str:
    if _markdown_has_heading(markdown, heading):
        return markdown
    clean_body = str(body or "").strip() or "No additional items were generated for this section."
    return f"{str(markdown or '').rstrip()}\n\n## {heading}\n{clean_body}".strip()


def _insert_section_after_title(markdown: str, heading: str, body: str) -> str:
    if _markdown_has_heading(markdown, heading):
        return markdown
    clean_body = str(body or "").strip() or "No additional items were generated for this section."
    text = str(markdown or "").strip()
    section = f"## {heading}\n{clean_body}"
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if re.match(r"^\s*#\s+", line):
            insert_at = index + 1
            while insert_at < len(lines) and not lines[insert_at].strip():
                insert_at += 1
            return "\n".join(lines[: index + 1] + ["", section, ""] + lines[insert_at:]).strip()
    return f"{section}\n\n{text}".strip()


def _fallback_target_markdown(fallback_items: list[dict[str, Any]], requested: list[str]) -> str:
    if not requested:
        return ""
    by_family = {str(item.get("clause_family") or ""): item for item in fallback_items}
    sections: list[str] = []
    for family in requested:
        canonical = _legal_clause_family(family)
        item = by_family.get(canonical)
        label = LEGAL_CLAUSE_FAMILY_LABELS.get(canonical, _humanize_choice(canonical))
        if not item:
            sections.append(
                f"### {label}\n"
                "**Fallback language:** Confirm whether the source contract contains enough direct language to draft this fallback.\n\n"
                "**Rationale:** This clause family was requested in the workflow input but was not available in structured fallback metadata.\n\n"
                "**Fallback ladder:** Require business/legal confirmation before sending a redline."
            )
            continue
        sections.append(
            f"### {label}\n"
            f"**Fallback language:** {_safe_markdown_text(item.get('proposed_language'))}\n\n"
            f"**Rationale:** {_safe_markdown_text(item.get('rationale'))}\n\n"
            f"**Source basis:** {_safe_markdown_text(item.get('source_basis'))}\n\n"
            "**Fallback ladder:** Start with the fallback language above; if resisted, narrow it to the minimum change needed to preserve the business position."
        )
    return "\n\n".join(sections).strip()


def _risk_markdown_table(risk_items: list[dict[str, Any]]) -> str:
    if not risk_items:
        return "- No structured risk items were generated."
    rows = ["| Issue | Severity | Business Impact | Recommendation |", "|---|---:|---|---|"]
    for item in risk_items[:10]:
        rows.append("| " + " | ".join(_safe_markdown_text(value) for value in (item.get("issue"), item.get("severity"), item.get("business_impact"), item.get("recommended_change"))) + " |")
    return "\n".join(rows)


def _obligation_markdown_list(obligation_items: list[dict[str, Any]]) -> str:
    if not obligation_items:
        return "- Confirm operational obligations, owners, and deadlines before signature."
    return "\n".join(
        f"- **{_safe_markdown_text(item.get('responsible_party') or 'TBD')}**: {_safe_markdown_text(item.get('obligation'))} — {_safe_markdown_text(item.get('trigger_or_deadline') or 'Timing TBD')}"
        for item in obligation_items[:8]
    )


def _recommendations_markdown(risk_items: list[dict[str, Any]], fallback_items: list[dict[str, Any]] | None = None) -> str:
    lines: list[str] = []
    for item in risk_items[:8]:
        recommendation = _metadata_text(item.get("recommended_change"))
        if recommendation:
            lines.append(f"- **{LEGAL_CLAUSE_FAMILY_LABELS.get(str(item.get('clause_family')), _humanize_choice(str(item.get('clause_family') or 'Issue')))}:** {recommendation}")
    for item in (fallback_items or [])[:8]:
        proposed = _metadata_text(item.get("proposed_language"))
        if proposed and not any(proposed in line for line in lines):
            lines.append(f"- **{LEGAL_CLAUSE_FAMILY_LABELS.get(str(item.get('clause_family')), _humanize_choice(str(item.get('clause_family') or 'Fallback')))} fallback:** {proposed}")
    return "\n".join(lines) or "- Confirm the high-impact issues and approval exceptions before sending comments."


def _ensure_legal_preview_sections(result: WorkflowResult, run: WorkflowRun, spec, metadata: dict[str, Any]) -> None:
    markdown = str(result.preview_markdown or "").strip() or f"# {run.title}\n\n{result.summary}"
    risk_items = _normalize_legal_risk_items(metadata.get("risk_items"))
    obligation_items = _normalize_legal_obligation_items(metadata.get("obligation_items"))
    fallback_items = _normalize_legal_fallback_items(metadata.get("fallback_items"))
    if spec.workflow_id == "legal_contract_review":
        markdown = _insert_section_after_title(markdown, "Executive Summary", result.summary)
        markdown = _append_section(markdown, "Risks", _risk_markdown_table(risk_items))
        markdown = _append_section(markdown, "Operational Obligations", _obligation_markdown_list(obligation_items))
        markdown = _append_section(markdown, "Recommendations", _recommendations_markdown(risk_items))
    elif spec.workflow_id == "legal_contract_risk_matrix":
        markdown = _append_section(markdown, "Executive Summary", result.summary)
        markdown = _append_section(markdown, "Recommendations", _recommendations_markdown(risk_items))
        markdown = _append_section(markdown, "Approval Checklist", "\n".join(f"- {item}" for item in metadata.get("approval_notes") or []) or "- Confirm approval owners for high and critical risks before signature.")
    elif spec.workflow_id == "legal_fallback_language":
        requested = _requested_clause_families(run)
        if requested:
            target_markdown = _fallback_target_markdown(fallback_items, requested)
            markdown = _append_section(markdown, "Targeted Fallback Language", target_markdown)
            existing = {str(item.get("clause_family")) for item in fallback_items}
            coverage_lines = []
            for family in requested:
                canonical = _legal_clause_family(family)
                label = LEGAL_CLAUSE_FAMILY_LABELS.get(canonical, _humanize_choice(canonical))
                status = "covered" if canonical in existing else "needs manual confirmation"
                coverage_lines.append(f"- {label}: {status}")
            markdown = _append_section(markdown, "Targeted Clause Coverage", "\n".join(coverage_lines))
    result.preview_markdown = markdown.strip()

def _normalize_legal_risk_items(value: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in _dict_list(value):
        issue = _metadata_first_text(item, ("issue", "risk", "title", "finding"), "Unspecified legal risk")
        severity = _legal_severity(item.get("severity"))
        clause_family = _legal_clause_family(item.get("clause_family") or item.get("category") or item.get("clause"))
        recommended_change = _metadata_first_text(
            item,
            ("recommended_change", "recommended_fix", "recommendation", "recommended_position", "recommended_action"),
            "Review and revise the source language if it creates avoidable exposure.",
        )
        fallback_position = _metadata_first_text(
            item,
            ("fallback_position", "fallback", "acceptable_fallback", "fallback_language"),
            "Use the default house position unless the business accepts the exception.",
        )
        requires_human_review_raw = item.get("requires_human_review")
        requires_human_review = (
            requires_human_review_raw
            if isinstance(requires_human_review_raw, bool)
            else severity in {"high", "critical"}
        )
        normalized.append(
            {
                **item,
                "issue": issue,
                "severity": severity,
                "clause_family": clause_family,
                "business_impact": _metadata_first_text(
                    item,
                    ("business_impact", "impact", "commercial_impact"),
                    "Could affect approval, negotiation posture, or operational execution.",
                ),
                "source_basis": _metadata_first_text(item, ("source_basis", "source", "evidence"), "Not available"),
                "recommended_change": recommended_change,
                "fallback_position": fallback_position,
                "requires_human_review": requires_human_review,
            }
        )
    return normalized


def _normalize_legal_clause_items(value: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in _dict_list(value):
        clause_family = _legal_clause_family(item.get("clause_family") or item.get("category") or item.get("clause"))
        current_position = _metadata_first_text(
            item,
            ("current_position", "position", "clause_text", "value", "summary"),
            "Current position should be confirmed against the source language.",
        )
        concern = _metadata_first_text(
            item,
            ("concern", "issue", "risk", "comment"),
            "Confirm whether this clause position aligns with the desired risk posture.",
        )
        recommended_position = _metadata_first_text(
            item,
            ("recommended_position", "recommended_change", "recommendation", "fallback_position"),
            "Align the clause with the applicable house position or approved fallback.",
        )
        normalized.append(
            {
                **item,
                "clause_family": clause_family,
                "current_position": current_position,
                "source_basis": _metadata_first_text(item, ("source_basis", "source", "evidence"), current_position),
                "concern": concern,
                "recommended_position": recommended_position,
            }
        )
    return normalized


def _normalize_legal_obligation_items(value: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in _dict_list(value):
        obligation = _metadata_first_text(item, ("obligation", "duty", "action", "requirement"), "Confirm obligation from source material")
        normalized.append(
            {
                **item,
                "obligation": obligation,
                "responsible_party": _metadata_first_text(item, ("responsible_party", "party", "owner"), "TBD"),
                "trigger_or_deadline": _metadata_first_text(item, ("trigger_or_deadline", "deadline", "trigger", "timing"), "TBD"),
                "source_basis": _metadata_first_text(item, ("source_basis", "source", "evidence"), obligation),
                "follow_up": _metadata_first_text(item, ("follow_up", "next_step", "recommended_action"), "Confirm owner, timing, and operational handoff."),
            }
        )
    return normalized


def _normalize_legal_fallback_items(value: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in _dict_list(value):
        proposed_language = _metadata_first_text(
            item,
            ("proposed_language", "language", "clause_language", "fallback_language", "draft", "text"),
            "Revise the clause to align with the selected fallback position.",
        )
        normalized.append(
            {
                **item,
                "clause_family": _legal_clause_family(item.get("clause_family") or item.get("category") or item.get("clause")),
                "proposed_language": proposed_language,
                "rationale": _metadata_first_text(
                    item,
                    ("rationale", "reason", "explanation", "business_impact"),
                    "This fallback narrows uncertainty while preserving a workable commercial position.",
                ),
                "source_basis": _metadata_first_text(item, ("source_basis", "source", "evidence"), "Not available"),
                "confidence": _metadata_confidence(item.get("confidence")),
            }
        )
    return normalized


def _normalize_legal_plan_items(value: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in _dict_list(value):
        action = _metadata_first_text(item, ("action", "item", "change", "task"), "Confirm negotiation position")
        normalized.append(
            {
                **item,
                "action": action,
                "priority": _metadata_first_text(item, ("priority",), "medium"),
                "owner": _metadata_first_text(item, ("owner", "responsible_party"), "TBD"),
                "timeline": _metadata_first_text(item, ("timeline", "deadline"), "TBD"),
                "related_clause_family": _legal_clause_family(item.get("related_clause_family") or item.get("clause_family")),
            }
        )
    return normalized


def _normalize_legal_fields(value: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in _dict_list(value):
        field = _metadata_first_text(item, ("field", "name", "label", "clause_family"), "Extracted detail")
        value_text = _metadata_first_text(item, ("value", "current_position", "text", "summary", "obligation"), "Confirm against source material")
        normalized.append(
            {
                **item,
                "field": field,
                "value": value_text,
                "confidence": _metadata_confidence(item.get("confidence")),
                "source_basis": _metadata_first_text(item, ("source_basis", "source", "evidence"), value_text),
            }
        )
    return normalized


def _fallback_item_from_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    first_risk = metadata["risk_items"][0] if metadata.get("risk_items") else {}
    first_clause = metadata["clause_items"][0] if metadata.get("clause_items") else {}
    clause_family = _legal_clause_family(first_risk.get("clause_family") or first_clause.get("clause_family"))
    proposed_language = _metadata_text(
        first_risk.get("recommended_change")
        or first_clause.get("recommended_position")
        or first_risk.get("fallback_position"),
        "Revise the clause to align with the selected fallback position.",
    )
    rationale = _metadata_text(
        first_risk.get("business_impact") or first_clause.get("concern"),
        "The source material indicates approval-sensitive language that should be narrowed or clarified.",
    )
    source_basis = _metadata_text(first_risk.get("source_basis") or first_clause.get("source_basis"), "Not available")
    return {
        "clause_family": clause_family,
        "proposed_language": proposed_language,
        "rationale": rationale,
        "source_basis": source_basis,
        "confidence": "low",
    }


def _field_items_from_legal_metadata(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for item in metadata.get("clause_items") or []:
        if not isinstance(item, dict):
            continue
        fields.append(
            {
                "field": str(item.get("clause_family") or "Clause"),
                "value": str(item.get("current_position") or item.get("concern") or "Confirm against source material"),
                "confidence": "low",
                "source_basis": str(item.get("source_basis") or "Not available"),
            }
        )
    for item in metadata.get("obligation_items") or []:
        if not isinstance(item, dict):
            continue
        fields.append(
            {
                "field": "Obligation",
                "value": str(item.get("obligation") or "Confirm obligation from source material"),
                "confidence": "low",
                "source_basis": str(item.get("source_basis") or "Not available"),
            }
        )
    return fields


def _legal_next_actions(spec, *, capability: str) -> list[str]:
    by_workflow = {
        "legal_contract_risk_matrix": [
            "Confirm which high-severity items need approval before negotiation.",
            "Turn the top issues into comment-ready proposed edits.",
        ],
        "legal_nda_review": [
            "Confirm confidentiality term, exclusions, and residual knowledge language before approval.",
            "Draft comments for any red flags that exceed the selected risk tolerance.",
        ],
        "legal_msa_review": [
            "Confirm liability, indemnity, IP ownership, data protection, and termination positions.",
            "Escalate any approval exception before sending comments to the counterparty.",
        ],
        "legal_negotiation_brief": [
            "Confirm the must-have changes and acceptable fallback positions.",
            "Share only the comment-ready notes that match the negotiation posture.",
        ],
        "legal_obligation_tracker": [
            "Assign owners to obligations, notices, renewals, and deadline-driven follow-ups.",
            "Validate every deadline or trigger against the source agreement before operational use.",
        ],
    }
    if spec.workflow_id in by_workflow:
        return by_workflow[spec.workflow_id]
    by_capability = {
        "extract": [
            "Validate extracted clauses, obligations, and dates against the source material.",
            "Run a targeted review for any clause family with low confidence or missing source support.",
        ],
        "draft": [
            "Review proposed language against the preferred position and fallback posture.",
            "Refine the draft for the counterparty and negotiation tone before sharing.",
        ],
        "plan": [
            "Confirm negotiation priorities, owners, and escalation points before acting.",
            "Convert accepted fallback positions into comment-ready language.",
        ],
        "report": [
            "Confirm high-severity risk items and approval exceptions before sharing.",
            "Run a narrower follow-up for any clause family that needs deeper review.",
        ],
    }
    return by_capability.get(
        capability,
        [
            "Review the output against the source files before sharing.",
            "Refine the workflow if you need a narrower audience, format, or action list.",
        ],
    )


def _legal_fallback_payload(spec, run: WorkflowRun, sources: list[WorkflowSourceFile], *, focus: str, insights: list[str]) -> tuple[str, list[str], list[str], str, dict[str, Any]]:
    profile = _legal_profile_from_run(run)
    next_actions = _legal_next_actions(spec, capability=spec.capability)
    first = insights[0] if insights else "The selected material needs a closer legal review before it is finalized."
    second = insights[1] if len(insights) > 1 else "Confirm the clause positions, operational obligations, and approval path against the source material."
    third = insights[2] if len(insights) > 2 else "Review any missing or ambiguous terms before relying on the agreement operationally."
    severity = "high" if profile.get("risk_tolerance") == "conservative" else "medium"
    requested_families = _requested_clause_families(
        run,
        default=[
            "limitation_of_liability",
            "indemnity",
            "termination",
            "data_protection",
            "ip_ownership",
            "payment",
            "audit",
            "assignment",
        ] if spec.workflow_id in {"legal_contract_review", "legal_contract_risk_matrix", "legal_msa_review"} else [],
    )
    family_limit = 10 if spec.workflow_id == "legal_contract_risk_matrix" else 6
    matched_families = _source_matched_families(sources, requested_families, limit=family_limit)
    risk_items = [
        _risk_item_for_family(
            family,
            sources,
            requested=family in requested_families,
            severity=(
                "critical" if spec.workflow_id == "legal_contract_risk_matrix" and family in {"limitation_of_liability", "data_protection", "exclusivity"}
                else severity
            ),
        )
        for family in matched_families
    ]
    if not risk_items:
        first = insights[0] if insights else "The selected material needs a closer legal review before it is finalized."
        risk_items = [
            {
                "issue": first,
                "severity": severity,
                "clause_family": "general_contract",
                "business_impact": "Needs review before approval or external use.",
                "source_basis": first,
                "recommended_change": "Confirm the source language and revise the clause if it creates avoidable business exposure.",
                "fallback_position": "Use the default house position unless the business accepts the exception.",
                "requires_human_review": True,
            }
        ]
    clause_items = [
        {
            "clause_family": item["clause_family"],
            "current_position": item["source_basis"],
            "source_basis": item["source_basis"],
            "concern": item["issue"],
            "recommended_position": item["recommended_change"],
        }
        for item in risk_items[:6]
    ]
    obligation_items = [
        {
            "obligation": item["issue"],
            "responsible_party": "TBD",
            "trigger_or_deadline": "Before approval or signature",
            "source_basis": item["source_basis"],
            "follow_up": item["recommended_change"],
        }
        for item in risk_items[:5]
    ]
    open_questions = [
        "Which issues require approval before the document can move forward?",
        "Are there standard fallback positions for the clause families flagged above?",
    ]
    approval_notes = [
        "Treat any uncapped liability, unclear IP ownership, broad indemnity, automatic renewal, or missing data protection term as approval-sensitive.",
        f"Apply a {_humanize_choice(str(profile.get('risk_tolerance'))).lower()} review posture for unresolved items.",
    ]
    if spec.workflow_id == "legal_obligation_tracker":
        bullets = [item["obligation"] for item in obligation_items] + insights[:3]
    elif spec.workflow_id == "legal_negotiation_brief":
        bullets = ["Separate must-have changes from acceptable fallback positions.", *insights[:4]]
    else:
        bullets = [item["issue"] for item in risk_items] + insights[:4]
    summary = f"Prepared {spec.title.lower()} focused on {focus}."
    preview = textwrap.dedent(
        f"""
        # {run.title}

        {summary}

        ## Review profile
        - Document type: {profile.get('document_type_label')}
        - Review mode: {profile.get('review_mode_label')}
        - Counterparty: {profile.get('counterparty_position_label')}
        - Risk tolerance: {profile.get('risk_tolerance_label')}

        ## Risk matrix
        | Issue | Severity | Business impact | Recommended change |
        | --- | --- | --- | --- |
        {chr(10).join(f"| {item['issue']} | {item['severity']} | {item['business_impact']} | {item['recommended_change']} |" for item in risk_items)}

        ## Clause notes
        {chr(10).join(f"- **{item['clause_family']}**: {item['concern']} Recommended position: {item['recommended_position']}" for item in clause_items)}

        ## Obligations and follow-ups
        {chr(10).join(f"- {item['obligation']} Follow-up: {item['follow_up']}" for item in obligation_items)}

        ## Open questions
        {chr(10).join(f"- {item}" for item in open_questions)}

        ## Approval notes
        {chr(10).join(f"- {item}" for item in approval_notes)}

        ## Recommended next steps
        {chr(10).join(f"- {item}" for item in next_actions)}
        """
    ).strip()
    metadata: dict[str, Any] = {
        "tier": "pro",
        "pack_id": spec.pack_id,
        "pack_label": spec.pack_label,
        "focus": focus,
        "legal_profile": profile,
        "risk_items": risk_items,
        "clause_items": clause_items,
        "obligation_items": obligation_items,
        "open_questions": open_questions,
        "approval_notes": approval_notes,
        "workflow_profile": {
            "tier": "pro",
            "pack_id": spec.pack_id,
            "pack_label": spec.pack_label,
            "workflow_id": spec.workflow_id,
            "title": spec.title,
        },
    }
    if spec.capability == "extract":
        metadata["fields"] = [
            {"field": "Clause or obligation", "value": item, "confidence": "low", "source_basis": item}
            for item in insights[:5]
        ]
    elif spec.capability == "plan":
        metadata["plan_items"] = [
            {"action": action, "priority": "medium", "owner": "TBD", "timeline": "TBD", "related_clause_family": "general_contract"}
            for action in next_actions
        ]
    elif spec.capability == "draft":
        metadata["draft_type"] = spec.title
        metadata["fallback_items"] = [
            {
                "clause_family": "general_contract",
                "proposed_language": "Revise the clause to align with the selected fallback position.",
                "rationale": "The source material indicates approval-sensitive language that should be narrowed or clarified.",
                "source_basis": first,
                "confidence": "low",
            }
        ]
    return summary, bullets[:5], next_actions, preview, metadata


def _ensure_legal_metadata(metadata: dict[str, Any], run: WorkflowRun, spec, sources: list[WorkflowSourceFile]) -> dict[str, Any]:
    profile = metadata.get("legal_profile") if isinstance(metadata.get("legal_profile"), dict) else {}
    merged_profile = _legal_profile_from_run(run)
    # Preserve canonical enum-style profile values from the run inputs. Model
    # output can add extra profile context, but it should not replace values like
    # document_type="msa_services" with display labels like "Msa services".
    merged_profile.update(
        {
            key: value
            for key, value in profile.items()
            if key not in merged_profile and value not in (None, "")
        }
    )
    metadata["legal_profile"] = merged_profile
    metadata = supplement_metadata_from_fact_maps(metadata, sources)

    metadata["risk_items"] = _normalize_legal_risk_items(metadata.get("risk_items"))
    metadata["clause_items"] = _normalize_legal_clause_items(metadata.get("clause_items"))
    metadata["obligation_items"] = _normalize_legal_obligation_items(metadata.get("obligation_items"))
    metadata["open_questions"] = _string_list(metadata.get("open_questions"))
    metadata["approval_notes"] = _string_list(metadata.get("approval_notes"))

    if not metadata["risk_items"]:
        metadata["risk_items"] = [
            {
                "issue": "Manual legal review needed before relying on the output.",
                "severity": "medium",
                "clause_family": "general_contract",
                "business_impact": "The output did not include a specific risk item, so approval risk cannot be treated as cleared.",
                "source_basis": "Not available",
                "recommended_change": "Run a narrower follow-up review for the relevant clause family or review the source language manually.",
                "fallback_position": "Use the default house position where applicable.",
                "requires_human_review": True,
            }
        ]
    if not metadata["open_questions"]:
        metadata["open_questions"] = ["What source language should be reviewed before final approval?"]
    if not metadata["approval_notes"]:
        metadata["approval_notes"] = ["Review high-impact risks, missing protections, and unresolved questions before approval."]

    if spec.workflow_id == "legal_clause_extraction":
        metadata["fields"] = _normalize_legal_fields(metadata.get("fields"))
        if not metadata["clause_items"]:
            metadata["clause_items"] = [
                {
                    "clause_family": "general_contract",
                    "current_position": "No clause item was extracted from the model output.",
                    "source_basis": "Not available",
                    "concern": "The clause extraction output needs source-level confirmation before export or reuse.",
                    "recommended_position": "Run a narrower extraction focused on the clause families needed.",
                }
            ]
        if not metadata["fields"]:
            metadata["fields"] = _field_items_from_legal_metadata(metadata)

    if spec.workflow_id == "legal_obligation_tracker":
        if not metadata["obligation_items"]:
            first_risk = metadata["risk_items"][0] if metadata.get("risk_items") else {}
            metadata["obligation_items"] = [
                {
                    "obligation": "Confirm operational obligations from the source material.",
                    "responsible_party": "TBD",
                    "trigger_or_deadline": "TBD",
                    "source_basis": str(first_risk.get("source_basis") or "Not available"),
                    "follow_up": "Run a narrower obligation extraction or manually validate duties, notices, renewals, and deadlines.",
                }
            ]
        metadata["fields"] = _normalize_legal_fields(metadata.get("fields"))
        if not metadata["fields"]:
            metadata["fields"] = _field_items_from_legal_metadata(metadata)

    if spec.workflow_id == "legal_fallback_language":
        metadata["fallback_items"] = _normalize_legal_fallback_items(metadata.get("fallback_items"))
        requested_fallback_items = _legal_requested_fallback_items(metadata, run, sources)
        if requested_fallback_items:
            metadata["fallback_items"] = requested_fallback_items
        if not metadata["fallback_items"]:
            metadata["fallback_items"] = [_fallback_item_from_metadata(metadata)]
        metadata["draft_type"] = _metadata_text(metadata.get("draft_type"), spec.title)

    if spec.workflow_id == "legal_negotiation_brief":
        metadata["plan_items"] = _normalize_legal_plan_items(metadata.get("plan_items"))
        if not metadata["plan_items"]:
            metadata["plan_items"] = [
                {
                    "action": action,
                    "priority": "medium",
                    "owner": "TBD",
                    "timeline": "TBD",
                    "related_clause_family": "general_contract",
                }
                for action in _legal_next_actions(spec, capability=spec.capability)
            ]

    return metadata


def domain_workflow_handler(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    spec = get_domain_workflow_spec(run.workflow_id)
    if spec is None:
        raise ValueError("Unknown Pro workflow")
    focus = _focus_text(run, spec.default_focus)
    is_legal = spec.pack_id == "legal"
    legal_profile = _legal_profile_from_run(run) if is_legal else None

    def fallback() -> WorkflowResult:
        insights = _first_insight_lines(sources, limit=6)
        if not insights:
            insights = ["There was not enough readable source text to produce a detailed output."]
        if is_legal:
            summary, bullets, next_actions, preview, metadata = _legal_fallback_payload(spec, run, sources, focus=focus, insights=insights)
            return _result(
                run,
                summary=summary,
                bullets=bullets,
                next_actions=next_actions,
                sources=sources,
                preview_markdown=preview,
                metadata=metadata,
            )
        actions_by_capability = {
            "extract": [
                "Validate extracted details against the source files before using them operationally.",
                "Run a follow-up review if any field is low confidence or unsupported.",
            ],
            "draft": [
                "Review the draft for tone, audience, and source-sensitive details before sharing.",
                "Use Edit with AI to refine any section that needs a narrower audience or stronger wording.",
            ],
            "plan": [
                "Confirm owners and timelines before treating the plan as final.",
                "Assign follow-up work for any item that still depends on missing source context.",
            ],
            "report": [
                "Review the flagged issues and confirm any high-impact recommendation before sharing.",
                "Run a targeted follow-up if you need a narrower brief for a specific stakeholder.",
            ],
        }
        next_actions = actions_by_capability.get(
            spec.capability,
            [
                "Review the output against the source files before sharing.",
                "Refine the workflow if you need a narrower audience, format, or action list.",
            ],
        )
        summary = f"Prepared {spec.title.lower()} output focused on {focus}."
        preview = textwrap.dedent(
            f"""
            # {run.title}

            {summary}

            ## Focus
            {focus}

            ## Findings
            {chr(10).join(f"- {item}" for item in insights[:5])}

            ## Recommended next steps
            {chr(10).join(f"- {item}" for item in next_actions)}
            """
        ).strip()
        metadata: dict[str, Any] = {
            "tier": "pro",
            "pack_id": spec.pack_id,
            "pack_label": spec.pack_label,
            "focus": focus,
            "workflow_profile": {
                "tier": "pro",
                "pack_id": spec.pack_id,
                "pack_label": spec.pack_label,
                "workflow_id": spec.workflow_id,
                "title": spec.title,
            },
        }
        if spec.capability == "extract":
            metadata["fields"] = [
                {"field": "Extracted detail", "value": item, "confidence": "low"}
                for item in insights[:5]
            ]
        elif spec.capability == "plan":
            metadata["plan_items"] = [
                {"action": action, "priority": "medium", "owner": "TBD", "timeline": "TBD"}
                for action in next_actions
            ]
        elif spec.capability == "report":
            metadata["risk_items"] = [
                {"issue": item, "severity": "review", "source_basis": item, "recommendation": "Review and confirm."}
                for item in insights[:3]
            ]
        elif spec.capability == "draft":
            metadata["draft_type"] = spec.title
        return _result(
            run,
            summary=summary,
            bullets=insights[:5],
            next_actions=next_actions,
            sources=sources,
            preview_markdown=preview,
            metadata=metadata,
        )

    legal_context = _legal_context_for_prompt(legal_profile) if legal_profile else ""
    legal_coverage = build_legal_coverage_metadata(sources) if is_legal else {}
    legal_coverage_instruction = (
        " Full stored-chunk clause-map coverage is available; use it to avoid false missing-clause findings. "
        "When the clause map marks a clause family as found, discuss it or leave it out only if irrelevant; do not call it missing. "
        "Only call a protection missing when the clause map status supports not_found_after_full_chunk_scan; use \"not found in reviewed material\" for excerpt-only coverage. "
        if is_legal and legal_coverage.get("coverage_status") in {"full_chunk_scan", "full_contract_fact_map"}
        else ""
    )
    result = _llm_result(
        run,
        sources,
        task_brief=(
            f"{spec.task_brief} Focus the output on {focus}. "
            f"{legal_context + ' ' if legal_context else ''}"
            "Use practical business language and stay grounded in the selected source excerpts."
            f"{legal_coverage_instruction}"
        ),
        output_requirements=(
            f"{spec.output_requirements} Keep the output usable as a finished workflow artifact. "
            "Avoid legal, HR, accounting, compliance, or procurement disclaimers unless the user explicitly asks for them. "
            "Do not include a Sources used section; the application adds it separately. "
            "Include metadata.workflow_profile with tier, pack_id, pack_label, workflow_id, and title."
        ),
        fallback_factory=fallback,
    )
    metadata = dict(result.metadata or {})
    metadata["tier"] = "pro"
    metadata["pack_id"] = spec.pack_id
    metadata["pack_label"] = spec.pack_label
    metadata["focus"] = str(metadata.get("focus") or focus).strip() or focus
    profile = metadata.get("workflow_profile") if isinstance(metadata.get("workflow_profile"), dict) else {}
    metadata["workflow_profile"] = {
        "tier": "pro",
        "pack_id": spec.pack_id,
        "pack_label": spec.pack_label,
        "workflow_id": spec.workflow_id,
        "title": spec.title,
        **{key: value for key, value in profile.items() if key not in {"tier", "pack_id", "pack_label", "workflow_id", "title"}},
    }
    if is_legal:
        metadata = _ensure_legal_metadata(metadata, run, spec, sources)
        _ensure_legal_preview_sections(result, run, spec, metadata)
        factual_issues = verify_output_against_fact_maps(metadata, result.preview_markdown, sources)
        if factual_issues:
            metadata["factual_warnings"] = factual_issues
            metadata.setdefault("warnings", [])
            if isinstance(metadata["warnings"], list):
                metadata["warnings"].append("Output was checked against the full stored-chunk clause map; review factual_warnings before relying on missing-clause statements.")
    result.metadata = metadata
    return result



def _context_excerpt(value: str, *, tail: bool = False, limit: int = 5000) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    return ("...[earlier content omitted]\n" + text[-limit:]) if tail else (text[:limit] + "\n...[later content omitted]")


def edit_workflow_section(
    run: WorkflowRun,
    *,
    content_before: str,
    selected_content: str,
    content_after: str,
    instruction: str,
) -> tuple[str, dict[str, Any]]:
    prompt = str(instruction or "").strip()
    selected = str(selected_content or "").strip()
    if not prompt:
        raise ValueError("An edit prompt is required")
    if not selected:
        raise ValueError("Select text before using AI edit")
    if OpenAIChat is None:
        raise RuntimeError("Workflow AI editing is not available because the chat model is not configured")

    full_artifact_markdown = (
        f"{str(content_before or '')}"
        "\n\n<!-- SELECTED_SECTION_START -->\n"
        f"{str(selected_content or '')}"
        "\n<!-- SELECTED_SECTION_END -->\n\n"
        f"{str(content_after or '')}"
    ).strip()

    model = OpenAIChat()
    system = textwrap.dedent(
        """
        Edit one selected section from an existing workflow artifact.
        Return valid JSON only with exactly these keys: edited_markdown, summary, bullets, next_actions, metadata.
        - edited_markdown must contain only the replacement markdown for the selected section between SELECTED_SECTION_START and SELECTED_SECTION_END.
        - Do not return the full artifact.
        - Read the full artifact for context before editing, but only change the selected section.
        - Follow the user's edit request while preserving accurate facts, tone, continuity, and markdown structure unless the request asks to change them.
        - Do not add a Sources used section.
        - Do not mention the selection markers in the edited markdown.
        """
    ).strip()
    user = textwrap.dedent(
        f"""
        Workflow: {run.title} ({run.workflow_id})

        User edit request:
        {prompt}

        Full artifact markdown with the selected section marked:
        {full_artifact_markdown}
        """
    ).strip()

    response = model.generate_with_usage(system=system, user=user)
    payload = _extract_json_payload(response.text)
    edited_markdown = str(payload.get("edited_markdown") or "").strip()
    if not edited_markdown:
        raise ValueError("The AI edit did not return replacement text")

    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata["ai_section_edit"] = {
        "prompt": prompt,
        "selected_chars": len(str(selected_content or "")),
        "replacement_chars": len(edited_markdown),
        "full_context_chars": len(full_artifact_markdown),
    }
    metadata["llm_usage"] = {
        "prompt_tokens": int(response.usage.prompt_tokens or 0),
        "completion_tokens": int(response.usage.completion_tokens or 0),
        "total_tokens": int(response.usage.total_tokens or 0),
        "operation": str(response.operation or "responses.create"),
        "approximate": bool(response.usage.approximate),
    }
    metadata["summary"] = str(payload.get("summary") or "").strip()
    metadata["bullets"] = _coerce_list(payload.get("bullets"))
    metadata["next_actions"] = _coerce_list(payload.get("next_actions"))
    return edited_markdown, metadata
def refine_workflow_result(
    run: WorkflowRun,
    sources: list[WorkflowSourceFile],
    *,
    existing_markdown: str,
    instruction: str,
) -> WorkflowResult:
    prompt = str(instruction or "").strip()
    current = str(existing_markdown or "").strip()
    if not prompt:
        raise ValueError("A refinement prompt is required")
    if not current:
        raise ValueError("This workflow output does not have document content to refine")
    if OpenAIChat is None:
        raise RuntimeError("Workflow refinement is not available because the chat model is not configured")

    model = OpenAIChat()
    source_blocks = []
    for idx, source in enumerate(sources, start=1):
        source_blocks.append(
            textwrap.dedent(
                f"""
                [{idx}] {_source_label(source)}
                Folder: {source.folder_path or 'Root'}
                Content type: {source.content_type or 'unknown'}
                Source kind: {source.source_kind}
                Excerpt:
                {source.excerpt}
                """
            ).strip()
        )

    source_instruction = (
        "There is one underlying source file. Do not mention the file name or use inline source labels in customer-facing text."
        if _is_single_source_output(sources)
        else "Mention source names only when they help verify a multi-file claim."
    )
    system = textwrap.dedent(
        f"""
        Revise an existing workflow artifact for a document workspace.
        Use the current artifact, the user revision request, and the provided source excerpts.
        Preserve accurate source grounding. Do not invent facts.
        {source_instruction}
        Return valid JSON only with exactly these keys:
        summary, bullets, next_actions, preview_markdown, metadata.
        - preview_markdown must be the full revised markdown artifact.
        - Do not add a Sources used section; the application adds it separately.
        - Do not describe the revision process unless the user explicitly asks for that in the artifact.
        """
    ).strip()
    user = textwrap.dedent(
        f"""
        Workflow: {run.title} ({run.workflow_id})
        User revision request:
        {prompt}

        Current artifact markdown:
        {current}

        Source excerpts:
        {chr(10).join(source_blocks)}
        """
    ).strip()

    response = model.generate_with_usage(system=system, user=user)
    payload = _extract_json_payload(response.text)
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata["refinement"] = {"prompt": prompt}
    metadata["llm_usage"] = {
        "prompt_tokens": int(response.usage.prompt_tokens or 0),
        "completion_tokens": int(response.usage.completion_tokens or 0),
        "total_tokens": int(response.usage.total_tokens or 0),
        "operation": str(response.operation or "responses.create"),
        "approximate": bool(response.usage.approximate),
    }
    return _result(
        run,
        str(payload.get("summary") or "").strip(),
        _coerce_list(payload.get("bullets")),
        _coerce_list(payload.get("next_actions")),
        sources=sources,
        preview_markdown=str(payload.get("preview_markdown") or "").strip(),
        metadata=metadata,
    )


CORE_WORKFLOW_MANIFESTS: list[WorkflowManifest] = [
    WorkflowManifest(
        workflow_id="summarize_documents",
        title="Summarize",
        description="Create a clear brief from selected files or folders, with key takeaways, risks, and follow-up questions.",
        capability="summarize",
        tier="core",
        workflow_order=10,
        launcher={
            "prompt_label": "Summary focus",
            "prompt_placeholder": "Key risks, important decisions, open questions, next steps…",
            "submit_label": "Generate summary",
            "suggested_prompts": ["Key takeaways", "Risks and open questions", "Decisions and next steps"],
            "fields": [],
        },
        tags=["briefing", "multi-file", "cited", "core"],
    ),
    WorkflowManifest(
        workflow_id="compare_documents",
        title="Compare",
        description="Surface the most important differences between two files, including missing content and likely impact.",
        capability="compare",
        tier="core",
        workflow_order=20,
        selection={"min_total_items": 2, "max_total_items": 2, "exact_file_count": 2, "allow_folders": False},
        launcher={
            "prompt_label": "Comparison focus",
            "prompt_placeholder": "Key changes, missing content, risk differences…",
            "submit_label": "Compare files",
            "suggested_prompts": ["Changes only", "Important differences", "Missing content"],
        },
        tags=["review", "side-by-side", "core"],
    ),
    WorkflowManifest(
        workflow_id="extract_information",
        title="Extract Info",
        description="Pull structured details from the selected material so they can be reused faster.",
        capability="extract",
        tier="core",
        workflow_order=30,
        launcher={
            "prompt_label": "Fields to extract",
            "prompt_placeholder": "Dates, names, totals, obligations, deadlines…",
            "submit_label": "Extract",
            "suggested_prompts": ["Key dates and deadlines", "Contacts and companies", "Totals and obligations"],
        },
        tags=["structured output", "fields", "core"],
    ),
    WorkflowManifest(
        workflow_id="draft_from_sources",
        title="Draft",
        description="Generate a first-pass email, memo, SOP, or write-up grounded in the selected files.",
        capability="draft",
        tier="core",
        workflow_order=40,
        launcher={
            "prompt_label": "What are you drafting?",
            "prompt_placeholder": "Email, memo, SOP, proposal intro…",
            "submit_label": "Create draft",
            "suggested_prompts": ["Internal memo", "Customer email", "SOP draft"],
        },
        tags=["first draft", "source-grounded", "core"],
    ),
    WorkflowManifest(
        workflow_id="generate_report",
        title="Generate Report",
        description="Turn selected material into a shareable report or stakeholder-ready brief.",
        capability="report",
        tier="core",
        workflow_order=50,
        launcher={
            "prompt_label": "Report audience",
            "prompt_placeholder": "Leadership update, internal brief, customer summary…",
            "submit_label": "Generate report",
            "suggested_prompts": ["Leadership brief", "Internal status report", "Customer-ready summary"],
        },
        tags=["shareable", "stakeholder-ready", "core"],
    ),
    WorkflowManifest(
        workflow_id="create_action_plan",
        title="Action Plan",
        description="Convert the selected material into prioritized next steps, owners, and timelines.",
        capability="plan",
        tier="core",
        workflow_order=60,
        launcher={
            "prompt_label": "Planning goal",
            "prompt_placeholder": "What outcome should the action plan optimize for?",
            "submit_label": "Build plan",
            "suggested_prompts": ["Immediate next steps", "Owner-ready checklist", "Priority roadmap"],
        },
        tags=["priorities", "next steps", "core"],
    ),
]


def _domain_workflow_manifest(spec) -> WorkflowManifest:
    return WorkflowManifest(
        workflow_id=spec.workflow_id,
        title=spec.title,
        description=spec.description,
        capability=spec.capability,
        tier="pro",
        pack_id=spec.pack_id,
        pack_label=spec.pack_label,
        pack_order=spec.pack_order,
        workflow_order=spec.workflow_order,
        selection=spec.selection or {},
        launcher={
            "prompt_label": spec.prompt_label,
            "prompt_placeholder": spec.prompt_placeholder,
            "submit_label": spec.submit_label,
            "suggested_prompts": list(spec.suggested_prompts),
            "fields": list(spec.launcher_fields),
        },
        tags=list(dict.fromkeys([*spec.tags, "pro"])),
    )


DOMAIN_WORKFLOW_MANIFESTS: list[WorkflowManifest] = [
    _domain_workflow_manifest(spec) for spec in DOMAIN_WORKFLOW_SPECS
]


WORKFLOW_MANIFESTS: list[WorkflowManifest] = [
    *CORE_WORKFLOW_MANIFESTS,
    *DOMAIN_WORKFLOW_MANIFESTS,
]


WORKFLOW_HANDLERS: dict[str, WorkflowHandler] = {
    "summarize_documents": summarize_handler,
    "compare_documents": compare_handler,
    "extract_information": extract_handler,
    "draft_from_sources": draft_handler,
    "generate_report": report_handler,
    "create_action_plan": plan_handler,
    **{spec.workflow_id: domain_workflow_handler for spec in DOMAIN_WORKFLOW_SPECS},
}


WORKFLOW_INDEX = {manifest.workflow_id: manifest for manifest in WORKFLOW_MANIFESTS}
