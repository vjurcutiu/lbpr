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
        id: "legal-contract-risk-review",
        title: "Contract risk review",
        description: "Find key terms, obligations, deadlines, and legal risk signals in selected contract materials.",
        workflow_id: "summarize_documents",
        actionLabel: "Review",
        focus: "Review the selected legal documents for key terms, obligations, deadlines, risks, fallback positions, and open questions. Prioritize concrete issues the user can act on.",
      },
      {
        id: "legal-compare-to-standard",
        title: "Compare to standard",
        description: "Compare a contract against a standard, template, or prior version and surface material deviations.",
        workflow_id: "compare_documents",
        actionLabel: "Compare",
        focus: "Compare the selected legal documents against each other as a contract-to-standard review. Identify material deviations, missing protections, changed obligations, commercial/legal risk, and recommended follow-up questions.",
      },
      {
        id: "legal-clause-extraction",
        title: "Clause extraction",
        description: "Extract important clauses, dates, parties, renewal terms, approvals, and risk flags.",
        workflow_id: "extract_information",
        actionLabel: "Extract",
        focus: "Extract parties, effective dates, renewal terms, termination rights, governing law, liability caps, assignment language, confidentiality terms, approvals, and risk flags.",
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
        workflow_id: "summarize_documents",
        actionLabel: "Summarize",
        focus: "Summarize the selected HR policy material for employees, including rules, eligibility, exceptions, required actions, deadlines, and escalation paths.",
      },
      {
        id: "hr-onboarding-guide",
        title: "Onboarding guide",
        description: "Create a practical onboarding guide from policies, role docs, and internal resources.",
        workflow_id: "generate_report",
        actionLabel: "Guide",
        focus: "Create an onboarding guide with role context, first-week priorities, key policies, important resources, glossary, and recommended first reading.",
      },
      {
        id: "hr-policy-rollout-plan",
        title: "Policy rollout plan",
        description: "Convert HR policy changes into a rollout plan with owners, communication steps, and checkpoints.",
        workflow_id: "create_action_plan",
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
        workflow_id: "extract_information",
        actionLabel: "Extract",
        focus: "Extract vendors, invoice numbers, dates, amounts, payment terms, tax details, categories, exceptions, and missing information.",
      },
      {
        id: "accounting-close-checklist",
        title: "Close checklist",
        description: "Create a month-end close checklist from accounting docs, notes, and open items.",
        workflow_id: "create_action_plan",
        actionLabel: "Checklist",
        focus: "Create a month-end close checklist with required reconciliations, owners, deadlines, dependencies, open questions, and review checkpoints.",
      },
      {
        id: "accounting-variance-brief",
        title: "Variance brief",
        description: "Summarize material financial changes, anomalies, assumptions, and decisions needed.",
        workflow_id: "generate_report",
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
        workflow_id: "extract_information",
        actionLabel: "Check",
        focus: "Extract control requirements, evidence provided, evidence gaps, responsible owners, risks, exceptions, and remediation items.",
      },
      {
        id: "compliance-policy-gap-check",
        title: "Policy gap check",
        description: "Compare compliance materials and surface missing controls, changed requirements, and implementation gaps.",
        workflow_id: "compare_documents",
        actionLabel: "Compare",
        focus: "Compare these compliance materials for policy gaps, changed requirements, missing controls, exceptions, and implementation risks.",
      },
      {
        id: "compliance-remediation-plan",
        title: "Remediation plan",
        description: "Turn compliance findings into a prioritized action plan with owners, dates, and evidence needs.",
        workflow_id: "create_action_plan",
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
        workflow_id: "summarize_documents",
        actionLabel: "Review",
        focus: "Review the selected vendor and procurement materials for commercial terms, obligations, service commitments, dependencies, risks, open questions, and recommended next steps.",
      },
      {
        id: "procurement-renewal-risk-check",
        title: "Renewal risk check",
        description: "Extract renewal dates, auto-renewal language, notice windows, price changes, and cancellation risks.",
        workflow_id: "extract_information",
        actionLabel: "Check",
        focus: "Extract renewal dates, auto-renewal terms, notice windows, cancellation rights, price changes, service obligations, owner follow-ups, and renewal risk flags.",
      },
      {
        id: "procurement-sla-extraction",
        title: "SLA extraction",
        description: "Extract service levels, support obligations, credits, exclusions, and escalation paths.",
        workflow_id: "extract_information",
        actionLabel: "Extract",
        focus: "Extract service levels, uptime commitments, response times, support obligations, service credits, exclusions, reporting requirements, escalation paths, and risk flags.",
      },
    ],
  },
];

export function buildProPackInputs(group: ProPackGroup, pack: ProPackItem): Record<string, unknown> {
  return {
    focus: pack.focus,
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
