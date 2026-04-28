import type { WorkflowManifest } from "./types";

export type ProPackItem = {
  id: string;
  title: string;
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
        title: "Contract review",
        workflow_id: "summarize_documents",
        actionLabel: "Review",
        focus: "Review the selected legal documents for key terms, obligations, deadlines, risks, fallback positions, and open questions.",
      },
      {
        id: "legal-clause-extraction",
        title: "Clause extraction",
        workflow_id: "extract_information",
        actionLabel: "Extract",
        focus: "Extract parties, effective dates, renewal terms, termination rights, governing law, liability caps, assignment language, confidentiality terms, approvals, and risk flags.",
      },
      {
        id: "legal-matter-brief",
        title: "Matter brief",
        workflow_id: "generate_report",
        actionLabel: "Brief",
        focus: "Create a legal matter brief with background, material facts, key documents, risks, decisions needed, and recommended next steps.",
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
        workflow_id: "summarize_documents",
        actionLabel: "Summarize",
        focus: "Summarize the selected HR policy material for employees, including rules, eligibility, exceptions, required actions, deadlines, and escalation paths.",
      },
      {
        id: "hr-onboarding-guide",
        title: "Onboarding guide",
        workflow_id: "generate_report",
        actionLabel: "Guide",
        focus: "Create an onboarding guide with role context, first-week priorities, key policies, important resources, glossary, and recommended first reading.",
      },
      {
        id: "hr-process-plan",
        title: "People operations plan",
        workflow_id: "create_action_plan",
        actionLabel: "Plan",
        focus: "Create a people operations action plan with priorities, owners, timelines, blockers, communications, and follow-up checkpoints.",
      },
    ],
  },
  {
    id: "accounting",
    title: "Accounting",
    packs: [
      {
        id: "accounting-expense-extraction",
        title: "Expense extraction",
        workflow_id: "extract_information",
        actionLabel: "Extract",
        focus: "Extract vendors, invoice numbers, dates, amounts, payment terms, tax details, categories, exceptions, and missing information.",
      },
      {
        id: "accounting-close-checklist",
        title: "Close checklist",
        workflow_id: "create_action_plan",
        actionLabel: "Checklist",
        focus: "Create a month-end close checklist with required reconciliations, owners, deadlines, dependencies, open questions, and review checkpoints.",
      },
      {
        id: "accounting-finance-brief",
        title: "Finance brief",
        workflow_id: "generate_report",
        actionLabel: "Brief",
        focus: "Create a finance brief with material changes, notable transactions, risks, anomalies, assumptions, and decisions needed.",
      },
    ],
  },
  {
    id: "compliance",
    title: "Compliance",
    packs: [
      {
        id: "compliance-control-review",
        title: "Control review",
        workflow_id: "extract_information",
        actionLabel: "Review",
        focus: "Extract control requirements, evidence provided, evidence gaps, responsible owners, risks, exceptions, and remediation items.",
      },
      {
        id: "compliance-policy-gap-check",
        title: "Policy gap check",
        workflow_id: "compare_documents",
        actionLabel: "Compare",
        focus: "Compare these compliance materials for policy gaps, changed requirements, missing controls, exceptions, and implementation risks.",
      },
      {
        id: "compliance-remediation-plan",
        title: "Remediation plan",
        workflow_id: "create_action_plan",
        actionLabel: "Plan",
        focus: "Create a compliance remediation plan with prioritized findings, owners, target dates, dependencies, evidence needed, and escalation points.",
      },
    ],
  },
  {
    id: "sales",
    title: "Sales",
    packs: [
      {
        id: "sales-account-brief",
        title: "Account brief",
        workflow_id: "summarize_documents",
        actionLabel: "Brief",
        focus: "Create an account brief with customer context, stakeholders, pains, buying signals, objections, risks, and recommended next steps.",
      },
      {
        id: "sales-proposal-draft",
        title: "Proposal draft",
        workflow_id: "draft_from_sources",
        actionLabel: "Draft",
        focus: "Draft a customer-facing proposal using the selected source material, with problem statement, recommended solution, value, scope, assumptions, and next steps.",
      },
      {
        id: "sales-handoff-summary",
        title: "Handoff summary",
        workflow_id: "generate_report",
        actionLabel: "Handoff",
        focus: "Create a sales-to-delivery handoff summary with customer goals, promised scope, stakeholders, risks, open questions, timelines, and success criteria.",
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
