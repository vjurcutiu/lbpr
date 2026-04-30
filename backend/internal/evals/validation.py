from __future__ import annotations

import re
from typing import Any

from .schemas import (
    EvalRubric,
    EvalWorkflowSpec,
    WorkflowEvalRunRecord,
    WorkflowEvalValidationIssue,
    WorkflowEvalValidationSummary,
)


DEFAULT_WORKFLOW_VALIDATION: dict[str, dict[str, Any]] = {
    "legal_contract_review": {
        "required_metadata_keys": ["risk_items", "open_questions"],
        "required_metadata_min_items": {"risk_items": 1},
        "min_source_count": 1,
    },
    "legal_contract_risk_matrix": {
        "required_metadata_keys": ["risk_items"],
        "required_metadata_min_items": {"risk_items": 1},
        "min_source_count": 1,
    },
    "legal_nda_review": {
        "required_metadata_keys": ["risk_items", "open_questions"],
        "required_metadata_min_items": {"risk_items": 1},
        "min_source_count": 1,
    },
    "legal_msa_review": {
        "required_metadata_keys": ["risk_items", "obligation_items"],
        "required_metadata_min_items": {"risk_items": 1},
        "min_source_count": 1,
    },
    "legal_clause_extraction": {
        "required_metadata_keys": ["clause_items"],
        "required_metadata_min_items": {"clause_items": 1},
        "min_source_count": 1,
    },
    "legal_obligation_tracker": {
        "required_metadata_keys": ["obligation_items"],
        "required_metadata_min_items": {"obligation_items": 1},
        "min_source_count": 1,
    },
    "legal_negotiation_brief": {
        "required_metadata_keys": ["risk_items", "open_questions"],
        "min_source_count": 1,
    },
    "legal_fallback_language": {
        "required_metadata_keys": ["fallback_items", "open_questions"],
        "required_metadata_min_items": {"fallback_items": 1},
        "min_source_count": 1,
    },
    "legal_matter_handoff": {
        "required_metadata_keys": ["risk_items", "obligation_items", "open_questions", "approval_notes"],
        "min_source_count": 1,
    },
}


def _merge_unique(*items: list[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for values in items:
        for value in values or []:
            normalized = str(value or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            merged.append(normalized)
    return merged


def _merge_min_items(*items: dict[str, int]) -> dict[str, int]:
    merged: dict[str, int] = {}
    for values in items:
        for key, value in (values or {}).items():
            try:
                min_value = int(value)
            except Exception:
                continue
            merged[str(key)] = max(merged.get(str(key), 0), min_value)
    return merged


def _metadata_path(metadata: dict[str, Any], path: str) -> Any:
    value: Any = metadata
    for part in path.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            return None
    return value


def _item_count(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (list, tuple, set, dict, str)):
        return len(value)
    return 1


def _contains_section(markdown: str, section: str) -> bool:
    if not section:
        return True
    escaped = re.escape(section.strip())
    heading = re.compile(rf"^\s*#{{1,6}}\s+.*{escaped}.*$", re.IGNORECASE | re.MULTILINE)
    if heading.search(markdown or ""):
        return True
    return section.strip().lower() in (markdown or "").lower()


def validate_eval_run(run: WorkflowEvalRunRecord, workflow: EvalWorkflowSpec, rubric: EvalRubric | None) -> WorkflowEvalValidationSummary:
    defaults = DEFAULT_WORKFLOW_VALIDATION.get(run.workflow_id, {})
    required_sections = _merge_unique(
        list(defaults.get("required_sections") or []),
        list(rubric.required_sections if rubric else []),
        workflow.expected_sections,
    )
    required_metadata_keys = _merge_unique(
        list(defaults.get("required_metadata_keys") or []),
        list(rubric.required_metadata_keys if rubric else []),
        workflow.required_metadata_keys,
    )
    required_metadata_min_items = _merge_min_items(
        dict(defaults.get("required_metadata_min_items") or {}),
        dict(rubric.required_metadata_min_items if rubric else {}),
        workflow.required_metadata_min_items,
    )
    min_source_count_values = [
        defaults.get("min_source_count"),
        rubric.min_source_count if rubric else None,
        workflow.min_source_count,
    ]
    min_source_count = max([int(v) for v in min_source_count_values if v is not None] or [0])

    issues: list[WorkflowEvalValidationIssue] = []
    if run.status == "failed":
        issues.append(
            WorkflowEvalValidationIssue(
                severity="error",
                code="workflow_failed",
                message=run.error or "Workflow run failed.",
            )
        )
    elif run.status == "completed" and not (run.output_markdown or "").strip():
        issues.append(
            WorkflowEvalValidationIssue(
                severity="error",
                code="empty_output",
                message="Workflow completed but returned no markdown output.",
            )
        )

    if run.status == "completed" and min_source_count and len(run.sources) < min_source_count:
        issues.append(
            WorkflowEvalValidationIssue(
                severity="warning",
                code="insufficient_sources",
                message=f"Expected at least {min_source_count} source(s), found {len(run.sources)}.",
                path="sources",
            )
        )

    for section in required_sections:
        if not _contains_section(run.output_markdown, section):
            issues.append(
                WorkflowEvalValidationIssue(
                    severity="warning",
                    code="missing_required_section",
                    message=f"Expected output section containing '{section}'.",
                    path="output_markdown",
                )
            )

    for key in required_metadata_keys:
        if _metadata_path(run.structured_metadata, key) is None:
            issues.append(
                WorkflowEvalValidationIssue(
                    severity="warning",
                    code="missing_metadata_key",
                    message=f"Expected structured metadata key '{key}'.",
                    path=f"structured_metadata.{key}",
                )
            )

    for key, expected_count in required_metadata_min_items.items():
        value = _metadata_path(run.structured_metadata, key)
        actual_count = _item_count(value)
        if actual_count < expected_count:
            issues.append(
                WorkflowEvalValidationIssue(
                    severity="warning",
                    code="insufficient_metadata_items",
                    message=f"Expected at least {expected_count} item(s) at '{key}', found {actual_count}.",
                    path=f"structured_metadata.{key}",
                )
            )

    if any(issue.severity == "error" for issue in issues):
        status = "failed"
    elif issues:
        status = "warning"
    else:
        status = "passed"
    return WorkflowEvalValidationSummary(status=status, issues=issues)
