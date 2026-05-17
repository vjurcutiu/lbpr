import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CornerDownRight, FileText, History, Scale, SlidersHorizontal } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FileItem } from "@/features/files/api";
import { cn } from "@/lib/utils";

import type { WorkflowChainSource, WorkflowLauncherField, WorkflowLauncherFieldOption, WorkflowManifest, WorkflowSelection } from "../types";
import { getWorkflowSelectionMessage, isWorkflowSelectionValid, summarizeWorkflowSelection, type WorkflowSelectionSummary } from "../utils/selection";
import { WorkflowFilePicker } from "./WorkflowFilePicker";

type Props = {
  open: boolean;
  workflow: WorkflowManifest | null;
  selection: WorkflowSelectionSummary;
  selectionMode?: "fixed" | "picker";
  availableFiles?: FileItem[];
  filesLoading?: boolean;
  submitting?: boolean;
  initialInputs?: Record<string, unknown>;
  chainSource?: WorkflowChainSource | null;
  onOpenChange: (open: boolean) => void;
  onRun: (workflow: WorkflowManifest, inputs: Record<string, unknown>, selection: WorkflowSelection) => void;
  onBack?: () => void;
};

type LegalCustomFieldKind = "select" | "text" | "textarea" | "chips";

type LegalCustomField = {
  key: string;
  label: string;
  kind: LegalCustomFieldKind;
  placeholder?: string;
  helper?: string;
  defaultValue?: string;
  options?: WorkflowLauncherFieldOption[];
};

type LegalWorkflowUiConfig = {
  focusLabel: string;
  focusPlaceholder: string;
  focusHelp: string;
  settingsTitle: string;
  hiddenInputs?: Record<string, string>;
  fieldKeys?: string[];
  customFields?: LegalCustomField[];
  suggestionLabel?: string;
  lockedBadges?: Array<{ label: string; value: string }>;
};

const LEGAL_FIELD_ORDER = ["document_type", "review_mode", "counterparty_position", "risk_tolerance"];

const COMMON_CLAUSE_OPTIONS: WorkflowLauncherFieldOption[] = [
  { value: "confidentiality", label: "Confidentiality" },
  { value: "indemnity", label: "Indemnity" },
  { value: "limitation_of_liability", label: "Limitation of Liability" },
  { value: "termination", label: "Termination" },
  { value: "renewal", label: "Renewal" },
  { value: "ip_ownership", label: "IP Ownership" },
  { value: "data_protection", label: "Data Protection" },
  { value: "payment", label: "Payment" },
  { value: "assignment", label: "Assignment" },
  { value: "audit", label: "Audit" },
  { value: "insurance", label: "Insurance" },
  { value: "notices", label: "Notices" },
];

