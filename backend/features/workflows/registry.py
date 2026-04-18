from __future__ import annotations

from typing import Callable

from .models import WorkflowManifest, WorkflowResult, WorkflowRun

WorkflowHandler = Callable[[WorkflowRun], WorkflowResult]



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



def _result(run: WorkflowRun, summary: str, bullets: list[str], next_actions: list[str]) -> WorkflowResult:
    preview_lines = [f"# {run.title}", "", summary, ""]
    if bullets:
        preview_lines.append("## What this run captured")
        preview_lines.extend(f"- {item}" for item in bullets)
        preview_lines.append("")
    if next_actions:
        preview_lines.append("## Suggested next steps")
        preview_lines.extend(f"- {item}" for item in next_actions)
    return WorkflowResult(
        summary=summary,
        bullets=bullets,
        next_actions=next_actions,
        preview_markdown="\n".join(preview_lines).strip(),
        metadata={
            "selection_total": run.selection.total_items,
            "has_focus": bool(str(run.inputs.get("focus") or "").strip()),
        },
    )



def summarize_handler(run: WorkflowRun) -> WorkflowResult:
    focus = _focus_text(run, "an executive-friendly summary")
    selection = _selection_phrase(run)
    return _result(
        run,
        summary=f"Summary scaffold prepared for {selection}, focused on {focus}.",
        bullets=[
            f"Uses {selection} as the initial source set.",
            "Returns a concise summary card shape that later workflow branches can enrich.",
            "Keeps the workflow contract stable while summarization logic evolves independently.",
        ],
        next_actions=[
            "Wire this handler into the real RAG summarization service.",
            "Add audience/style presets once the content pipeline lands.",
        ],
    )



def compare_handler(run: WorkflowRun) -> WorkflowResult:
    left, right = (run.selection.file_ids + ["", ""])[:2]
    focus = _focus_text(run, "important differences and missing content")
    return _result(
        run,
        summary="Comparison scaffold prepared for the selected pair of files.",
        bullets=[
            f"Primary compare pair: {left or 'first file'} vs {right or 'second file'}.",
            f"Focus area: {focus}.",
            "Result cards can later expand into side-by-side diffs without changing the API contract.",
        ],
        next_actions=[
            "Add file metadata and previews to the result card.",
            "Connect the compare handler to the document diff pipeline.",
        ],
    )



def extract_handler(run: WorkflowRun) -> WorkflowResult:
    focus = _focus_text(run, "key dates, names, totals, and obligations")
    selection = _selection_phrase(run)
    return _result(
        run,
        summary=f"Extraction scaffold prepared for {selection}.",
        bullets=[
            f"Requested extraction focus: {focus}.",
            "Output is shaped to support table views and downstream report generation.",
            "Selection payload is reusable by future domain packs.",
        ],
        next_actions=[
            "Add template-based extraction fields.",
            "Expose export-to-table once extraction payloads are real.",
        ],
    )



def draft_handler(run: WorkflowRun) -> WorkflowResult:
    focus = _focus_text(run, "a polished first draft grounded in the selected source material")
    selection = _selection_phrase(run)
    return _result(
        run,
        summary=f"Drafting scaffold prepared using {selection}.",
        bullets=[
            f"Draft intent: {focus}.",
            "Standardized run cards mean drafting can evolve without new UI plumbing.",
            "The same workflow endpoint can later support email, memo, and SOP draft modes.",
        ],
        next_actions=[
            "Add draft type presets to the launcher.",
            "Send the generated artifact into chat or a document editor once ready.",
        ],
    )



def report_handler(run: WorkflowRun) -> WorkflowResult:
    focus = _focus_text(run, "an executive brief with source-backed recommendations")
    selection = _selection_phrase(run)
    return _result(
        run,
        summary=f"Report scaffold prepared for {selection}.",
        bullets=[
            f"Audience goal: {focus}.",
            "Creates a reusable report result shape for future export flows.",
            "Keeps report generation inside the workflow system instead of bespoke page logic.",
        ],
        next_actions=[
            "Add export hooks for PDF and email handoff.",
            "Support template-specific sections once reporting logic is wired in.",
        ],
    )



