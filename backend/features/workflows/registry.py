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

_SUMMARY_AUDIENCE_LABELS = {
    "leadership": "Leadership",
    "team": "Internal team",
    "client": "Client",
    "new_hire": "New hire",
}
_SUMMARY_DEPTH_LABELS = {
    "concise": "30-second brief",
    "standard": "3-minute brief",
    "detailed": "Deep dive",
}
_SUMMARY_DEPTH_DEFAULT_LAYER = {
    "concise": "snapshot",
    "standard": "standard",
    "detailed": "deep_dive",
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


def _source_manifest_lines(sources: list[WorkflowSourceFile]) -> list[str]:
    lines: list[str] = []
    for source in sources:
        suffix = f" ({source.folder_path})" if source.folder_path else ""
        trunc = " — excerpt truncated" if source.truncated else ""
        lines.append(f"- {_source_label(source)}{suffix}{trunc}")
    return lines


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
    if sources:
        lines.append("## Sources used")
        lines.extend(_source_manifest_lines(sources))
    return "\n".join(line for line in lines if line is not None).strip()


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
    cleaned_summary = (summary or "").strip() or f"Generated output for {run.title}."
    cleaned_bullets = [str(item).strip() for item in bullets if str(item).strip()]
    cleaned_actions = [str(item).strip() for item in next_actions if str(item).strip()]
    preview = (preview_markdown or "").strip() or _render_preview(
        cleaned_summary,
        cleaned_bullets,
        cleaned_actions,
        heading=run.title,
        sources=sources,
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


def _summary_profile(run: WorkflowRun) -> tuple[str, str, str]:
    audience = _input_text(run, "audience", "leadership")
    depth = _input_text(run, "depth", "standard")
    focus = _focus_text(run, "an executive-friendly summary")
    return audience, depth, focus


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
        {"key": "snapshot", "label": _SUMMARY_DEPTH_LABELS["concise"], "text": snapshot or "No summary available yet."},
        {
            "key": "standard",
            "label": _SUMMARY_DEPTH_LABELS["standard"],
            "text": "\n".join(part for part in standard_parts if part).strip() or snapshot or "No standard brief available yet.",
        },
        {"key": "deep_dive", "label": _SUMMARY_DEPTH_LABELS["detailed"], "text": deep_text},
    ]


def _normalize_summary_layers(value: Any, *, fallback: list[dict[str, str]]) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            label = str(item.get("label") or "").strip()
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


def _summary_actions(focus: str, audience: str) -> list[dict[str, str]]:
    audience_label = _SUMMARY_AUDIENCE_LABELS.get(audience, audience.replace("_", " ").title())
    return [
        {
            "kind": "workflow",
            "label": "Generate report",
            "workflow_id": "generate_report",
            "focus": f"{audience_label} brief grounded in this summary. Keep the emphasis on {focus}.",
            "description": "Turn this summary into a more presentation-ready deliverable.",
        },
        {
            "kind": "workflow",
            "label": "Create action plan",
            "workflow_id": "create_action_plan",
            "focus": f"Owner-ready follow-up plan based on this summary, with priorities and timelines for {focus}.",
            "description": "Convert the summary into concrete next steps.",
        },
        {
            "kind": "workflow",
            "label": "Draft memo",
            "workflow_id": "draft_from_sources",
            "focus": f"Write an internal memo for {audience_label.lower()} that captures the summary and its implications for {focus}.",
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
    audience: str,
) -> str:
    lines = [f"# {run.title}", ""]
    lines.append(f"Audience: {_SUMMARY_AUDIENCE_LABELS.get(audience, audience.replace('_', ' ').title())}")
    lines.append("")
    for layer in layers:
        lines.append(f"## {layer.get('label') or layer.get('key', 'Summary').replace('_', ' ').title()}")
        lines.append(str(layer.get("text") or "").strip())
        lines.append("")
    if bullets:
        lines.append("## Evidence-backed highlights")
        lines.extend(f"- {item}" for item in bullets)
        lines.append("")
    if evidence_highlights:
        lines.append("## Supporting evidence")
        for item in evidence_highlights:
            claim = str(item.get("claim") or "").strip()
            sources_line = ", ".join(str(source).strip() for source in item.get("sources") or [] if str(source).strip())
            if claim:
                lines.append(f"- {claim}{f' [{sources_line}]' if sources_line else ''}")
            for evidence in item.get("evidence") or []:
                if not isinstance(evidence, dict):
                    continue
                excerpt = str(evidence.get("excerpt") or "").strip()
                if not excerpt:
                    continue
                source_name = str(evidence.get("source_name") or "Source").strip()
                lines.append(f"  - {source_name}: {excerpt}")
        lines.append("")
    if next_actions:
        lines.append("## Suggested next steps")
        lines.extend(f"- {item}" for item in next_actions)
        lines.append("")
    if sources:
        lines.append("## Sources used")
        lines.extend(_source_manifest_lines(sources))
    return "\n".join(line for line in lines if line is not None).strip()


def _normalize_summary_result(run: WorkflowRun, result: WorkflowResult, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    audience, depth, focus = _summary_profile(run)
    metadata = dict(result.metadata or {})
    profile = metadata.get("summary_profile") if isinstance(metadata.get("summary_profile"), dict) else {}
    profile = {
        "audience": str(profile.get("audience") or audience).strip() or audience,
        "depth": str(profile.get("depth") or depth).strip() or depth,
        "focus": str(profile.get("focus") or focus).strip() or focus,
        "default_layer": str(profile.get("default_layer") or _SUMMARY_DEPTH_DEFAULT_LAYER.get(depth, "standard")).strip() or "standard",
    }
    metadata["summary_profile"] = profile
    metadata["audience"] = profile["audience"]
    metadata["depth"] = profile["depth"]
    metadata["focus"] = profile["focus"]

    layers = _normalize_summary_layers(
        metadata.get("summary_layers"),
        fallback=_summary_layers_from_result(result, sources),
    )
    metadata["summary_layers"] = layers

    evidence_highlights = _normalize_evidence_highlights(
        metadata.get("evidence_highlights"),
        fallback=_summary_evidence_from_sources(sources),
    )
    metadata["evidence_highlights"] = evidence_highlights

    if evidence_highlights:
        result.bullets = [
            f"{item['claim']} ({', '.join(item['sources'])})" if item.get("sources") else str(item["claim"])
            for item in evidence_highlights[:4]
            if str(item.get("claim") or "").strip()
        ] or result.bullets

    suggested_actions = metadata.get("suggested_actions")
    if not isinstance(suggested_actions, list) or not suggested_actions:
        suggested_actions = _summary_actions(profile["focus"], profile["audience"])
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
        audience=profile["audience"],
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
        return fallback_factory()

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

        system = textwrap.dedent(
            """
            You create workflow outputs for a document workspace.
            Use only the provided source excerpts.
            Do not invent source facts.
            Return valid JSON only.
            The JSON must have exactly these top-level keys:
            summary, bullets, next_actions, preview_markdown, metadata.
            - summary: short paragraph
            - bullets: array of concise strings
            - next_actions: array of concise strings
            - preview_markdown: markdown suited for a result card
            - metadata: object with only workflow-relevant structured data
            """
        ).strip()

        source_excerpt_text = "\n\n".join(source_blocks)
        user = textwrap.dedent(
            f"""
            Workflow: {run.title} ({run.workflow_id})
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
        log.exception("workflow_llm_failed", workflow_id=run.workflow_id)
        return fallback_factory()


def summarize_handler(run: WorkflowRun, sources: list[WorkflowSourceFile]) -> WorkflowResult:
    audience, depth, focus = _summary_profile(run)
    audience_label = _SUMMARY_AUDIENCE_LABELS.get(audience, audience.replace("_", " ").title())
    depth_label = _SUMMARY_DEPTH_LABELS.get(depth, depth.replace("_", " ").title())

    def fallback() -> WorkflowResult:
        evidence_highlights = _summary_evidence_from_sources(sources)
        bullets = [
            f"{item['claim']} ({', '.join(item['sources'])})" if item.get("sources") else str(item["claim"])
            for item in evidence_highlights[:4]
        ] or [f"Used {_source_label(source)} as source material." for source in sources[:3]]
        next_actions = [item["label"] for item in _summary_actions(focus, audience)]
        result = _result(
            run,
            summary=f"Generated a {depth_label.lower()} for {audience_label.lower()} across {len(sources)} selected file(s), focused on {focus}.",
            bullets=bullets,
            next_actions=next_actions,
            sources=sources,
            metadata={
                "focus": focus,
                "audience": audience,
                "depth": depth,
                "summary_layers": _summary_layers_from_result(
                    WorkflowResult(summary=f"Generated a {depth_label.lower()} for {audience_label.lower()} across {len(sources)} selected file(s), focused on {focus}.", bullets=bullets, next_actions=next_actions),
                    sources,
                ),
                "evidence_highlights": evidence_highlights,
                "suggested_actions": _summary_actions(focus, audience),
            },
        )
        return _normalize_summary_result(run, result, sources)

    result = _llm_result(
        run,
        sources,
        task_brief=(
            f"Create a grounded summary for {audience_label.lower()} that emphasizes {focus}. "
            f"The requested default depth is {depth_label.lower()}."
        ),
        output_requirements=(
            "Include 3-5 bullets that each state a concrete claim and mention the supporting source name in parentheses. "
            "Include 2-4 next actions. In metadata, include: "
            "summary_profile with audience, depth, focus, and default_layer; "
            "summary_layers as an array with snapshot, standard, and deep_dive items (each with key, label, text); "
            "evidence_highlights as an array of objects with claim, importance, sources, and evidence where evidence is an array of {source_name, excerpt}; "
            "and suggested_actions as workflow actions with label, workflow_id, focus, and description. "
            "The markdown should include separate sections for the quick brief, the fuller brief, supporting evidence, next steps, and sources used."
        ),
        fallback_factory=fallback,
    )
    return _normalize_summary_result(run, result, sources)


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
            summary=f"Extracted structured details from {len(sources)} selected file(s).",
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
            summary=f"Prepared a first draft using {len(sources)} selected file(s).",
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
            summary=f"Prepared a reusable report structure from {len(sources)} selected file(s).",
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
            summary=f"Built an action-oriented outline from {len(sources)} selected file(s).",
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


WORKFLOW_MANIFESTS: list[WorkflowManifest] = [
    WorkflowManifest(
        workflow_id="summarize_documents",
        title="Summarize",
        description="Create a clear brief from selected files or folders, with key takeaways, risks, and follow-up questions.",
        capability="summarize",
        launcher={
            "prompt_label": "Summary goal",
            "prompt_placeholder": "Executive summary, detailed notes, customer-ready recap…",
            "submit_label": "Generate summary",
            "suggested_prompts": ["Executive summary", "Risks and open questions", "Customer-ready recap"],
            "fields": [
                {
                    "key": "audience",
                    "label": "Audience",
                    "default_value": "leadership",
                    "options": [
                        {"value": "leadership", "label": "Leadership"},
                        {"value": "team", "label": "Internal team"},
                        {"value": "client", "label": "Client"},
                        {"value": "new_hire", "label": "New hire"},
                    ],
                },
                {
                    "key": "depth",
                    "label": "Depth",
                    "default_value": "standard",
                    "options": [
                        {"value": "concise", "label": "30-second brief"},
                        {"value": "standard", "label": "3-minute brief"},
                        {"value": "detailed", "label": "Deep dive"},
                    ],
                },
            ],
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