const LEGAL_WORKFLOW_UI: Record<string, LegalWorkflowUiConfig> = {
  legal_contract_review: {
    focusLabel: "Anything specific to focus on?",
    focusPlaceholder: "Liability exposure, renewal risk, missing protections, approval issues…",
    focusHelp: "Optional. Add business context, concerns, audience, or sections that deserve closer attention.",
    settingsTitle: "Review settings",
    fieldKeys: ["document_type", "review_mode", "counterparty_position", "risk_tolerance"],
    customFields: [
      {
        key: "deal_stage",
        label: "Deal stage",
        kind: "select",
        defaultValue: "not_specified",
        options: [
          { value: "not_specified", label: "Not specified" },
          { value: "intake", label: "Initial review" },
          { value: "negotiation", label: "Negotiation" },
          { value: "approval", label: "Approval" },
          { value: "signature", label: "Ready for signature" },
        ],
      },
      {
        key: "review_audience",
        label: "Audience",
        kind: "select",
        defaultValue: "business_owner",
        options: [
          { value: "business_owner", label: "Business owner" },
          { value: "legal_team", label: "Legal team" },
          { value: "executive", label: "Executive" },
          { value: "sales_or_customer_team", label: "Sales / customer team" },
        ],
      },
    ],
  },
  legal_contract_risk_matrix: {
    focusLabel: "Matrix purpose",
    focusPlaceholder: "Approval decision, negotiation priorities, high-severity issues, exec summary…",
    focusHelp: "Optional. Tell the matrix what decision it should support.",
    settingsTitle: "Matrix settings",
    fieldKeys: ["document_type", "review_mode", "risk_tolerance"],
    customFields: [
      {
        key: "matrix_purpose",
        label: "Purpose",
        kind: "select",
        defaultValue: "approval",
        options: [
          { value: "approval", label: "Approval" },
          { value: "negotiation", label: "Negotiation" },
          { value: "executive_summary", label: "Executive summary" },
          { value: "internal_legal_review", label: "Internal legal review" },
        ],
      },
      {
        key: "risk_owners",
        label: "Owner lens",
        kind: "chips",
        defaultValue: "legal,business_owner",
        options: [
          { value: "legal", label: "Legal" },
          { value: "business_owner", label: "Business owner" },
          { value: "finance", label: "Finance" },
          { value: "security", label: "Security" },
          { value: "operations", label: "Operations" },
        ],
      },
    ],
  },
  legal_nda_review: {
    focusLabel: "Anything specific to check?",
    focusPlaceholder: "Residual knowledge, one-way terms, confidentiality period, sensitive data, return duties…",
    focusHelp: "Optional. The NDA review already checks the standard NDA risk areas.",
    settingsTitle: "NDA settings",
    hiddenInputs: { document_type: "nda" },
    lockedBadges: [{ label: "Document type", value: "NDA" }],
    fieldKeys: ["review_mode", "counterparty_position", "risk_tolerance"],
    customFields: [
      {
        key: "nda_direction",
        label: "NDA type",
        kind: "select",
        defaultValue: "not_specified",
        options: [
          { value: "not_specified", label: "Not specified" },
          { value: "mutual", label: "Mutual" },
          { value: "one_way_receiving", label: "One-way: we receive" },
          { value: "one_way_disclosing", label: "One-way: we disclose" },
        ],
      },
      {
        key: "confidentiality_term_preference",
        label: "Term preference",
        kind: "select",
        defaultValue: "standard",
        options: [
          { value: "standard", label: "Use standard position" },
          { value: "short_term", label: "Shorter term preferred" },
          { value: "long_term", label: "Longer protection preferred" },
          { value: "avoid_perpetual", label: "Avoid perpetual terms" },
        ],
      },
      {
        key: "nda_special_flags",
        label: "Extra checks",
        kind: "chips",
        defaultValue: "residuals,sensitive_data",
        options: [
          { value: "residuals", label: "Residuals" },
          { value: "sensitive_data", label: "Sensitive data" },
          { value: "non_solicit", label: "Non-solicit" },
          { value: "injunctive_relief", label: "Injunctive relief" },
          { value: "return_destruction", label: "Return/destruction" },
        ],
      },
    ],
  },
  legal_msa_review: {
    focusLabel: "Anything specific to check?",
    focusPlaceholder: "Liability, indemnity, IP, payment, data protection, SLAs, renewal, termination…",
    focusHelp: "Optional. The MSA review already checks key commercial, legal, and operational terms.",
    settingsTitle: "MSA settings",
    hiddenInputs: { document_type: "msa_services" },
    lockedBadges: [{ label: "Document type", value: "MSA / services agreement" }],
    fieldKeys: ["review_mode", "counterparty_position", "risk_tolerance"],
    customFields: [
      {
        key: "agreement_side",
        label: "Our role",
        kind: "select",
        defaultValue: "not_specified",
        options: [
          { value: "not_specified", label: "Not specified" },
          { value: "customer_client", label: "Customer / client" },
          { value: "vendor_provider", label: "Vendor / provider" },
        ],
      },
      {
        key: "msa_deal_stage",
        label: "Deal stage",
        kind: "select",
        defaultValue: "negotiation",
        options: [
          { value: "intake", label: "Initial review" },
          { value: "negotiation", label: "Negotiation" },
          { value: "approval", label: "Approval" },
          { value: "renewal", label: "Renewal" },
        ],
      },
      {
        key: "msa_priority_areas",
        label: "Priority areas",
        kind: "chips",
        defaultValue: "liability,indemnity,ip_ownership,data_protection,termination",
        options: COMMON_CLAUSE_OPTIONS.filter((option) => ["limitation_of_liability", "indemnity", "ip_ownership", "data_protection", "payment", "termination", "renewal", "audit", "insurance"].includes(option.value)),
      },
    ],
  },
  legal_clause_extraction: {
    focusLabel: "What should be extracted?",
    focusPlaceholder: "Specific clause families, deadlines, parties, obligations, fallback positions…",
    focusHelp: "Optional. Use this to narrow the extraction beyond the selected settings.",
    settingsTitle: "Extraction settings",
    fieldKeys: ["document_type"],
    customFields: [
      {
        key: "clause_families",
        label: "Clause families",
        kind: "chips",
        defaultValue: "confidentiality,limitation_of_liability,termination,renewal,ip_ownership,data_protection,payment",
        options: COMMON_CLAUSE_OPTIONS,
      },
      {
        key: "extraction_depth",
        label: "Output format",
        kind: "select",
        defaultValue: "table_with_notes",
        options: [
          { value: "table_with_notes", label: "Table with notes" },
          { value: "brief", label: "Brief" },
          { value: "checklist", label: "Checklist" },
        ],
      },
      {
        key: "include_extraction_items",
        label: "Include",
        kind: "chips",
        defaultValue: "obligations,dates,parties,deadlines,fallback_positions",
        options: [
          { value: "obligations", label: "Obligations" },
          { value: "dates", label: "Dates" },
          { value: "parties", label: "Parties" },
          { value: "deadlines", label: "Deadlines" },
          { value: "fallback_positions", label: "Fallback positions" },
        ],
      },
    ],
  },
  legal_fallback_language: {
    focusLabel: "Fallback request",
    focusPlaceholder: "Which clause or risk needs fallback language? What position should the language protect?",
    focusHelp: "Describe the clause, target position, or concern. The output will be drafted as practical fallback language.",
    settingsTitle: "Drafting settings",
    hiddenInputs: { review_mode: "negotiation" },
    fieldKeys: ["document_type", "counterparty_position", "risk_tolerance"],
    customFields: [
      {
        key: "target_clause",
        label: "Target clause or issue",
        kind: "text",
        placeholder: "Limitation of Liability, residuals, IP Ownership, renewal notice…",
      },
      {
        key: "fallback_output_type",
        label: "Output type",
        kind: "select",
        defaultValue: "clause_language",
        options: [
          { value: "clause_language", label: "Clause language" },
          { value: "comment_ready_note", label: "Comment-ready note" },
          { value: "fallback_ladder", label: "Fallback ladder" },
          { value: "email_ready_note", label: "Email-ready note" },
        ],
      },
      {
        key: "desired_position",
        label: "Desired position",
        kind: "textarea",
        placeholder: "What outcome should this language preserve?",
      },
    ],
  },
  legal_negotiation_brief: {
    focusLabel: "Negotiation objective",
    focusPlaceholder: "Close quickly, reduce liability, preserve IP Ownership, protect data, escalate approval issues…",
    focusHelp: "Optional. Describe what the negotiation brief should help the team accomplish.",
    settingsTitle: "Negotiation settings",
    hiddenInputs: { review_mode: "negotiation" },
    fieldKeys: ["document_type", "counterparty_position", "risk_tolerance"],
    customFields: [
      {
        key: "negotiation_posture",
        label: "Posture",
        kind: "select",
        defaultValue: "balanced",
        options: [
          { value: "firm", label: "Firm" },
          { value: "balanced", label: "Balanced" },
          { value: "collaborative", label: "Collaborative" },
        ],
      },
      {
        key: "brief_audience",
        label: "Audience",
        kind: "select",
        defaultValue: "business_owner",
        options: [
          { value: "legal_team", label: "Legal team" },
          { value: "business_owner", label: "Business owner" },
          { value: "executive", label: "Executive" },
          { value: "customer_team", label: "Customer team" },
        ],
      },
      {
        key: "negotiation_priorities",
        label: "Priorities",
        kind: "chips",
        defaultValue: "liability,indemnity,ip_ownership,data_protection,termination",
        options: [
          { value: "close_fast", label: "Close fast" },
          { value: "liability", label: "Reduce liability" },
          { value: "indemnity", label: "Indemnity" },
          { value: "ip_ownership", label: "Protect IP" },
          { value: "data_protection", label: "Protect data" },
          { value: "termination", label: "Termination" },
          { value: "commercial_terms", label: "Commercial terms" },
        ],
      },
    ],
  },
  legal_obligation_tracker: {
    focusLabel: "Tracking instructions",
    focusPlaceholder: "Renewal windows, notice periods, payment duties, reporting duties, owner handoffs…",
    focusHelp: "Optional. Add any teams, deadlines, or operational areas that matter for the tracker.",
    settingsTitle: "Tracker settings",
    hiddenInputs: { review_mode: "approval" },
    fieldKeys: ["document_type", "counterparty_position"],
    customFields: [
      {
        key: "tracking_stage",
        label: "Tracking stage",
        kind: "select",
        defaultValue: "post_signature",
        options: [
          { value: "pre_signature", label: "Pre-signature" },
          { value: "post_signature", label: "Post-signature" },
          { value: "renewal", label: "Renewal" },
        ],
      },
      {
        key: "obligation_scope",
        label: "Track",
        kind: "chips",
        defaultValue: "renewal_notice,payment,reporting,data_security,insurance,audit",
        options: [
          { value: "renewal_notice", label: "Renewal / notice" },
          { value: "payment", label: "Payment" },
          { value: "reporting", label: "Reporting" },
          { value: "data_security", label: "Data/security" },
          { value: "insurance", label: "Insurance" },
          { value: "audit", label: "Audit" },
          { value: "termination", label: "Termination" },
        ],
      },
      {
        key: "owner_mapping",
        label: "Owner mapping",
        kind: "text",
        placeholder: "Legal, finance, security, sales ops, customer success…",
      },
    ],
  },
  legal_matter_handoff: {
    focusLabel: "Handoff focus",
    focusPlaceholder: "Open issues, decisions made, deadlines, risks, approval notes, next steps…",
    focusHelp: "Optional. Add recipient, matter stage, or unresolved items that should be highlighted.",
    settingsTitle: "Handoff settings",
    hiddenInputs: { review_mode: "executive_summary" },
    fieldKeys: ["document_type", "counterparty_position", "risk_tolerance"],
    customFields: [
      {
        key: "handoff_recipient",
        label: "Recipient",
        kind: "select",
        defaultValue: "business_owner",
        options: [
          { value: "legal_reviewer", label: "Legal reviewer" },
          { value: "business_owner", label: "Business owner" },
          { value: "executive", label: "Executive" },
          { value: "outside_counsel", label: "Outside counsel" },
          { value: "sales_customer_team", label: "Sales / customer team" },
        ],
      },
      {
        key: "matter_stage",
        label: "Matter stage",
        kind: "select",
        defaultValue: "negotiation",
        options: [
          { value: "intake", label: "Intake" },
          { value: "negotiation", label: "Negotiation" },
          { value: "approval", label: "Approval" },
          { value: "signature", label: "Signature" },
          { value: "post_signature", label: "Post-signature" },
        ],
      },
      {
        key: "handoff_emphasis",
        label: "Emphasize",
        kind: "chips",
        defaultValue: "open_issues,risks,deadlines,next_steps",
        options: [
          { value: "context", label: "Context" },
          { value: "decisions", label: "Decisions" },
          { value: "open_issues", label: "Open issues" },
          { value: "risks", label: "Risks" },
          { value: "deadlines", label: "Deadlines" },
          { value: "approvals", label: "Approvals" },
          { value: "next_steps", label: "Next steps" },
        ],
      },
    ],
  },
};

