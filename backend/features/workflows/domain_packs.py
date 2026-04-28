from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

WorkflowCapabilityName = Literal["summarize", "compare", "extract", "draft", "report", "plan"]


@dataclass(frozen=True)
class DomainWorkflowSpec:
    workflow_id: str
    pack_id: str
    pack_label: str
    pack_order: int
    workflow_order: int
    title: str
    description: str
    capability: WorkflowCapabilityName
    prompt_label: str
    prompt_placeholder: str
    submit_label: str
    suggested_prompts: tuple[str, ...]
    task_brief: str
    output_requirements: str
    default_focus: str
    tags: tuple[str, ...] = field(default_factory=tuple)
    selection: dict[str, Any] = field(default_factory=dict)
    launcher_fields: tuple[dict[str, Any], ...] = field(default_factory=tuple)


LEGAL_RISK_LEVELS: tuple[str, ...] = ("low", "medium", "high", "critical")

LEGAL_REVIEW_MODES: tuple[dict[str, str], ...] = (
    {"value": "business_risk", "label": "Business risk", "description": "Focus on practical exposure, approvals, obligations, and deal impact."},
    {"value": "legal_risk", "label": "Legal risk", "description": "Focus on clause risk, enforceability concerns, ambiguity, and missing protections."},
    {"value": "negotiation", "label": "Negotiation", "description": "Focus on must-have edits, fallback positions, and negotiation comments."},
    {"value": "executive_summary", "label": "Executive summary", "description": "Focus on a concise decision-ready brief for non-lawyers."},
    {"value": "approval", "label": "Approval", "description": "Focus on approval issues, exceptions, and escalation notes."},
)

LEGAL_DOCUMENT_TYPES: tuple[dict[str, str], ...] = (
    {"value": "general_contract", "label": "General contract"},
    {"value": "nda", "label": "NDA"},
    {"value": "msa_services", "label": "MSA / services agreement"},
    {"value": "vendor_agreement", "label": "Vendor agreement"},
    {"value": "dpa", "label": "Data processing agreement"},
    {"value": "employment", "label": "Employment document"},
    {"value": "policy", "label": "Policy"},
    {"value": "other", "label": "Other"},
)

LEGAL_COUNTERPARTY_POSITIONS: tuple[dict[str, str], ...] = (
    {"value": "unknown", "label": "Not specified"},
    {"value": "customer", "label": "Customer"},
    {"value": "vendor", "label": "Vendor"},
    {"value": "partner", "label": "Partner"},
    {"value": "employer", "label": "Employer"},
    {"value": "employee", "label": "Employee"},
)

LEGAL_RISK_TOLERANCE_OPTIONS: tuple[dict[str, str], ...] = (
    {"value": "conservative", "label": "Conservative", "description": "Flag more issues and recommend stronger protections."},
    {"value": "balanced", "label": "Balanced", "description": "Balance protection with practical deal progress."},
    {"value": "commercial", "label": "Commercial", "description": "Prioritize issues that materially affect business outcomes."},
    {"value": "aggressive", "label": "Aggressive", "description": "Accept more risk unless it creates major exposure."},
)

LEGAL_CLAUSE_FAMILIES: tuple[str, ...] = (
    "confidentiality",
    "indemnity",
    "limitation_of_liability",
    "termination",
    "renewal",
    "ip_ownership",
    "data_protection",
    "governing_law",
    "payment",
    "assignment",
    "audit",
    "insurance",
    "non_solicit",
    "exclusivity",
    "warranties",
    "dispute_resolution",
    "change_control",
    "notices",
)

LEGAL_REVIEW_METADATA_REQUIREMENTS = (
    "For Legal workflows, metadata must include legal_profile, risk_items, clause_items, obligation_items, "
    "open_questions, and approval_notes. risk_items should use issue, severity, clause_family, business_impact, "
    "source_basis, recommended_change, fallback_position, and requires_human_review. clause_items should use "
    "clause_family, current_position, source_basis, concern, and recommended_position. obligation_items should use "
    "obligation, responsible_party, trigger_or_deadline, source_basis, and follow_up. open_questions and approval_notes "
    "should be arrays of concise strings."
)

LEGAL_HOUSE_POSITION_SUMMARY = (
    "Use these default house-position assumptions unless the user's prompt says otherwise: prefer mutual confidentiality "
    "where appropriate; avoid unlimited liability except for narrow intentional misconduct, confidentiality, IP misuse, or payment carveouts; "
    "prefer clear termination rights and renewal notice windows; prefer customer/client ownership of work product paid for by the business; "
    "require clear data protection, security, audit, insurance, assignment, and notice terms when operationally relevant."
)

