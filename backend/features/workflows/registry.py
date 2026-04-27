from __future__ import annotations

import json
import logging
import re
import textwrap
from collections import Counter
from typing import Any, Callable

from .models import WorkflowManifest, WorkflowResult, WorkflowRun, WorkflowSourceFile

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
    except Exception:
        log.exception("workflow_llm_failed", extra={"workflow_id": run.workflow_id})
        return _ensure_result_title_metadata(fallback_factory(), run, sources)


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

    model = OpenAIChat()
    system = textwrap.dedent(
        """
        Edit one selected section from an existing workflow artifact.
        Return valid JSON only with exactly these keys: edited_markdown, summary, bullets, next_actions, metadata.
        - edited_markdown must contain only the replacement markdown for the selected section.
        - Do not return the full artifact.
        - Follow the user's edit request while preserving the meaning, tone, and markdown structure unless the request asks to change them.
        - Use the surrounding context only to keep continuity. Do not change or refer to surrounding text.
        - Do not add a Sources used section.
        """
    ).strip()
    user = textwrap.dedent(
        f"""
        Workflow: {run.title} ({run.workflow_id})

        User edit request:
        {prompt}

        Context before the selection:
        {_context_excerpt(content_before, tail=True)}

        Selected markdown to edit:
        {selected_content}

        Context after the selection:
        {_context_excerpt(content_after)}
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


WORKFLOW_MANIFESTS: list[WorkflowManifest] = [
    WorkflowManifest(
        workflow_id="summarize_documents",
        title="Summarize",
        description="Create a clear brief from selected files or folders, with key takeaways, risks, and follow-up questions.",
        capability="summarize",
        launcher={
            "prompt_label": "Summary focus",
            "prompt_placeholder": "Key risks, important decisions, open questions, next steps…",
            "submit_label": "Generate summary",
            "suggested_prompts": ["Key takeaways", "Risks and open questions", "Decisions and next steps"],
            "fields": [],
        },
        tags=["briefing", "multi-file", "cited"],
    ),
    WorkflowManifest(
        workflow_id="compare_documents",
        title="Compare",
        description="Surface the most important differences between two files, including missing content and likely impact.",
        capability="compare",
        selection={"min_total_items": 2, "max_total_items": 2, "exact_file_count": 2, "allow_folders": False},
        launcher={
            "prompt_label": "Comparison focus",
            "prompt_placeholder": "Key changes, missing content, risk differences…",
            "submit_label": "Compare files",
            "suggested_prompts": ["Changes only", "Important differences", "Missing content"],
        },
        tags=["review", "side-by-side"],
    ),
    WorkflowManifest(
        workflow_id="extract_information",
        title="Extract Info",
        description="Pull structured details from the selected material so they can be reused faster.",
        capability="extract",
        launcher={
            "prompt_label": "Fields to extract",
            "prompt_placeholder": "Dates, names, totals, obligations, deadlines…",
            "submit_label": "Extract",
            "suggested_prompts": ["Key dates and deadlines", "Contacts and companies", "Totals and obligations"],
        },
        tags=["structured output", "fields"],
    ),
    WorkflowManifest(
        workflow_id="draft_from_sources",
        title="Draft",
        description="Generate a first-pass email, memo, SOP, or write-up grounded in the selected files.",
        capability="draft",
        launcher={
            "prompt_label": "What are you drafting?",
            "prompt_placeholder": "Email, memo, SOP, proposal intro…",
            "submit_label": "Create draft",
            "suggested_prompts": ["Internal memo", "Customer email", "SOP draft"],
        },
        tags=["first draft", "source-grounded"],
    ),
    WorkflowManifest(
        workflow_id="generate_report",
        title="Generate Report",
        description="Turn selected material into a shareable report or stakeholder-ready brief.",
        capability="report",
        launcher={
            "prompt_label": "Report audience",
            "prompt_placeholder": "Leadership update, internal brief, customer summary…",
            "submit_label": "Generate report",
            "suggested_prompts": ["Leadership brief", "Internal status report", "Customer-ready summary"],
        },
        tags=["shareable", "stakeholder-ready"],
    ),
    WorkflowManifest(
        workflow_id="create_action_plan",
        title="Action Plan",
        description="Convert the selected material into prioritized next steps, owners, and timelines.",
        capability="plan",
        launcher={
            "prompt_label": "Planning goal",
            "prompt_placeholder": "What outcome should the action plan optimize for?",
            "submit_label": "Build plan",
            "suggested_prompts": ["Immediate next steps", "Owner-ready checklist", "Priority roadmap"],
        },
        tags=["priorities", "next steps"],
    ),
]


WORKFLOW_HANDLERS: dict[str, WorkflowHandler] = {
    "summarize_documents": summarize_handler,
    "compare_documents": compare_handler,
    "extract_information": extract_handler,
    "draft_from_sources": draft_handler,
    "generate_report": report_handler,
    "create_action_plan": plan_handler,
}


WORKFLOW_INDEX = {manifest.workflow_id: manifest for manifest in WORKFLOW_MANIFESTS}