function workflowUiConfig(workflow: WorkflowManifest | null): LegalWorkflowUiConfig {
  return (workflow && LEGAL_WORKFLOW_UI[workflow.workflow_id]) || {
    focusLabel: workflow?.launcher.prompt_label || "Anything specific to focus on?",
    focusPlaceholder: workflow?.launcher.prompt_placeholder || "Add any specific context, concerns, audience, or output preferences.",
    focusHelp: "Optional. Add context that should shape the workflow output.",
    settingsTitle: "Review settings",
    fieldKeys: LEGAL_FIELD_ORDER,
  };
}

function optionLabel(options: WorkflowLauncherFieldOption[] | undefined, value: string) {
  return options?.find((option) => option.value === value)?.label || value.replace(/_/g, " ");
}

function selectedOptionDescription(field: WorkflowLauncherField, value: string) {
  return field.options.find((option) => option.value === value)?.description || "";
}

function cleanValue(value: unknown) {
  return String(value || "").trim();
}

function orderedLegalFields(workflow: WorkflowManifest | null, config: LegalWorkflowUiConfig): WorkflowLauncherField[] {
  const allowedKeys = new Set(config.fieldKeys || LEGAL_FIELD_ORDER);
  const hiddenKeys = new Set(Object.keys(config.hiddenInputs || {}));
  const fields = (workflow?.launcher.fields ?? []).filter((field) => allowedKeys.has(field.key) && !hiddenKeys.has(field.key));
  return [...fields].sort((a, b) => {
    const aIndex = LEGAL_FIELD_ORDER.indexOf(a.key);
    const bIndex = LEGAL_FIELD_ORDER.indexOf(b.key);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
}

function defaultFieldValues(
  workflow: WorkflowManifest | null,
  config: LegalWorkflowUiConfig,
  initialInputs?: Record<string, unknown>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of orderedLegalFields(workflow, config)) {
    const seeded = cleanValue(initialInputs?.[field.key]);
    const fallback = seeded || field.default_value || field.options[0]?.value || "";
    if (fallback) values[field.key] = fallback;
  }
  return values;
}

function defaultCustomValues(config: LegalWorkflowUiConfig, initialInputs?: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of config.customFields || []) {
    const seeded = cleanValue(initialInputs?.[field.key]);
    const fallback = seeded || field.defaultValue || "";
    if (fallback) values[field.key] = fallback;
  }
  return values;
}