LEGAL_LAUNCHER_FIELDS: tuple[dict[str, Any], ...] = (
    {
        "key": "document_type",
        "label": "Document type",
        "kind": "select",
        "placeholder": "Select document type",
        "default_value": "general_contract",
        "options": list(LEGAL_DOCUMENT_TYPES),
    },
    {
        "key": "review_mode",
        "label": "Review mode",
        "kind": "select",
        "placeholder": "Select review mode",
        "default_value": "business_risk",
        "options": list(LEGAL_REVIEW_MODES),
    },
    {
        "key": "counterparty_position",
        "label": "Counterparty",
        "kind": "select",
        "placeholder": "Select counterparty position",
        "default_value": "unknown",
        "options": list(LEGAL_COUNTERPARTY_POSITIONS),
    },
    {
        "key": "risk_tolerance",
        "label": "Risk tolerance",
        "kind": "select",
        "placeholder": "Select risk tolerance",
        "default_value": "balanced",
        "options": list(LEGAL_RISK_TOLERANCE_OPTIONS),
    },
)


def _legal_output_requirements(extra: str) -> str:
    return f"{extra} {LEGAL_REVIEW_METADATA_REQUIREMENTS}"


DOMAIN_WORKFLOW_SPECS: tuple[DomainWorkflowSpec, ...] = (
    # Legal
    DomainWorkflowSpec(
        workflow_id="legal_contract_review",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=10,
        title="Contract Review",
        description="Review a contract for key obligations, risk points, missing protections, and practical next steps.",
        capability="report",
        prompt_label="Review focus",
        prompt_placeholder="Risk points, missing terms, unfavorable language, approval issues…",
        submit_label="Review contract",
        suggested_prompts=("Business risks", "Missing protections", "Approval-ready summary"),
        task_brief=(
            "Review the selected legal material as a practical contract review. Identify obligations, risk points, "
            "missing protections, unusual terms, negotiation issues, and business implications. Apply the Legal pack schema and house-position assumptions."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should include Executive Summary, Deal / Document Context, Key Terms, Risk Matrix, Missing or Ambiguous Terms, "
            "Negotiation Recommendations, Approval Notes, and Open Questions."
        ),
        default_focus="contract risks, obligations, missing protections, and approval issues",
        tags=("legal", "contract", "review", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),
    DomainWorkflowSpec(
        workflow_id="legal_contract_risk_matrix",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=15,
        title="Risk Matrix",
        description="Turn a contract review into a decision-ready matrix of risks, impact, recommendations, and approvals.",
        capability="report",
        prompt_label="Matrix focus",
        prompt_placeholder="Commercial risk, approval exceptions, liability exposure, negotiation priorities…",
        submit_label="Build risk matrix",
        suggested_prompts=("Approval risks", "Negotiation priorities", "High-severity issues"),
        task_brief=(
            "Create a contract risk matrix from the selected legal material. Prioritize issues by severity, business impact, approval sensitivity, "
            "and recommended fix. Include practical fallback positions where the source supports them."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should center on a risk matrix with issue, severity, clause family, business impact, source basis, recommended fix, fallback, and approval owner. "
            "Include a short executive summary and a short approval checklist."
        ),
        default_focus="risk severity, business impact, approval exceptions, and recommended fixes",
        tags=("legal", "contract", "risk", "matrix", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),
    DomainWorkflowSpec(
        workflow_id="legal_nda_review",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=18,
        title="NDA Review",
        description="Review an NDA for confidentiality scope, exclusions, term, residuals, remedies, law, and mutuality.",
        capability="report",
        prompt_label="Review focus",
        prompt_placeholder="Mutuality, residual knowledge, confidentiality term, exclusions, return/destruction…",
        submit_label="Review NDA",
        suggested_prompts=("Mutual NDA review", "Residual knowledge risk", "Business-friendly summary"),
        task_brief=(
            "Review the selected NDA or confidentiality material. Check confidentiality scope, exclusions, term, residual knowledge, non-solicit or non-compete-like language, "
            "injunctive relief, return/destruction, governing law, assignment, and mutuality. Flag unusual or business-sensitive terms."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should include NDA Snapshot, Key Terms, Red Flags, Missing Protections, Negotiation Recommendations, Approval Notes, and Open Questions. "
            "Give special attention to confidentiality scope, exclusions, residuals, term, return/destruction, remedies, and mutuality."
        ),
        default_focus="NDA confidentiality scope, exclusions, term, residuals, remedies, and mutuality",
        tags=("legal", "nda", "confidentiality", "review", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),
    DomainWorkflowSpec(
        workflow_id="legal_msa_review",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=22,
        title="MSA Review",
        description="Review an MSA or services agreement for scope, payment, liability, indemnity, IP, data, SLAs, and renewal risk.",
        capability="report",
        prompt_label="Review focus",
        prompt_placeholder="Liability, indemnity, IP ownership, payment, SLAs, data protection, termination…",
        submit_label="Review MSA",
        suggested_prompts=("Services risk review", "Commercial terms", "Approval summary"),
        task_brief=(
            "Review the selected MSA or services agreement. Check scope, statements of work, payment, term, termination, SLAs, warranties, limitation of liability, "
            "indemnity, IP ownership, data protection, audit rights, renewal mechanics, assignment, and change control."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should include Agreement Snapshot, Commercial Terms, Legal Risk Matrix, Operational Obligations, Missing Protections, Negotiation Recommendations, and Approval Notes."
        ),
        default_focus="scope, payment, liability, indemnity, IP, data protection, SLAs, renewal, and termination",
        tags=("legal", "msa", "services", "review", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),
    DomainWorkflowSpec(
        workflow_id="legal_clause_extraction",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=30,
        title="Clause Extraction",
        description="Extract important clauses, obligations, dates, parties, and fallback positions from legal documents.",
        capability="extract",
        prompt_label="Clauses to extract",
        prompt_placeholder="Termination, confidentiality, indemnity, payment terms, governing law…",
        submit_label="Extract clauses",
        suggested_prompts=("Key legal clauses", "Dates and obligations", "Termination and renewal terms"),
        task_brief=(
            "Extract legal clauses and contract details from the selected material. Use the Legal pack clause families where possible. Focus on parties, dates, obligations, "
            "payment terms, renewal or termination mechanics, governing law, fallback-relevant positions, and approval-sensitive language."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should include a structured clause table with clause family, current position, source basis, concern, recommended position, and confidence. "
            "Also include obligation and deadline tables where useful."
        ),
        default_focus="key clauses, parties, obligations, dates, fallback positions, and approval-sensitive terms",
        tags=("legal", "clauses", "extraction", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),
    DomainWorkflowSpec(
        workflow_id="legal_fallback_language",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=40,
        title="Fallback Language",
        description="Draft negotiation fallback language and revision notes based on the selected contract material.",
        capability="draft",
        prompt_label="Drafting goal",
        prompt_placeholder="Mutual confidentiality, liability cap, narrower indemnity, safer renewal term…",
        submit_label="Draft fallback",
        suggested_prompts=("Safer fallback clause", "Negotiation note", "Plain-English alternative"),
        task_brief=(
            "Draft practical fallback language and negotiation notes grounded in the selected legal material. Use the Legal pack house-position assumptions, "
            "explain assumptions, and avoid overstating legal conclusions where source text is unclear."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should include Proposed Language, Rationale, Negotiation Note, Fallback Ladder, Assumptions, and Open Questions. "
            "In metadata, include fallback_items with clause_family, proposed_language, rationale, source_basis, and confidence."
        ),
        default_focus="fallback clause language, rationale, assumptions, and negotiation notes",
        tags=("legal", "drafting", "fallback", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),
    DomainWorkflowSpec(
        workflow_id="legal_negotiation_brief",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=45,
        title="Negotiation Brief",
        description="Create a negotiation plan with must-have changes, fallback positions, comments, and escalation issues.",
        capability="plan",
        prompt_label="Negotiation goal",
        prompt_placeholder="Must-have changes, acceptable fallbacks, executive issues, customer comments…",
        submit_label="Create brief",
        suggested_prompts=("Must-have changes", "Fallback positions", "Comment-ready notes"),
        task_brief=(
            "Create a legal negotiation brief from the selected material. Separate must-have changes from nice-to-have changes, suggest fallback positions, "
            "draft comment-ready notes, and flag approval or escalation issues."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should include Negotiation Objective, Must-Have Changes, Nice-to-Have Changes, Fallback Positions, Suggested Comments, Escalation Issues, and Open Questions. "
            "In metadata, include plan_items with action, priority, owner, timeline, and related_clause_family."
        ),
        default_focus="must-have changes, fallback positions, suggested comments, and escalation issues",
        tags=("legal", "negotiation", "brief", "plan", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),
    DomainWorkflowSpec(
        workflow_id="legal_obligation_tracker",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=48,
        title="Obligation Tracker",
        description="Extract post-signature obligations, deadlines, owners, renewal windows, notices, and follow-up tasks.",
        capability="extract",
        prompt_label="Tracking focus",
        prompt_placeholder="Renewals, notice periods, reporting duties, payment obligations, audit rights…",
        submit_label="Extract obligations",
        suggested_prompts=("Post-signature duties", "Renewal and notice windows", "Operational obligations"),
        task_brief=(
            "Extract post-signature legal and operational obligations from the selected material. Focus on notices, renewals, reporting duties, payment terms, "
            "audit obligations, insurance requirements, data protection duties, termination windows, and owner-ready follow-ups."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should include Obligation Tracker, Deadline / Trigger Table, Owner Follow-ups, Risk Notes, and Open Questions. "
            "Metadata obligation_items should be detailed enough to power a follow-up checklist."
        ),
        default_focus="post-signature obligations, deadlines, renewal windows, notices, owners, and follow-up tasks",
        tags=("legal", "obligations", "tracking", "extraction", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),
    DomainWorkflowSpec(
        workflow_id="legal_matter_handoff",
        pack_id="legal",
        pack_label="Legal",
        pack_order=10,
        workflow_order=50,
        title="Matter Handoff",
        description="Prepare a legal handoff summary with current status, decisions, risks, open items, and next steps.",
        capability="summarize",
        prompt_label="Handoff focus",
        prompt_placeholder="Current state, unresolved items, negotiation status, risk areas…",
        submit_label="Prepare handoff",
        suggested_prompts=("Matter status", "Open issues", "Next reviewer brief"),
        task_brief=(
            "Prepare a legal matter handoff from the selected material. Summarize current state, relevant background, decisions, unresolved issues, "
            "risk areas, deadlines, owner-sensitive obligations, and next actions."
        ),
        output_requirements=_legal_output_requirements(
            "The markdown should read like a handoff note for the next reviewer. Include Matter Status, Context, Key Decisions, Open Issues, Risk Flags, Deadlines, "
            "Approval Notes, and Recommended Next Steps."
        ),
        default_focus="matter status, unresolved issues, risk flags, deadlines, approvals, and next reviewer actions",
        tags=("legal", "handoff", "summary", "pro"),
        launcher_fields=LEGAL_LAUNCHER_FIELDS,
    ),

    # HR
    DomainWorkflowSpec(
        workflow_id="hr_policy_review",
        pack_id="hr",
        pack_label="HR",
        pack_order=20,
        workflow_order=10,
        title="Policy Review",
        description="Review HR policies for clarity, operational gaps, employee impact, and rollout considerations.",
        capability="report",
        prompt_label="Review focus",
        prompt_placeholder="Clarity, gaps, employee impact, manager actions, rollout risks…",
        submit_label="Review policy",
        suggested_prompts=("Clarity and gaps", "Manager-ready summary", "Employee impact"),
        task_brief=(
            "Review the selected HR policy or people-operations material for clarity, gaps, employee impact, manager responsibilities, "
            "rollout risks, and practical implementation issues."
        ),
        output_requirements=(
            "The markdown should include overview, policy intent, employee impact, manager actions, gaps or ambiguities, and rollout recommendations."
        ),
        default_focus="policy clarity, gaps, employee impact, manager responsibilities, and rollout risks",
        tags=("hr", "policy", "review", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="hr_onboarding_pack",
        pack_id="hr",
        pack_label="HR",
        pack_order=20,
        workflow_order=20,
        title="Onboarding Pack",
        description="Turn selected company material into an onboarding guide for a role, team, or project.",
        capability="draft",
        prompt_label="Who is this for?",
        prompt_placeholder="New employee, manager, contractor, department transfer…",
        submit_label="Create onboarding pack",
        suggested_prompts=("New employee guide", "Manager onboarding", "First-week reading plan"),
        task_brief=(
            "Create an onboarding pack from the selected material. Explain what the reader needs to know, what to read first, who or what matters, "
            "important terminology, and practical first steps."
        ),
        output_requirements=(
            "The markdown should be a usable onboarding guide with overview, first-week priorities, key references, glossary, suggested reading order, and questions to ask."
        ),
        default_focus="role context, key documents, first-week priorities, glossary, and reading order",
        tags=("hr", "onboarding", "draft", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="hr_employee_handoff",
        pack_id="hr",
        pack_label="HR",
        pack_order=20,
        workflow_order=30,
        title="Employee Handoff",
        description="Prepare a structured handoff for employee transitions, manager changes, or team moves.",
        capability="summarize",
        prompt_label="Handoff focus",
        prompt_placeholder="Responsibilities, open work, dependencies, risks, immediate next steps…",
        submit_label="Prepare handoff",
        suggested_prompts=("Manager transition", "Role handoff", "Open work summary"),
        task_brief=(
            "Prepare an employee or role handoff from the selected material. Summarize responsibilities, open work, key relationships, dependencies, risks, "
            "and immediate next steps."
        ),
        output_requirements=(
            "The markdown should include current responsibilities, active work, key contacts or dependencies, risks, and next actions."
        ),
        default_focus="responsibilities, open work, dependencies, risks, and immediate next steps",
        tags=("hr", "handoff", "summary", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="hr_role_brief",
        pack_id="hr",
        pack_label="HR",
        pack_order=20,
        workflow_order=40,
        title="Role Brief",
        description="Create a role or team brief from source material for hiring, onboarding, or internal alignment.",
        capability="report",
        prompt_label="Brief focus",
        prompt_placeholder="Role scope, success metrics, responsibilities, stakeholders…",
        submit_label="Create brief",
        suggested_prompts=("Hiring brief", "Team role summary", "Success profile"),
        task_brief=(
            "Create a role or team brief from the selected material. Clarify scope, responsibilities, success indicators, stakeholders, required context, "
            "and open questions."
        ),
        output_requirements=(
            "The markdown should include role summary, responsibilities, success measures, required context, stakeholders, and open questions."
        ),
        default_focus="role scope, responsibilities, success metrics, stakeholders, and open questions",
        tags=("hr", "role", "brief", "pro"),
    ),

    # Accounting
    DomainWorkflowSpec(
        workflow_id="accounting_invoice_extraction",
        pack_id="accounting",
        pack_label="Accounting",
        pack_order=30,
        workflow_order=10,
        title="Invoice Extraction",
        description="Extract invoice numbers, vendors, dates, totals, payment terms, tax, and approval notes.",
        capability="extract",
        prompt_label="Fields to extract",
        prompt_placeholder="Vendor, invoice number, due date, total, tax, line items, approval notes…",
        submit_label="Extract invoice data",
        suggested_prompts=("Invoice fields", "Payment terms", "Line-item summary"),
        task_brief=(
            "Extract accounting details from selected invoices or finance documents. Focus on vendor, invoice number, dates, totals, taxes, line items, "
            "payment terms, approval notes, and exceptions."
        ),
        output_requirements=(
            "The markdown should include a compact extraction table and exception notes. In metadata, include fields as objects with field, value, confidence, and source_basis."
        ),
        default_focus="invoice numbers, vendors, dates, totals, taxes, payment terms, and exceptions",
        tags=("accounting", "invoice", "extraction", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="accounting_month_end_close",
        pack_id="accounting",
        pack_label="Accounting",
        pack_order=30,
        workflow_order=20,
        title="Close Checklist",
        description="Build a month-end close checklist from selected finance notes, reconciliations, and supporting files.",
        capability="plan",
        prompt_label="Close focus",
        prompt_placeholder="Month-end close, revenue checks, accruals, reconciliations, blockers…",
        submit_label="Build checklist",
        suggested_prompts=("Month-end close", "Reconciliation checklist", "Close blockers"),
        task_brief=(
            "Create an accounting close checklist from the selected material. Identify required tasks, dependencies, blockers, responsible roles, deadlines, "
            "and validation steps."
        ),
        output_requirements=(
            "The markdown should include close objectives, checklist items, dependencies, blockers, owners, timelines, and validation checks. "
            "In metadata, include plan_items as objects with action, priority, owner, and timeline."
        ),
        default_focus="close tasks, reconciliations, dependencies, blockers, owners, and deadlines",
        tags=("accounting", "close", "checklist", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="accounting_budget_variance",
        pack_id="accounting",
        pack_label="Accounting",
        pack_order=30,
        workflow_order=30,
        title="Budget Variance",
        description="Analyze budget or spend material for variance drivers, outliers, and follow-up questions.",
        capability="report",
        prompt_label="Analysis focus",
        prompt_placeholder="Variance drivers, unusual spend, budget risks, open questions…",
        submit_label="Analyze variance",
        suggested_prompts=("Variance drivers", "Spend outliers", "Leadership summary"),
        task_brief=(
            "Analyze selected budget, spend, or finance material for variance drivers, outliers, unusual changes, risks, and follow-up questions."
        ),
        output_requirements=(
            "The markdown should include executive summary, variance drivers, likely explanations, risks, open questions, and recommended follow-up."
        ),
        default_focus="variance drivers, outliers, budget risks, and follow-up questions",
        tags=("accounting", "budget", "variance", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="accounting_receivables_summary",
        pack_id="accounting",
        pack_label="Accounting",
        pack_order=30,
        workflow_order=40,
        title="Receivables Summary",
        description="Summarize receivables, payment status, collection risks, and recommended follow-ups.",
        capability="summarize",
        prompt_label="Summary focus",
        prompt_placeholder="Aging, overdue accounts, collection risk, follow-up actions…",
        submit_label="Summarize receivables",
        suggested_prompts=("Aging summary", "Collection risks", "Follow-up list"),
        task_brief=(
            "Summarize receivables or payment-status material. Highlight aging, overdue items, collection risks, payment commitments, exceptions, "
            "and recommended follow-up actions."
        ),
        output_requirements=(
            "The markdown should include receivables overview, notable overdue items, collection risks, commitments, exceptions, and next actions."
        ),
        default_focus="aging, overdue items, collection risks, commitments, and follow-up actions",
        tags=("accounting", "receivables", "summary", "pro"),
    ),

    # Procurement
    DomainWorkflowSpec(
        workflow_id="procurement_vendor_review",
        pack_id="procurement",
        pack_label="Procurement",
        pack_order=40,
        workflow_order=10,
        title="Vendor Review",
        description="Review vendor material for pricing, obligations, renewal terms, risks, and approval considerations.",
        capability="report",
        prompt_label="Review focus",
        prompt_placeholder="Pricing, renewal terms, SLA, obligations, risk, approval issues…",
        submit_label="Review vendor",
        suggested_prompts=("Commercial terms", "Renewal risks", "Approval summary"),
        task_brief=(
            "Review selected vendor or procurement material for commercial terms, obligations, pricing, renewal mechanics, SLA terms, risks, "
            "and approval considerations."
        ),
        output_requirements=(
            "The markdown should include vendor overview, commercial terms, obligations, renewal or termination notes, risks, and approval recommendation."
        ),
        default_focus="pricing, obligations, renewal terms, SLA commitments, risks, and approval issues",
        tags=("procurement", "vendor", "review", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="procurement_renewal_risk",
        pack_id="procurement",
        pack_label="Procurement",
        pack_order=40,
        workflow_order=20,
        title="Renewal Risk",
        description="Find renewal dates, notice periods, auto-renewal language, price changes, and cancellation risks.",
        capability="extract",
        prompt_label="Risk focus",
        prompt_placeholder="Auto-renewal, notice period, renewal date, price increase, cancellation rights…",
        submit_label="Check renewal risk",
        suggested_prompts=("Auto-renewal terms", "Notice deadlines", "Cancellation rights"),
        task_brief=(
            "Extract and assess renewal risk from selected vendor or contract material. Focus on renewal dates, auto-renewal mechanics, notice periods, "
            "price changes, cancellation rights, and operational risks."
        ),
        output_requirements=(
            "The markdown should include a renewal-risk table and recommended actions. In metadata, include fields and risk_items where useful."
        ),
        default_focus="renewal dates, auto-renewal, notice periods, price changes, and cancellation risks",
        tags=("procurement", "renewal", "risk", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="procurement_sla_extraction",
        pack_id="procurement",
        pack_label="Procurement",
        pack_order=40,
        workflow_order=30,
        title="SLA Extraction",
        description="Extract SLA commitments, support terms, remedies, exclusions, and operational requirements.",
        capability="extract",
        prompt_label="SLA focus",
        prompt_placeholder="Uptime, response times, remedies, exclusions, support hours…",
        submit_label="Extract SLA terms",
        suggested_prompts=("Support commitments", "Remedies and exclusions", "Operational requirements"),
        task_brief=(
            "Extract SLA and support terms from the selected material. Focus on uptime, response times, service credits, remedies, exclusions, support hours, "
            "maintenance windows, and operational requirements."
        ),
        output_requirements=(
            "The markdown should include a structured SLA table and open questions. In metadata, include fields with confidence and source_basis."
        ),
        default_focus="SLA commitments, support terms, remedies, exclusions, and operational requirements",
        tags=("procurement", "sla", "extraction", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="procurement_pricing_summary",
        pack_id="procurement",
        pack_label="Procurement",
        pack_order=40,
        workflow_order=40,
        title="Pricing Summary",
        description="Summarize pricing, fees, discounts, renewal changes, and commercial tradeoffs.",
        capability="summarize",
        prompt_label="Summary focus",
        prompt_placeholder="Fees, discounts, renewal pricing, usage costs, commercial tradeoffs…",
        submit_label="Summarize pricing",
        suggested_prompts=("Commercial summary", "Fees and discounts", "Renewal pricing"),
        task_brief=(
            "Summarize pricing and commercial terms from the selected material. Highlight fees, discounts, renewal pricing, usage charges, assumptions, "
            "commercial risks, and tradeoffs."
        ),
        output_requirements=(
            "The markdown should include pricing overview, fee table if possible, assumptions, risks, and recommended follow-up questions."
        ),
        default_focus="fees, discounts, renewal pricing, usage charges, assumptions, and commercial risks",
        tags=("procurement", "pricing", "summary", "pro"),
    ),

    # Compliance
    DomainWorkflowSpec(
        workflow_id="compliance_gap_review",
        pack_id="compliance",
        pack_label="Compliance",
        pack_order=50,
        workflow_order=10,
        title="Gap Review",
        description="Review selected policies or evidence for compliance gaps, control weaknesses, and remediation actions.",
        capability="report",
        prompt_label="Review focus",
        prompt_placeholder="Policy gaps, control gaps, missing evidence, remediation actions…",
        submit_label="Review gaps",
        suggested_prompts=("Control gaps", "Missing evidence", "Remediation plan"),
        task_brief=(
            "Review selected compliance material for gaps, control weaknesses, missing evidence, ambiguous ownership, exceptions, and remediation needs."
        ),
        output_requirements=(
            "The markdown should include compliance summary, observed gaps, evidence notes, severity, remediation actions, and open questions. "
            "In metadata, include risk_items where useful."
        ),
        default_focus="control gaps, missing evidence, exceptions, ownership, and remediation actions",
        tags=("compliance", "gap", "review", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="compliance_audit_prep",
        pack_id="compliance",
        pack_label="Compliance",
        pack_order=50,
        workflow_order=20,
        title="Audit Prep",
        description="Prepare an audit-ready brief with evidence, gaps, owners, and required follow-up.",
        capability="plan",
        prompt_label="Audit focus",
        prompt_placeholder="Evidence package, owner list, open gaps, remediation timeline…",
        submit_label="Prepare audit brief",
        suggested_prompts=("Evidence checklist", "Owner-ready audit prep", "Open gaps and timeline"),
        task_brief=(
            "Prepare an audit-ready plan from the selected material. Identify evidence, gaps, owners, follow-up requests, timelines, and readiness risks."
        ),
        output_requirements=(
            "The markdown should include audit objective, evidence inventory, missing items, owners, timeline, risks, and next steps. "
            "In metadata, include plan_items as objects with action, priority, owner, and timeline."
        ),
        default_focus="audit evidence, missing items, owners, readiness risks, and follow-up timeline",
        tags=("compliance", "audit", "plan", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="compliance_evidence_summary",
        pack_id="compliance",
        pack_label="Compliance",
        pack_order=50,
        workflow_order=30,
        title="Evidence Summary",
        description="Summarize control evidence, coverage, exceptions, and reviewer notes from selected files.",
        capability="summarize",
        prompt_label="Summary focus",
        prompt_placeholder="Control evidence, coverage, exceptions, reviewer notes…",
        submit_label="Summarize evidence",
        suggested_prompts=("Control evidence", "Exception summary", "Reviewer notes"),
        task_brief=(
            "Summarize control evidence from selected compliance material. Highlight what the evidence supports, coverage, exceptions, limitations, "
            "reviewer notes, and follow-up needs."
        ),
        output_requirements=(
            "The markdown should include evidence overview, supported controls or claims, limitations, exceptions, and next actions."
        ),
        default_focus="control evidence, coverage, exceptions, limitations, and reviewer follow-up",
        tags=("compliance", "evidence", "summary", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="compliance_risk_register",
        pack_id="compliance",
        pack_label="Compliance",
        pack_order=50,
        workflow_order=40,
        title="Risk Register",
        description="Convert selected compliance material into a practical risk register with owners and mitigation steps.",
        capability="extract",
        prompt_label="Register focus",
        prompt_placeholder="Risks, owners, mitigations, severity, status, due dates…",
        submit_label="Create risk register",
        suggested_prompts=("Risk register", "Mitigation owners", "Severity and status"),
        task_brief=(
            "Create a compliance risk register from the selected material. Identify risks, causes, impact, severity, current status, owners, mitigations, "
            "and due dates where supported by the source."
        ),
        output_requirements=(
            "The markdown should include a risk register table. In metadata, include risk_items as objects with issue, severity, owner, mitigation, and source_basis."
        ),
        default_focus="risks, severity, owners, mitigations, status, and due dates",
        tags=("compliance", "risk", "register", "pro"),
    ),

    # Operations
    DomainWorkflowSpec(
        workflow_id="operations_sop_builder",
        pack_id="operations",
        pack_label="Operations",
        pack_order=60,
        workflow_order=10,
        title="SOP Builder",
        description="Turn process notes into a clear SOP with steps, roles, checks, and exceptions.",
        capability="draft",
        prompt_label="SOP focus",
        prompt_placeholder="Process name, role responsibilities, quality checks, exception handling…",
        submit_label="Build SOP",
        suggested_prompts=("Step-by-step SOP", "Role responsibilities", "Exceptions and checks"),
        task_brief=(
            "Build a standard operating procedure from the selected material. Identify process objective, steps, roles, inputs, outputs, quality checks, "
            "exceptions, and escalation points."
        ),
        output_requirements=(
            "The markdown should be a usable SOP with purpose, scope, roles, procedure, checks, exceptions, and revision notes."
        ),
        default_focus="process steps, roles, inputs, outputs, quality checks, and exceptions",
        tags=("operations", "sop", "draft", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="operations_incident_review",
        pack_id="operations",
        pack_label="Operations",
        pack_order=60,
        workflow_order=20,
        title="Incident Review",
        description="Summarize an incident, likely causes, impact, timeline, and corrective actions.",
        capability="report",
        prompt_label="Review focus",
        prompt_placeholder="Timeline, impact, root causes, corrective actions, owners…",
        submit_label="Review incident",
        suggested_prompts=("Incident timeline", "Corrective actions", "Root-cause brief"),
        task_brief=(
            "Review selected incident or operational issue material. Summarize timeline, impact, contributing factors, likely root causes, open questions, "
            "and corrective actions."
        ),
        output_requirements=(
            "The markdown should include incident summary, timeline, impact, contributing factors, corrective actions, owners, and open questions."
        ),
        default_focus="incident timeline, impact, contributing factors, corrective actions, and owners",
        tags=("operations", "incident", "review", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="operations_process_improvement",
        pack_id="operations",
        pack_label="Operations",
        pack_order=60,
        workflow_order=30,
        title="Process Improvement",
        description="Identify bottlenecks, waste, handoff issues, and practical improvements from operational material.",
        capability="plan",
        prompt_label="Improvement focus",
        prompt_placeholder="Bottlenecks, delays, waste, handoffs, owner actions…",
        submit_label="Create improvement plan",
        suggested_prompts=("Bottlenecks", "Handoff issues", "Improvement roadmap"),
        task_brief=(
            "Analyze selected operations material for process improvement opportunities. Identify bottlenecks, waste, handoff issues, failure points, "
            "priority improvements, owners, and timelines."
        ),
        output_requirements=(
            "The markdown should include process summary, bottlenecks, improvement opportunities, prioritized actions, owners, and expected impact. "
            "In metadata, include plan_items as objects with action, priority, owner, and timeline."
        ),
        default_focus="bottlenecks, waste, handoff issues, priority improvements, owners, and timelines",
        tags=("operations", "process", "plan", "pro"),
    ),
    DomainWorkflowSpec(
        workflow_id="operations_vendor_handoff",
        pack_id="operations",
        pack_label="Operations",
        pack_order=60,
        workflow_order=40,
        title="Vendor Handoff",
        description="Prepare a handoff summary for vendor operations, open issues, dependencies, and next actions.",
        capability="summarize",
        prompt_label="Handoff focus",
        prompt_placeholder="Open vendor issues, dependencies, service status, escalation path…",
        submit_label="Prepare handoff",
        suggested_prompts=("Vendor status", "Open issues", "Escalation path"),
        task_brief=(
            "Prepare a vendor operations handoff. Summarize current status, open issues, dependencies, service expectations, escalation paths, "
            "risks, and next actions."
        ),
        output_requirements=(
            "The markdown should include vendor status, open issues, dependencies, escalation path, risks, and next actions."
        ),
        default_focus="vendor status, open issues, dependencies, escalation path, risks, and next actions",
        tags=("operations", "vendor", "handoff", "pro"),
    ),
)

DOMAIN_WORKFLOW_INDEX: dict[str, DomainWorkflowSpec] = {spec.workflow_id: spec for spec in DOMAIN_WORKFLOW_SPECS}


def get_domain_workflow_spec(workflow_id: str) -> DomainWorkflowSpec | None:
    return DOMAIN_WORKFLOW_INDEX.get(workflow_id)
