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




_FALLBACK_TARGET_FAMILY_ALIASES: tuple[tuple[str, tuple[str, ...]], ...] = (
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


def _expected_fallback_families(inputs: dict[str, Any]) -> list[str]:
    text = " ".join(
        str(inputs.get(key) or "")
        for key in ("target_issue", "priority_areas", "focus", "desired_position", "output_type")
    ).lower()
    families: list[str] = []
    for family, terms in _FALLBACK_TARGET_FAMILY_ALIASES:
        if any(term in text for term in terms) and family not in families:
            families.append(family)
    return families


_FALLBACK_FAMILY_LABELS: dict[str, str] = {
    "limitation_of_liability": "Limitation of Liability",
    "indemnity": "Indemnity",
    "termination": "Termination",
    "warranties": "Warranties / Service Levels",
    "change_control": "Change Control",
    "data_protection": "Data Protection",
    "ip_ownership": "IP Ownership",
    "payment": "Payment",
    "renewal": "Renewal",
    "audit": "Audit",
    "assignment": "Assignment",
    "confidentiality": "Confidentiality",
    "insurance": "Insurance",
    "governing_law": "Governing Law",
    "dispute_resolution": "Dispute Resolution",
}


def _actual_fallback_families(metadata: dict[str, Any]) -> set[str]:
    items = metadata.get("fallback_items")
    if not isinstance(items, list):
        return set()
    return {
        str(item.get("clause_family") or "").strip()
        for item in items
        if isinstance(item, dict) and str(item.get("clause_family") or "").strip()
    }


def _fallback_families_visible_in_markdown(markdown: str, expected_families: list[str]) -> set[str]:
    text = markdown or ""
    match = re.search(
        r"^\s*#{1,6}\s+.*Targeted\s+Fallback\s+Language.*$(?P<body>.*)",
        text,
        re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )
    body = match.group("body") if match else ""
    visible: set[str] = set()
    for family in expected_families:
        label = _FALLBACK_FAMILY_LABELS.get(family, family.replace("_", " ").title())
        if label.lower() in body.lower() and "fallback language" in body.lower():
            visible.add(family)
    return visible

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

    min_llm_total_tokens_values = [
        defaults.get("min_llm_total_tokens"),
        getattr(rubric, "min_llm_total_tokens", None) if rubric else None,
        workflow.min_llm_total_tokens,
    ]
    min_llm_total_tokens = max([int(v) for v in min_llm_total_tokens_values if v is not None] or [0])

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

    if run.status == "completed" and min_llm_total_tokens:
        actual_llm_total_tokens = int((run.usage or {}).get("llm_total_tokens") or 0)
        if actual_llm_total_tokens < min_llm_total_tokens:
            issues.append(
                WorkflowEvalValidationIssue(
                    severity="warning",
                    code="llm_not_used",
                    message=f"Expected at least {min_llm_total_tokens} LLM token(s), found {actual_llm_total_tokens}.",
                    path="usage.llm_total_tokens",
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


    if run.status == "completed" and run.workflow_id == "legal_fallback_language":
        expected_fallback_families = _expected_fallback_families(run.inputs)
        if expected_fallback_families:
            actual_fallback_families = _actual_fallback_families(run.structured_metadata)
            missing_families = [family for family in expected_fallback_families if family not in actual_fallback_families]
            if missing_families:
                issues.append(
                    WorkflowEvalValidationIssue(
                        severity="warning",
                        code="missing_requested_fallback_family",
                        message="Missing fallback language for requested clause family/families: " + ", ".join(missing_families) + ".",
                        path="structured_metadata.fallback_items",
                    )
                )

            visible_families = _fallback_families_visible_in_markdown(run.output_markdown, expected_fallback_families)
            hidden_families = [family for family in expected_fallback_families if family not in visible_families]
            if hidden_families:
                issues.append(
                    WorkflowEvalValidationIssue(
                        severity="warning",
                        code="requested_fallback_family_not_visible",
                        message="Requested fallback family/families are present only in metadata or coverage text, not visible proposed language: "
                        + ", ".join(hidden_families)
                        + ".",
                        path="output_markdown",
                    )
                )

    if any(issue.severity == "error" for issue in issues):
        status = "failed"
    elif issues:
        status = "warning"
    else:
        status = "passed"
    return WorkflowEvalValidationSummary(status=status, issues=issues)