function defaultFocus(initialInputs?: Record<string, unknown>) {
  return cleanValue(initialInputs?.focus);
}

function defaultMatterContext(initialInputs?: Record<string, unknown>) {
  return cleanValue(initialInputs?.matter_context);
}

function passthroughInitialInputs(
  initialInputs: Record<string, unknown> | undefined,
  workflow: WorkflowManifest | null,
  config: LegalWorkflowUiConfig,
): Record<string, unknown> {
  const reservedKeys = new Set([
    "focus",
    "matter_context",
    "workflow_chain",
    ...Object.keys(config.hiddenInputs || {}),
    ...(workflow?.launcher.fields ?? []).map((field) => field.key),
    ...(config.customFields || []).map((field) => field.key),
  ]);

  return Object.fromEntries(
    Object.entries(initialInputs || {}).filter(([key, value]) => {
      if (reservedKeys.has(key)) return false;
      if (value == null) return false;
      if (typeof value === "string") return !!value.trim();
      return true;
    }),
  );
}

function formatRelativeTime(iso?: string) {
  if (!iso) return "recently";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";

  const diffMs = date.getTime() - Date.now();
  const minutes = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  return rtf.format(days, "day");
}

function workflowKicker(workflow: WorkflowManifest | null) {
  if (!workflow) return "Legal workflow";
  if (workflow.workflow_id.includes("nda")) return "NDA review";
  if (workflow.workflow_id.includes("msa")) return "Agreement review";
  if (workflow.workflow_id.includes("risk_matrix")) return "Risk matrix";
  if (workflow.workflow_id.includes("negotiation")) return "Negotiation plan";
  if (workflow.workflow_id.includes("obligation")) return "Obligation tracker";
  if (workflow.workflow_id.includes("fallback")) return "Fallback drafting";
  if (workflow.workflow_id.includes("handoff")) return "Matter handoff";
  if (workflow.workflow_id.includes("extraction")) return "Clause extraction";
  return "Legal review";
}

