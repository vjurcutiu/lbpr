import { useEffect, useMemo, useState } from "react";
import { Scale, BriefcaseBusiness, CornerDownRight, FileCheck2, History, ShieldCheck } from "lucide-react";

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
}: Props) {
  const config = useMemo(() => workflowUiConfig(workflow), [workflow]);
  const [focus, setFocus] = useState(() => defaultFocus(initialInputs));
  const [matterContext, setMatterContext] = useState(() => defaultMatterContext(initialInputs));
  const [editableSelection, setEditableSelection] = useState<WorkflowSelection>(selection);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => defaultFieldValues(workflow, config, initialInputs));
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => defaultCustomValues(config, initialInputs));

  useEffect(() => {
    setFocus(defaultFocus(initialInputs));
    setMatterContext(defaultMatterContext(initialInputs));
    setEditableSelection(selection);
    setFieldValues(defaultFieldValues(workflow, config, initialInputs));
    setCustomValues(defaultCustomValues(config, initialInputs));
  }, [open, selection, workflow, selectionMode, initialInputs, config]);

  const fields = useMemo(() => orderedLegalFields(workflow, config), [workflow, config]);
  const customFields = config.customFields || [];
  const suggestions = useMemo(() => workflow?.launcher.suggested_prompts ?? [], [workflow]);
  const activeSelection = selectionMode === "picker" ? summarizeWorkflowSelection(editableSelection) : selection;
  const selectionMessage = workflow ? getWorkflowSelectionMessage(workflow, activeSelection) : "Select a workflow.";
  const canRun = !!workflow && isWorkflowSelectionValid(workflow, activeSelection) && !(selectionMode === "picker" && filesLoading);
  const hasSettings = fields.length > 0 || customFields.length > 0 || !!config.lockedBadges?.length;

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
      <DialogContent className="flex w-[calc(100vw-2rem)] max-w-5xl max-h-[calc(100vh-2rem)] flex-col overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b bg-gradient-to-br from-background via-background to-primary/5 px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border bg-primary/5 text-primary shadow-sm">
                <Scale className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-primary/20 bg-background/80 text-[11px] text-primary">
                    {workflowKicker(workflow)}
                  </Badge>
                  <Badge variant="outline" className="rounded-full bg-background/80 text-[11px] text-muted-foreground">
                    {activeSelection.label}
                  </Badge>
                </div>
                <DialogTitle className="text-xl">{workflow?.title ?? "Legal workflow"}</DialogTitle>
                <DialogDescription className="max-w-2xl leading-6">
                  {workflow?.description ?? "Choose legal materials and workflow settings."}
                </DialogDescription>
              </div>
            </div>

            <div className="grid min-w-[220px] grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
              <div className="rounded-2xl border bg-background/80 px-2 py-2">
                <FileCheck2 className="mx-auto mb-1 h-4 w-4 text-primary" />
                Sources
              </div>
              <div className="rounded-2xl border bg-background/80 px-2 py-2">
                <ShieldCheck className="mx-auto mb-1 h-4 w-4 text-primary" />
                Settings
              </div>
              <div className="rounded-2xl border bg-background/80 px-2 py-2">
                <BriefcaseBusiness className="mx-auto mb-1 h-4 w-4 text-primary" />
                Output
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
            <div className="space-y-4">
              {chainSource ? (
                <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
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
              ) : null}

              <div className="rounded-2xl border bg-muted/15 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Selection</div>
                  <Badge variant={canRun ? "default" : "outline"} className="rounded-full">
                    {canRun ? "Ready" : "Needs files"}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="rounded-full">{activeSelection.label}</Badge>
                  {activeSelection.current_folder ? (
                    <Badge variant="outline" className="rounded-full">Folder: {activeSelection.current_folder}</Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{selectionMessage}</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Matter context</label>
                <Input
                  placeholder="Counterparty, deal stage, reviewer, jurisdiction, or approval context"
                  value={matterContext}
                  onChange={(event) => setMatterContext(event.target.value)}
                  disabled={submitting}
                  className="rounded-2xl"
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
                />
                <p className="text-xs text-muted-foreground">{config.focusHelp}</p>
              </div>
            </div>

            <div className="space-y-4">
              {hasSettings ? (
                <div className="rounded-3xl border bg-background p-4 shadow-sm">
                  <div className="mb-3 text-sm font-semibold">{config.settingsTitle}</div>
                  {!!config.lockedBadges?.length && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {config.lockedBadges.map((badge) => (
                        <Badge key={`${badge.label}-${badge.value}`} variant="secondary" className="rounded-full px-2 py-1 text-[11px] font-normal">
                          {badge.label}: {badge.value}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="space-y-4">
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
                            <SelectTrigger className="rounded-2xl">
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
                </div>
              ) : null}

              {!!suggestions.length && (
                <div className="rounded-3xl border bg-muted/10 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
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
                          className={cn("rounded-full", active && "border-primary/40 bg-primary/10 text-primary")}
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
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={submitWorkflow} disabled={!canRun || submitting}>
            {workflow?.launcher.submit_label ?? "Run workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
