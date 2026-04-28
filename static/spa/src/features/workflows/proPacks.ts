import type { WorkflowManifest } from "./types";

export type ProPackItem = {
  id: string;
  title: string;
  description: string;
  workflow_id: WorkflowManifest["workflow_id"];
  actionLabel: string;
  focus: string;
};

export type ProPackGroup = {
  id: string;
  title: string;
  packs: ProPackItem[];
};

export const PRO_PACK_GROUPS: ProPackGroup[] = [
  {
    id: "legal",
    title: "Legal",
    packs: [
      {
        id: "legal-contract-review",
        title: "Contract Review",
        description: "Review a contract for key terms, risks, obligations, fallback positions, and approval issues.",
        workflow_id: "legal_contract_review",
        actionLabel: "Review",
        focus: "Review the selected contract for key terms, legal risk, commercial exposure, obligations, fallback positions, approval issues, and open questions.",
      },
      {
        id: "legal-contract-risk-matrix",
        title: "Risk Matrix",
        description: "Create a structured issue matrix with severity, source basis, business impact, and recommended changes.",
        workflow_id: "legal_contract_risk_matrix",
        actionLabel: "Matrix",
        focus: "Create a contract risk matrix with severity, business impact, source language, recommended changes, fallback positions, owners, and approval notes.",
      },
      {
        id: "legal-nda-review",
        title: "NDA Review",
        description: "Check NDA terms including confidentiality scope, exclusions, term, residuals, return duties, and injunctive relief.",
        workflow_id: "legal_nda_review",
        actionLabel: "Review NDA",
        focus: "Review the NDA for confidentiality scope, exclusions, mutuality, term, residual knowledge, return or destruction duties, non-solicit language, governing law, injunctive relief, and approval issues.",
      },
      {
        id: "legal-msa-review",
        title: "MSA Review",
        description: "Review an MSA or services agreement for scope, payment, liability, indemnity, IP, data, SLAs, and renewal risk.",
        workflow_id: "legal_msa_review",
        actionLabel: "Review MSA",
        focus: "Review the MSA or services agreement for scope, payment, term, termination, SLAs, warranties, limitation of liability, indemnity, IP ownership, data protection, audit rights, renewal mechanics, assignment, and change control.",
      },
      {
        id: "legal-clause-extraction",
        title: "Clause Extraction",
        description: "Extract important clauses, obligations, dates, parties, and fallback-relevant positions.",
        workflow_id: "legal_clause_extraction",
        actionLabel: "Extract",
        focus: "Extract parties, effective dates, renewal terms, termination rights, governing law, liability caps, assignment language, confidentiality terms, approvals, obligations, and risk flags.",
      },
      {
        id: "legal-fallback-language",
        title: "Fallback Language",
        description: "Draft practical fallback language, rationale, and negotiation notes for selected contract terms.",
        workflow_id: "legal_fallback_language",
        actionLabel: "Draft fallback",
        focus: "Draft practical fallback language with rationale, negotiation notes, assumptions, fallback ladder, and open questions based on the selected legal material.",
      },
      {
        id: "legal-negotiation-brief",
        title: "Negotiation Brief",
        description: "Create a negotiation plan with must-have changes, fallback positions, comments, and escalation issues.",
        workflow_id: "legal_negotiation_brief",
        actionLabel: "Create brief",
        focus: "Create a legal negotiation brief with must-have changes, nice-to-have changes, fallback positions, suggested comments, escalation issues, and open questions.",
      },
      {
        id: "legal-obligation-tracker",
        title: "Obligation Tracker",
        description: "Extract post-signature obligations, deadlines, owners, renewal windows, notices, and follow-up tasks.",
        workflow_id: "legal_obligation_tracker",
        actionLabel: "Track",
        focus: "Extract post-signature obligations, deadlines, renewal windows, notice periods, payment duties, reporting duties, audit obligations, insurance requirements, owner follow-ups, and risk notes.",
      },
      {
        id: "legal-matter-handoff",
        title: "Matter Handoff",
        description: "Prepare a handoff summary with current status, decisions, risks, deadlines, open items, and next steps.",
        workflow_id: "legal_matter_handoff",
        actionLabel: "Handoff",
        focus: "Prepare a legal matter handoff with current status, background, key decisions, unresolved issues, risk flags, deadlines, approval notes, and recommended next steps.",
      },
    ],
  },
  {
    id: "hr",
    title: "HR",
    packs: [
      {
        id: "hr-policy-summary",
        title: "Policy summary",
        description: "Turn HR policy material into a clear employee-facing summary with actions and exceptions.",
        workflow_id: "hr_policy_review",
        actionLabel: "Summarize",
        focus: "Summarize the selected HR policy material for employees, including rules, eligibility, exceptions, required actions, deadlines, and escalation paths.",
      },
      {
        id: "hr-onboarding-guide",
        title: "Onboarding guide",
        description: "Create a practical onboarding guide from policies, role docs, and internal resources.",
        workflow_id: "hr_onboarding_pack",
        actionLabel: "Guide",
        focus: "Create an onboarding guide with role context, first-week priorities, key policies, important resources, glossary, and recommended first reading.",
      },
      {
        id: "hr-policy-rollout-plan",
        title: "Policy rollout plan",
        description: "Convert HR policy changes into a rollout plan with owners, communication steps, and checkpoints.",
        workflow_id: "hr_employee_handoff",
        actionLabel: "Plan",
        focus: "Create a policy rollout plan with priorities, owners, timelines, blockers, communications, required employee actions, and follow-up checkpoints.",
      },
    ],
  },
  {
    id: "accounting",
    title: "Accounting",
    packs: [
      {
        id: "accounting-invoice-extraction",
        title: "Invoice extraction",
        description: "Extract invoice details, payment terms, tax details, categories, and missing information.",
        workflow_id: "accounting_invoice_extraction",
        actionLabel: "Extract",
        focus: "Extract vendors, invoice numbers, dates, amounts, payment terms, tax details, categories, exceptions, and missing information.",
      },
      {
        id: "accounting-close-checklist",
        title: "Close checklist",
        description: "Create a month-end close checklist from accounting docs, notes, and open items.",
        workflow_id: "accounting_month_end_close",
        actionLabel: "Checklist",
        focus: "Create a month-end close checklist with required reconciliations, owners, deadlines, dependencies, open questions, and review checkpoints.",
      },
      {
        id: "accounting-variance-brief",
        title: "Variance brief",
        description: "Summarize material financial changes, anomalies, assumptions, and decisions needed.",
        workflow_id: "accounting_budget_variance",
        actionLabel: "Brief",
        focus: "Create a finance variance brief with material changes, notable transactions, anomalies, risks, assumptions, and decisions needed.",
      },
    ],
  },
  {
    id: "compliance",
    title: "Compliance",
    packs: [
      {
        id: "compliance-evidence-gap-check",
        title: "Evidence gap check",
        description: "Review control evidence and identify missing proof, exceptions, owners, and remediation needs.",
        workflow_id: "compliance_evidence_summary",
        actionLabel: "Check",
        focus: "Extract control requirements, evidence provided, evidence gaps, responsible owners, risks, exceptions, and remediation items.",
      },
      {
        id: "compliance-policy-gap-check",
        title: "Policy gap check",
        description: "Compare compliance materials and surface missing controls, changed requirements, and implementation gaps.",
        workflow_id: "compliance_gap_review",
        actionLabel: "Compare",
        focus: "Compare these compliance materials for policy gaps, changed requirements, missing controls, exceptions, and implementation risks.",
      },
      {
        id: "compliance-remediation-plan",
        title: "Remediation plan",
        description: "Turn compliance findings into a prioritized action plan with owners, dates, and evidence needs.",
        workflow_id: "compliance_risk_register",
        actionLabel: "Plan",
        focus: "Create a compliance remediation plan with prioritized findings, owners, target dates, dependencies, evidence needed, and escalation points.",
      },
    ],
  },
  {
    id: "procurement",
    title: "Procurement",
    packs: [
      {
        id: "procurement-vendor-review",
        title: "Vendor review",
        description: "Summarize vendor materials with commercial terms, obligations, risks, and next steps.",
        workflow_id: "procurement_vendor_review",
        actionLabel: "Review",
        focus: "Review the selected vendor and procurement materials for commercial terms, obligations, service commitments, dependencies, risks, open questions, and recommended next steps.",
      },
      {
        id: "procurement-renewal-risk-check",
        title: "Renewal risk check",
        description: "Extract renewal dates, auto-renewal language, notice windows, price changes, and cancellation risks.",
        workflow_id: "procurement_renewal_risk",
        actionLabel: "Check",
        focus: "Extract renewal dates, auto-renewal terms, notice windows, cancellation rights, price changes, service obligations, owner follow-ups, and renewal risk flags.",
      },
      {
        id: "procurement-sla-extraction",
        title: "SLA extraction",
        description: "Extract service levels, support obligations, credits, exclusions, and escalation paths.",
        workflow_id: "procurement_sla_extraction",
        actionLabel: "Extract",
        focus: "Extract service levels, uptime commitments, response times, support obligations, service credits, exclusions, reporting requirements, escalation paths, and risk flags.",
      },
    ],
  },
  {
    id: "operations",
    title: "Operations",
    packs: [
      {
        id: "operations-sop-review",
        title: "SOP Review",
        description: "Review operating procedures for clarity, gaps, handoffs, risks, and owner-ready improvements.",
        workflow_id: "operations_sop_builder",
        actionLabel: "Review",
        focus: "Review the selected operating procedures for clarity, gaps, handoffs, dependencies, risks, owner responsibilities, and recommended improvements.",
      },
      {
        id: "operations-incident-handoff",
        title: "Incident Handoff",
        description: "Prepare a clear handoff summary with status, impact, decisions, open issues, owners, and next steps.",
        workflow_id: "operations_incident_review",
        actionLabel: "Handoff",
        focus: "Prepare an incident handoff with current status, impact, decisions made, open issues, owners, risks, and next steps.",
      },
      {
        id: "operations-process-improvement-plan",
        title: "Process Improvement Plan",
        description: "Turn operational notes into prioritized improvements, owners, blockers, and milestones.",
        workflow_id: "operations_process_improvement",
        actionLabel: "Plan",
        focus: "Create a process improvement plan with prioritized improvements, owners, blockers, dependencies, milestones, and review checkpoints.",
      },
    ],
  },
];

export const PRO_PACK_LIBRARY_VIEW = {
  visibleGroupIds: ["legal"],
  showGroupLabels: false,
} as const;

export function getVisibleProPackGroups(groups: ProPackGroup[] = PRO_PACK_GROUPS): ProPackGroup[] {
  const visibleGroupIds = new Set<string>(PRO_PACK_LIBRARY_VIEW.visibleGroupIds);
  return groups.filter((group) => visibleGroupIds.has(group.id));
}

export function buildProPackInputs(group: ProPackGroup, pack: ProPackItem): Record<string, unknown> {
  return {
    pro_pack: {
      group_id: group.id,
      group_title: group.title,
      pack_id: pack.id,
      pack_title: pack.title,
      action_label: pack.actionLabel,
    },
  };
}

export function getProPackCount(groups = PRO_PACK_GROUPS) {
  return groups.reduce((total, group) => total + group.packs.length, 0);
}