function selectedLauncherFieldLabel(field: WorkflowLauncherField, value: string) {
  const option = field.options.find((item) => item.value === value);
  return option?.label || value.replace(/_/g, " ");
}

function legalHeaderSummaryItems(
  fields: WorkflowLauncherField[],
  fieldValues: Record<string, string>,
  customFields: LegalCustomField[],
  customValues: Record<string, string>,
  selectionLabel: string,
) {
  const items = [selectionLabel].filter(Boolean);

  for (const field of fields) {
    if (!["document_type", "review_mode", "risk_tolerance"].includes(field.key)) continue;
    const value = fieldValues[field.key] || field.default_value || field.options[0]?.value || "";
    if (value) items.push(selectedLauncherFieldLabel(field, value));
    if (items.length >= 4) return items;
  }

  for (const field of customFields) {
    if (!["deal_stage", "review_audience", "matrix_purpose", "agreement_side", "nda_direction", "brief_audience"].includes(field.key)) continue;
    const value = customValues[field.key] || field.defaultValue || "";
    if (value) items.push(optionLabel(field.options, value));
    if (items.length >= 4) return items;
  }

  return items;
}

function workflowReadyStatus(canRun: boolean, activeSelection: WorkflowSelectionSummary, selectionMessage: string) {
  if (!canRun) return selectionMessage;
  if (activeSelection.fileCount > 0) {
    return `Ready to run on ${activeSelection.fileCount} file${activeSelection.fileCount === 1 ? "" : "s"}`;
  }
  return "Ready to run";
}