def plan_handler(run: WorkflowRun) -> WorkflowResult:
    focus = _focus_text(run, "recommended next steps, owners, and priorities")
    selection = _selection_phrase(run)
    return _result(
        run,
        summary=f"Action-plan scaffold prepared from {selection}.",
        bullets=[
            f"Planning focus: {focus}.",
            "Result cards already support next-step actions, so this workflow shares the same contract.",
            "Keeps execution-oriented features on the same platform as search and chat.",
        ],
        next_actions=[
            "Add owner and timeline fields once workflow outputs become structured.",
            "Optionally create follow-up tasks from the finalized plan.",
        ],
    )


WORKFLOW_MANIFESTS: list[WorkflowManifest] = [
    WorkflowManifest(
        workflow_id="summarize_documents",
        title="Summarize",
        description="Turn selected files or folders into a concise brief with cited follow-ups.",
        capability="summarize",
        launcher={
            "prompt_label": "Summary goal",
            "prompt_placeholder": "Executive summary, detailed notes, customer-ready recap…",
            "submit_label": "Generate summary",
            "suggested_prompts": ["Executive summary", "Risks and open questions", "Customer-ready recap"],
        },
        tags=["starter", "files", "chat"],
    ),
    WorkflowManifest(
        workflow_id="compare_documents",
        title="Compare",
        description="Highlight major differences between two selected files.",
        capability="compare",
        selection={"min_total_items": 2, "max_total_items": 2, "exact_file_count": 2, "allow_folders": False},
        launcher={
            "prompt_label": "Comparison focus",
            "prompt_placeholder": "Key changes, missing content, risk differences…",
            "submit_label": "Compare files",
            "suggested_prompts": ["Changes only", "Important differences", "Missing content"],
        },
        tags=["starter", "files"],
    ),
    WorkflowManifest(
        workflow_id="extract_information",
        title="Extract Info",
        description="Pull structured facts from the selected material.",
        capability="extract",
        launcher={
            "prompt_label": "Fields to extract",
            "prompt_placeholder": "Dates, names, totals, obligations, deadlines…",
            "submit_label": "Extract",
            "suggested_prompts": ["Key dates and deadlines", "Contacts and companies", "Totals and obligations"],
        },
        tags=["starter", "files"],
    ),
    WorkflowManifest(
        workflow_id="draft_from_sources",
        title="Draft",
        description="Create a first draft grounded in the selected source material.",
        capability="draft",
        launcher={
            "prompt_label": "What are you drafting?",
            "prompt_placeholder": "Email, memo, SOP, proposal intro…",
            "submit_label": "Create draft",
            "suggested_prompts": ["Internal memo", "Customer email", "SOP draft"],
        },
        tags=["starter", "files", "chat"],
    ),
    WorkflowManifest(
        workflow_id="generate_report",
        title="Generate Report",
        description="Package selected material into a reusable report structure.",
        capability="report",
        launcher={
            "prompt_label": "Report audience",
            "prompt_placeholder": "Leadership update, internal brief, customer summary…",
            "submit_label": "Generate report",
            "suggested_prompts": ["Leadership brief", "Internal status report", "Customer-ready summary"],
        },
        tags=["starter", "files"],
    ),
    WorkflowManifest(
        workflow_id="create_action_plan",
        title="Action Plan",
        description="Convert the selected material into next steps and priorities.",
        capability="plan",
        launcher={
            "prompt_label": "Planning goal",
            "prompt_placeholder": "What outcome should the action plan optimize for?",
            "submit_label": "Build plan",
            "suggested_prompts": ["Immediate next steps", "Owner-ready checklist", "Priority roadmap"],
        },
        tags=["starter", "files"],
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