function chipValues(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toggleChipValue(value: string, nextValue: string) {
  const current = chipValues(value);
  const exists = current.includes(nextValue);
  return (exists ? current.filter((item) => item !== nextValue) : [...current, nextValue]).join(",");
}

function customFieldSummary(field: LegalCustomField, value: string) {
  const clean = value.trim();
  if (!clean) return "";
  if (field.kind === "chips") {
    const labels = chipValues(clean).map((item) => optionLabel(field.options, item));
    return labels.length ? `${field.label}: ${labels.join(", ")}` : "";
  }
  if (field.kind === "select") return `${field.label}: ${optionLabel(field.options, clean)}`;
  return `${field.label}: ${clean}`;
}

function composeFocus({
  userFocus,
  matterContext,
  customFields,
  customValues,
}: {
  userFocus: string;
  matterContext: string;
  customFields: LegalCustomField[];
  customValues: Record<string, string>;
}) {
  const parts: string[] = [];
  const focus = userFocus.trim();
  if (focus) parts.push(focus);
  const matter = matterContext.trim();
  if (matter) parts.push(`Matter context: ${matter}`);

  const summaries = customFields
    .map((field) => customFieldSummary(field, customValues[field.key] || ""))
    .filter(Boolean);
  if (summaries.length) parts.push(`Workflow settings: ${summaries.join("; ")}.`);

  return parts.join("\n\n").trim();
}

function renderCustomField(
  field: LegalCustomField,
  value: string,
  setValue: (value: string) => void,
  submitting: boolean,
) {
  if (field.kind === "select") {
    return (
      <Select value={value || field.defaultValue || ""} onValueChange={setValue} disabled={submitting}>
        <SelectTrigger className="rounded-2xl">
          <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {(field.options || []).map((option) => (
            <SelectItem key={`${field.key}-${option.value}`} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.kind === "textarea") {
    return (
      <Textarea
        rows={4}
        placeholder={field.placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={submitting}
      />
    );
  }

  if (field.kind === "chips") {
    const activeValues = chipValues(value);
    return (
      <div className="flex flex-wrap gap-2">
        {(field.options || []).map((option) => {
          const active = activeValues.includes(option.value);
          return (
            <Button
              key={`${field.key}-${option.value}`}
              type="button"
              variant="outline"
              size="sm"
              className={cn("rounded-full", active && "border-primary/40 bg-primary/10 text-primary")}
              onClick={() => setValue(toggleChipValue(value, option.value))}
              disabled={submitting}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    );
  }

  return (
    <Input
      placeholder={field.placeholder}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      disabled={submitting}
      className="rounded-2xl"
    />
  );
}

export function LegalWorkflowLauncher({
  open,
  workflow,
  selection,
  selectionMode = "fixed",
  availableFiles = [],
  filesLoading = false,
  submitting = false,
  initialInputs,
  chainSource,
  onOpenChange,
  onRun,
  onBack,
}: Props) {
  const config = useMemo(() => workflowUiConfig(workflow), [workflow]);
  const [focus, setFocus] = useState(() => defaultFocus(initialInputs));
  const [matterContext, setMatterContext] = useState(() => defaultMatterContext(initialInputs));
  const [editableSelection, setEditableSelection] = useState<WorkflowSelection>(selection);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => defaultFieldValues(workflow, config, initialInputs));
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => defaultCustomValues(config, initialInputs));
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    setFocus(defaultFocus(initialInputs));
    setMatterContext(defaultMatterContext(initialInputs));
    setEditableSelection(selection);
    setFieldValues(defaultFieldValues(workflow, config, initialInputs));
    setCustomValues(defaultCustomValues(config, initialInputs));
    setActiveStep(0);
  }, [open, selection, workflow, selectionMode, initialInputs, config]);

  const fields = useMemo(() => orderedLegalFields(workflow, config), [workflow, config]);
  const customFields = config.customFields || [];
  const suggestions = useMemo(() => workflow?.launcher.suggested_prompts ?? [], [workflow]);
  const activeSelection = selectionMode === "picker" ? summarizeWorkflowSelection(editableSelection) : selection;
  const selectionMessage = workflow ? getWorkflowSelectionMessage(workflow, activeSelection) : "Select a workflow.";
  const canRun = !!workflow && isWorkflowSelectionValid(workflow, activeSelection) && !(selectionMode === "picker" && filesLoading);
  const hasSettings = fields.length > 0 || customFields.length > 0 || !!config.lockedBadges?.length;
  const headerSummaryItems = legalHeaderSummaryItems(fields, fieldValues, customFields, customValues, activeSelection.label);
  const footerStatus = workflowReadyStatus(canRun, activeSelection, selectionMessage);
  const stepItems = useMemo(
    () => [
      { key: "source", label: "Source" },
      { key: "context", label: "Context" },
      ...(hasSettings ? [{ key: "settings", label: "Settings" }] : []),
    ],
    [hasSettings],
  );
  const currentStepIndex = Math.min(activeStep, Math.max(stepItems.length - 1, 0));
  const currentStepKey = stepItems[currentStepIndex]?.key || "source";
  const isLastStep = currentStepIndex >= stepItems.length - 1;

  const goToStep = (index: number) => {
    setActiveStep(Math.max(0, Math.min(index, stepItems.length - 1)));
  };

  const handleCancel = () => {
    if (onBack) {
      onBack();
      return;
    }
    onOpenChange(false);
  };

  const submitWorkflow = () => {
    if (!workflow) return;
    const submittedFocus = composeFocus({
      userFocus: focus,
      matterContext,
      customFields,
      customValues,
    });
    const cleanedFields = Object.fromEntries(Object.entries(fieldValues).filter(([, value]) => cleanValue(value)));
    const cleanedCustomFields = Object.fromEntries(Object.entries(customValues).filter(([, value]) => cleanValue(value)));

    onRun(
      workflow,
      {
        ...passthroughInitialInputs(initialInputs, workflow, config),
        ...(config.hiddenInputs || {}),
        ...cleanedFields,
        ...cleanedCustomFields,
        ...(submittedFocus ? { focus: submittedFocus } : {}),
        ...(matterContext.trim() ? { matter_context: matterContext.trim() } : {}),
      },
      activeSelection,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-[2rem] p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.045] px-5 pb-4 pt-5 pr-14 sm:px-6 sm:pr-14">
          <div className="space-y-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                <Scale className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-primary/20 bg-background/80 text-[11px] font-medium text-primary">
                    {workflowKicker(workflow)}
                  </Badge>
                  {headerSummaryItems.map((item, index) => (
                    <Badge key={`${item}-${index}`} variant="outline" className="rounded-full bg-background/70 text-[11px] font-normal text-muted-foreground">
                      {item}
                    </Badge>
                  ))}
                </div>
                <DialogTitle className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
                  {workflow?.title ?? "Legal workflow"}
                </DialogTitle>
                <DialogDescription className="max-w-3xl text-sm leading-6">
                  {workflow?.description ?? "Choose legal materials and workflow settings."}
                </DialogDescription>
              </div>
            </div>

            <div className={cn("grid gap-2", hasSettings ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
              {stepItems.map((step, index) => {
                const active = index === currentStepIndex;
                const complete = index < currentStepIndex;
                return (
                  <button
                    key={step.key}
                    type="button"
                    className={cn(
                      "group flex min-w-0 items-center gap-2 rounded-2xl border px-3 py-2 text-left text-xs transition",
                      active
                        ? "border-primary/35 bg-primary/10 text-primary shadow-sm"
                        : "border-border/70 bg-background/70 text-muted-foreground hover:border-primary/20 hover:bg-background hover:text-foreground",
                    )}
                    onClick={() => goToStep(index)}
                    disabled={submitting}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                        active || complete ? "border-primary/30 bg-primary text-primary-foreground" : "border-border bg-muted/40 text-muted-foreground",
                      )}
                    >
                      {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className="truncate font-medium">{step.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 px-5 py-5 sm:px-6">
          <div className="mx-auto flex min-h-0 w-full max-w-3xl">
            {currentStepKey === "source" ? (
              <section className="flex min-h-0 w-full flex-col rounded-3xl border border-border/80 bg-background/85 p-5 shadow-sm backdrop-blur-sm sm:p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/30 text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/75">Step 1</div>
                      <h3 className="text-base font-semibold">Source material</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Choose the files this workflow should review.
                      </p>
                    </div>
                  </div>
                  <Badge variant={canRun ? "default" : "outline"} className="rounded-full">
                    {canRun ? "Ready" : "Needs files"}
                  </Badge>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {chainSource ? (
                    <div className="rounded-3xl border border-primary/15 bg-primary/5 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">
                        <CornerDownRight className="h-3.5 w-3.5" />
                        Built from {chainSource.parent_workflow_title}
                        {chainSource.action_label ? (
                          <Badge variant="outline" className="rounded-full border-primary/20 bg-background px-2 py-0 text-[10px] font-normal text-foreground">
                            {chainSource.action_label}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="rounded-full">{chainSource.parent_title}</Badge>
                        {chainSource.selection_label ? <Badge variant="outline" className="rounded-full">{chainSource.selection_label}</Badge> : null}
                        <Badge variant="outline" className="rounded-full">
                          <History className="mr-1 h-3 w-3" />
                          Updated {formatRelativeTime(chainSource.parent_updated_at)}
                        </Badge>
                      </div>
                      {chainSource.summary ? (
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-foreground/85">{chainSource.summary}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {selectionMode === "picker" ? (
                    <WorkflowFilePicker
                      files={availableFiles}
                      selection={editableSelection}
                      loading={filesLoading}
                      disabled={submitting}
                      onSelectionChange={setEditableSelection}
                    />
                  ) : (
                    <div className="rounded-2xl border border-border/70 bg-muted/15 px-3 py-3">
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="rounded-full">{activeSelection.label}</Badge>
                        {activeSelection.current_folder ? (
                          <Badge variant="outline" className="rounded-full">Folder: {activeSelection.current_folder}</Badge>
                        ) : null}
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    {selectionMessage}
                  </div>
                </div>
              </section>
            ) : null}

            {currentStepKey === "context" ? (
              <section className="flex min-h-0 w-full flex-col rounded-3xl border border-border/80 bg-background/85 p-5 shadow-sm backdrop-blur-sm sm:p-6">
                <div className="mb-5 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/30 text-primary">
                    <Scale className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/75">Step 2</div>
                    <h3 className="text-base font-semibold">Review context</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Add business context or narrow the review without changing the workflow.
                    </p>
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Matter context</label>
                    <Input
                      placeholder="Counterparty, deal stage, reviewer, jurisdiction, or approval context"
                      value={matterContext}
                      onChange={(event) => setMatterContext(event.target.value)}
                      disabled={submitting}
                      className="rounded-2xl bg-background/90"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">{config.focusLabel}</label>
                    <Textarea
                      rows={5}
                      placeholder={config.focusPlaceholder}
                      value={focus}
                      onChange={(event) => setFocus(event.target.value)}
                      disabled={submitting}
                      className="min-h-[128px] rounded-2xl bg-background/90"
                    />
                    <p className="text-xs leading-5 text-muted-foreground">{config.focusHelp}</p>
                  </div>

                  {!!suggestions.length && (
                    <div className="rounded-2xl border border-border/70 bg-muted/10 p-3">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {config.suggestionLabel || "Common focuses"}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {suggestions.map((suggestion) => {
                          const active = focus === suggestion;
                          return (
                            <Button
                              key={suggestion}
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn("rounded-full bg-background/80", active && "border-primary/40 bg-primary/10 text-primary")}
                              onClick={() => setFocus(suggestion)}
                              disabled={submitting}
                            >
                              {suggestion}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {currentStepKey === "settings" && hasSettings ? (
              <section className="flex min-h-0 w-full flex-col rounded-3xl border border-border/80 bg-background/85 p-5 shadow-sm backdrop-blur-sm sm:p-6">
                <div className="mb-5 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/30 text-primary">
                    <SlidersHorizontal className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/75">Step 3</div>
                    <h3 className="text-base font-semibold">{config.settingsTitle}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Tune how this workflow reads the material and shapes the output.
                    </p>
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {!!config.lockedBadges?.length && (
                    <div className="flex flex-wrap gap-2">
                      {config.lockedBadges.map((badge) => (
                        <Badge key={`${badge.label}-${badge.value}`} variant="secondary" className="rounded-full px-2 py-1 text-[11px] font-normal">
                          {badge.label}: {badge.value}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {fields.map((field) => {
                    const value = fieldValues[field.key] || field.default_value || field.options[0]?.value || "";
                    const description = selectedOptionDescription(field, value);
                    return (
                      <div key={field.key} className="space-y-2">
                        <label className="text-sm font-medium">{field.label}</label>
                        <Select
                          value={value}
                          onValueChange={(nextValue) => setFieldValues((prev) => ({ ...prev, [field.key]: nextValue }))}
                          disabled={submitting}
                        >
                          <SelectTrigger className="rounded-2xl bg-background/90">
                            <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((option) => (
                              <SelectItem key={`${field.key}-${option.value}`} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
                      </div>
                    );
                  })}

                  {customFields.map((field) => (
                    <div key={field.key} className="space-y-2">
                      <label className="text-sm font-medium">{field.label}</label>
                      {renderCustomField(
                        field,
                        customValues[field.key] || field.defaultValue || "",
                        (nextValue) => setCustomValues((prev) => ({ ...prev, [field.key]: nextValue })),
                        submitting,
                      )}
                      {field.helper ? <p className="text-xs leading-5 text-muted-foreground">{field.helper}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-col items-stretch justify-between gap-3 border-t border-border/70 bg-background/75 px-5 py-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
            <CheckCircle2 className={cn("h-4 w-4 shrink-0", canRun ? "text-primary" : "text-muted-foreground/70")} />
            <span className="truncate">{footerStatus}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" className="rounded-full" onClick={handleCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => goToStep(currentStepIndex - 1)} disabled={submitting || currentStepIndex === 0}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
            {!isLastStep ? (
              <Button className="rounded-full px-5" onClick={() => goToStep(currentStepIndex + 1)} disabled={submitting}>
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button className="rounded-full px-5" onClick={submitWorkflow} disabled={!canRun || submitting}>
                {workflow?.launcher.submit_label ?? "Run workflow"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
