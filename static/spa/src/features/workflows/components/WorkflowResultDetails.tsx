import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Circle, Copy, Crosshair, Download, Files, GitBranch, History, Maximize2, PencilLine, RefreshCw, RotateCcw, Save, SendHorizontal, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { MarkdownRichEditor, type MarkdownEditorSelection } from "./MarkdownRichEditor";
import { workflowDocumentMarkdown } from "../utils/workflowMarkdown";

import type { WorkflowAiPartialEditRequest, WorkflowAiPartialEditResponse, WorkflowArtifactFormat, WorkflowEditSaveMode, WorkflowEditSaveOptions, WorkflowArtifactSummary, WorkflowResult, WorkflowRun, WorkflowRunVersion, WorkflowSelection, WorkflowSuggestedAction } from "../types";

type SourceFileMeta = {
  file_id?: string;
  name?: string;
  folder_path?: string | null;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatSourceLabel(source: SourceFileMeta) {
  const base = String(source.name || source.file_id || "Source file").replace(" — retrieved evidence", "").trim();
  return source.folder_path ? `${base} · ${source.folder_path}` : base;
}

function compactSelectionPreview(value: string, max = 900) {
  const text = String(value || "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function sourceIdentity(source: SourceFileMeta) {
  return String(source.file_id || source.name || "").trim();
}

function uniqueSourceFiles(sources: SourceFileMeta[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = sourceIdentity(source);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function versionKindLabel(version: WorkflowRunVersion) {
  if (version.kind === "original") return "Original";
  if (version.kind === "branch") return "Branch";
  if (version.kind === "edit") return "Edited";
  return "Refined";
}

function versionLabel(version: WorkflowRunVersion) {
  return `V${version.version_number || 1}`;
}

function sortedVersions(versions: WorkflowRunVersion[]) {
  return [...(versions || [])].sort((a, b) => (a.version_number || 0) - (b.version_number || 0));
}

function versionDepth(version: WorkflowRunVersion, versions: WorkflowRunVersion[]) {
  const byId = new Map(versions.map((item) => [item.id, item]));
  let depth = 0;
  let cursor = version.parent_version_id || "";
  const seen = new Set<string>();
  while (cursor && byId.has(cursor) && !seen.has(cursor) && depth < 8) {
    seen.add(cursor);
    depth += 1;
    cursor = byId.get(cursor)?.parent_version_id || "";
  }
  return depth;
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Files; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}


type LegalMetadataItem = Record<string, unknown>;

const LEGAL_PROSE_TEXT_CLASS = "min-w-0 whitespace-pre-wrap break-words [overflow-wrap:break-word]";

function metadataText(item: LegalMetadataItem, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = item[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      const joined = value.map((entry) => String(entry || "").trim()).filter(Boolean).join(", ");
      if (joined) return joined;
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }
  return fallback;
}

function humanizeMetadataValue(value: unknown) {
  const text = String(value || "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Not specified";
}

const LEGAL_CLAUSE_TYPE_LABELS: Record<string, string> = {
  assignment: "Assignment",
  audit: "Audit",
  confidentiality: "Confidentiality",
  data_protection: "Data Protection",
  dispute_resolution: "Dispute Resolution",
  exclusivity: "Exclusivity",
  force_majeure: "Force Majeure",
  governing_law: "Governing Law",
  indemnity: "Indemnity",
  insurance: "Insurance",
  ip_ownership: "IP Ownership",
  intellectual_property: "Intellectual Property",
  limitation_of_liability: "Limitation of Liability",
  non_compete: "Non-Compete",
  non_solicit: "Non-Solicit",
  notices: "Notices",
  payment: "Payment",
  renewal: "Renewal",
  residuals: "Residuals",
  service_levels: "Service Levels",
  termination: "Termination",
  warranties: "Warranties",
};

function normalizeClauseTypeKey(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function formatClauseTypeLabel(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "Not specified";
  return LEGAL_CLAUSE_TYPE_LABELS[normalizeClauseTypeKey(raw)] || humanizeMetadataValue(raw);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LEGAL_CLAUSE_TOKEN_PATTERN = new RegExp(
  `\\b(${Object.keys(LEGAL_CLAUSE_TYPE_LABELS).sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})\\b`,
  "gi",
);

function formatLegalClauseTokensInText(text: string) {
  return String(text || "").replace(LEGAL_CLAUSE_TOKEN_PATTERN, (match) => {
    return LEGAL_CLAUSE_TYPE_LABELS[normalizeClauseTypeKey(match)] || match;
  });
}


function topMetadataItems(value: unknown, max = 5): LegalMetadataItem[] {
  return asArray<LegalMetadataItem>(value).filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, max);
}

function textList(value: unknown, max = 5) {
  return asArray<unknown>(value)
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function hasMetadataItems(value: unknown) {
  return topMetadataItems(value, 1).length > 0;
}

function workflowMetadata(metadata: Record<string, unknown>) {
  return metadata.workflow_profile && typeof metadata.workflow_profile === "object" && !Array.isArray(metadata.workflow_profile)
    ? metadata.workflow_profile as LegalMetadataItem
    : {};
}

function isLegalResult(result: WorkflowResult) {
  const metadata = result.metadata || {};
  const profile = workflowMetadata(metadata);
  return (
    metadata.pack_id === "legal" ||
    profile.pack_id === "legal" ||
    !!metadata.legal_profile ||
    hasMetadataItems(metadata.risk_items) ||
    hasMetadataItems(metadata.clause_items) ||
    hasMetadataItems(metadata.obligation_items) ||
    hasMetadataItems(metadata.fallback_items) ||
    hasMetadataItems(metadata.plan_items) ||
    hasMetadataItems(metadata.fields)
  );
}

function LegalProseSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-border/70 pt-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold leading-6 text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function LegalParagraph({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className={cn("min-w-0 text-sm leading-6 text-foreground/90", LEGAL_PROSE_TEXT_CLASS)}>
      <span className="font-semibold text-foreground">{label}:</span> {formatLegalClauseTokensInText(value)}
    </div>
  );
}

function LegalInlineDetails({ items }: { items: Array<{ label: string; value?: string }> }) {
  const visibleItems = items.filter((item) => item.value);
  if (!visibleItems.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleItems.map((item) => (
        <Badge key={`${item.label}-${item.value}`} variant="secondary" className="rounded-full px-2.5 py-1 text-[11px] font-medium">
          {item.label}: {humanizeMetadataValue(item.value)}
        </Badge>
      ))}
    </div>
  );
}

function LegalItemHeading({ children }: { children: ReactNode }) {
  return <div className={cn("min-w-0 text-sm font-semibold leading-6 text-foreground", LEGAL_PROSE_TEXT_CLASS)}>{children}</div>;
}

function LegalProseItem({ children }: { children: ReactNode }) {
  return <div className="min-w-0 border-t border-border/60 first:border-t-0">{children}</div>;
}

function compactLegalText(value: string, max = 180) {
  const text = formatLegalClauseTokensInText(String(value || "").replace(/\s+/g, " ").trim());
  if (!text) return "Not specified";
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function severityRank(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "critical") return 5;
  if (key === "high") return 4;
  if (key === "medium") return 3;
  if (key === "low") return 2;
  return 1;
}

function severityBadgeClass(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "critical") return "border-destructive/40 bg-destructive/10 text-destructive";
  if (key === "high") return "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300";
  if (key === "medium") return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (key === "low") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  return "border-border bg-muted text-muted-foreground";
}

function priorityBadgeClass(value: unknown) {
  return severityBadgeClass(value);
}

function LegalBadge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  const label = typeof children === "string" ? children : title;
  return (
    <Badge
      variant="outline"
      title={label}
      className={cn("max-w-full min-w-0 shrink overflow-hidden rounded-full px-2.5 py-0.5 text-left text-[11px] font-semibold", className)}
    >
      <span className="min-w-0 truncate">{children}</span>
    </Badge>
  );
}

function LegalRowDetails({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 border-t border-border/60 bg-muted/10 px-4 py-3 md:grid-cols-2">{children}</div>;
}

function LegalDashboardRow({
  badge,
  title,
  subtitle,
  recommendation,
  children,
}: {
  badge?: ReactNode;
  title: string;
  subtitle?: string;
  recommendation?: string;
  children?: ReactNode;
}) {
  return (
    <LegalProseItem>
      <details className="group min-w-0">
        <summary className="grid cursor-pointer list-none gap-3 px-4 py-3 transition hover:bg-muted/40 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_1.25rem] md:items-center [&::-webkit-details-marker]:hidden">
          <div className="flex min-w-0 items-start gap-2.5">
            {badge ? <div className="mt-0.5 min-w-0 max-w-[9.5rem] shrink sm:max-w-[10.5rem] md:max-w-[12rem]">{badge}</div> : null}
            <div className="min-w-0 flex-1">
              <LegalItemHeading>{title}</LegalItemHeading>
              {subtitle ? <p className="mt-0.5 min-w-0 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{compactLegalText(subtitle, 140)}</p> : null}
            </div>
          </div>
          {recommendation ? (
            <p className="min-w-0 break-words text-sm leading-6 text-foreground/80 [overflow-wrap:anywhere]">{compactLegalText(recommendation, 170)}</p>
          ) : <span className="hidden md:block" />}
          <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
        </summary>
        {children ? <LegalRowDetails>{children}</LegalRowDetails> : null}
      </details>
    </LegalProseItem>
  );
}

function LegalProfileProse({ profile }: { profile: LegalMetadataItem }) {
  const profileItems = [
    { label: "Document", value: metadataText(profile, ["document_type_label", "document_type"]) },
    { label: "Mode", value: metadataText(profile, ["review_mode_label", "review_mode"]) },
    { label: "Counterparty", value: metadataText(profile, ["counterparty_position_label", "counterparty_position"]) },
    { label: "Risk", value: metadataText(profile, ["risk_tolerance_label", "risk_tolerance"]) },
  ];

  if (!profileItems.some((item) => item.value)) return null;
  return (
    <LegalProseSection title="Review profile">
      <LegalInlineDetails items={profileItems} />
    </LegalProseSection>
  );
}

function severitySummary(items: LegalMetadataItem[]) {
  const counts = items.reduce<Record<string, number>>((current, item) => {
    const severity = humanizeMetadataValue(metadataText(item, ["severity", "risk_level"], "review"));
    current[severity] = (current[severity] || 0) + 1;
    return current;
  }, {});

  return Object.entries(counts).sort((a, b) => severityRank(b[0]) - severityRank(a[0]));
}

function RiskItemsProse({ items }: { items: LegalMetadataItem[] }) {
  if (!items.length) return null;
  const orderedItems = [...items].sort((a, b) => severityRank(metadataText(b, ["severity", "risk_level"])) - severityRank(metadataText(a, ["severity", "risk_level"])));

  return (
    <LegalProseSection title="Key risks">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {severitySummary(items).map(([severity, count]) => (
          <LegalBadge key={severity} className={severityBadgeClass(severity)}>{count} {severity}</LegalBadge>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
        {orderedItems.map((item, index) => {
          const issue = metadataText(item, ["issue", "title", "risk"], "Risk item");
          const severity = metadataText(item, ["severity", "risk_level"], "review");
          const clause = metadataText(item, ["clause_family", "clause", "category"]);
          const impact = metadataText(item, ["business_impact", "impact"]);
          const recommendation = metadataText(item, ["recommended_change", "recommendation", "recommended_fix"]);
          const fallback = metadataText(item, ["fallback", "acceptable_fallback", "fallback_position"]);
          const source = metadataText(item, ["source_basis", "source", "evidence"]);
          const humanReview = item.requires_human_review === true;
          return (
            <LegalDashboardRow
              key={`${issue}-${index}`}
              badge={<LegalBadge className={severityBadgeClass(severity)}>{humanizeMetadataValue(severity)}</LegalBadge>}
              title={issue}
              subtitle={clause ? formatClauseTypeLabel(clause) : undefined}
              recommendation={recommendation}
            >
              <LegalParagraph label="Impact" value={impact} />
              <LegalParagraph label="Fallback" value={fallback} />
              <LegalParagraph label="Source basis" value={source} />
              {humanReview ? <LegalParagraph label="Review" value="Needs approval before relying on this position." /> : null}
            </LegalDashboardRow>
          );
        })}
      </div>
    </LegalProseSection>
  );
}

function ClauseItemsProse({ items }: { items: LegalMetadataItem[] }) {
  if (!items.length) return null;
  return (
    <LegalProseSection title="Clause review">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
        {items.map((item, index) => {
          const clause = metadataText(item, ["clause_family", "clause", "field"], "Clause");
          const currentPosition = metadataText(item, ["current_position", "position", "value", "summary"]);
          const concern = metadataText(item, ["concern", "source_basis"]);
          const recommendation = metadataText(item, ["recommended_position", "recommended_change", "value"]);
          const source = metadataText(item, ["source_basis", "source", "evidence"]);
          const confidence = metadataText(item, ["confidence"]);
          return (
            <LegalDashboardRow
              key={`${clause}-${index}`}
              badge={<LegalBadge>{formatClauseTypeLabel(clause)}</LegalBadge>}
              title={concern || currentPosition || "Review source language."}
              subtitle={currentPosition}
              recommendation={recommendation || "Confirm preferred position."}
            >
              <LegalParagraph label="Source basis" value={source} />
              <LegalParagraph label="Confidence" value={confidence ? humanizeMetadataValue(confidence) : ""} />
            </LegalDashboardRow>
          );
        })}
      </div>
    </LegalProseSection>
  );
}

function ObligationItemsProse({ items }: { items: LegalMetadataItem[] }) {
  if (!items.length) return null;
  return (
    <LegalProseSection title="Obligations">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
        {items.map((item, index) => {
          const obligation = metadataText(item, ["obligation", "action", "field"], "Obligation");
          const party = metadataText(item, ["responsible_party", "owner"], "TBD");
          const deadline = metadataText(item, ["trigger_or_deadline", "deadline", "timeline"], "TBD");
          const followUp = metadataText(item, ["follow_up", "recommendation", "value"]);
          const source = metadataText(item, ["source_basis", "source", "evidence"]);
          return (
            <LegalDashboardRow
              key={`${obligation}-${index}`}
              badge={<LegalBadge>{party}</LegalBadge>}
              title={obligation}
              subtitle={`Trigger/deadline: ${deadline}`}
              recommendation={followUp}
            >
              <LegalParagraph label="Source basis" value={source} />
            </LegalDashboardRow>
          );
        })}
      </div>
    </LegalProseSection>
  );
}

function FieldItemsProse({ items }: { items: LegalMetadataItem[] }) {
  if (!items.length) return null;
  return (
    <LegalProseSection title="Extracted details">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
        {items.map((item, index) => {
          const field = metadataText(item, ["field", "name", "label"], "Extracted detail");
          const value = metadataText(item, ["value", "current_position", "text", "summary"]);
          const source = metadataText(item, ["source_basis", "source", "evidence"]);
          const confidence = metadataText(item, ["confidence"], "review");
          return (
            <LegalDashboardRow
              key={`${field}-${index}`}
              badge={<LegalBadge>{humanizeMetadataValue(field)}</LegalBadge>}
              title={value || "Confirm against source material."}
              recommendation={source || "Not available"}
            >
              <LegalParagraph label="Confidence" value={humanizeMetadataValue(confidence)} />
            </LegalDashboardRow>
          );
        })}
      </div>
    </LegalProseSection>
  );
}

function FallbackItemsProse({ items }: { items: LegalMetadataItem[] }) {
  if (!items.length) return null;
  return (
    <LegalProseSection title="Fallback language">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
        {items.map((item, index) => {
          const clause = metadataText(item, ["clause_family", "clause", "category"], "Clause");
          const proposedLanguage = metadataText(item, ["proposed_language", "language", "clause_language", "fallback_language", "draft", "text"]);
          const rationale = metadataText(item, ["rationale", "reason", "explanation", "business_impact"]);
          const source = metadataText(item, ["source_basis", "source", "evidence"]);
          const confidence = metadataText(item, ["confidence"], "review");
          return (
            <LegalDashboardRow
              key={`${clause}-${index}`}
              badge={<LegalBadge>{formatClauseTypeLabel(clause)}</LegalBadge>}
              title={proposedLanguage || "Proposed fallback language"}
              recommendation={rationale}
            >
              <LegalParagraph label="Source basis" value={source} />
              <LegalParagraph label="Confidence" value={humanizeMetadataValue(confidence)} />
            </LegalDashboardRow>
          );
        })}
      </div>
    </LegalProseSection>
  );
}

function PlanItemsProse({ items }: { items: LegalMetadataItem[] }) {
  if (!items.length) return null;
  return (
    <LegalProseSection title="Action plan">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
        {items.map((item, index) => {
          const action = metadataText(item, ["action", "item", "change", "task"], "Confirm negotiation position");
          const priority = metadataText(item, ["priority"], "medium");
          const owner = metadataText(item, ["owner", "responsible_party"], "TBD");
          const timeline = metadataText(item, ["timeline", "deadline"], "TBD");
          const clause = metadataText(item, ["related_clause_family", "clause_family", "clause"]);
          return (
            <LegalDashboardRow
              key={`${action}-${index}`}
              badge={<LegalBadge className={priorityBadgeClass(priority)}>{humanizeMetadataValue(priority)}</LegalBadge>}
              title={`${index + 1}. ${action}`}
              subtitle={clause ? formatClauseTypeLabel(clause) : undefined}
              recommendation={`Owner: ${owner} · Timeline: ${timeline}`}
            >
              <LegalParagraph label="Owner" value={owner} />
              <LegalParagraph label="Timeline" value={timeline} />
            </LegalDashboardRow>
          );
        })}
      </div>
    </LegalProseSection>
  );
}

function NotesProseSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <LegalProseSection title={title}>
      <div className="grid gap-2 md:grid-cols-2">
        {items.slice(0, 6).map((item, index) => (
          <div key={`${title}-${index}`} className="flex min-w-0 gap-2 rounded-2xl border border-border/70 bg-background px-3 py-2.5 text-sm leading-6 text-foreground/90">
            <Circle className="mt-2 h-1.5 w-1.5 shrink-0 fill-current text-muted-foreground" />
            <span className={LEGAL_PROSE_TEXT_CLASS}>{formatLegalClauseTokensInText(item)}</span>
          </div>
        ))}
      </div>
    </LegalProseSection>
  );
}

function legalDashboardTitle(workflowId: string) {
  const titles: Record<string, string> = {
    legal_contract_review: "Contract review snapshot",
    legal_contract_risk_matrix: "Risk matrix snapshot",
    legal_nda_review: "NDA review snapshot",
    legal_msa_review: "MSA review snapshot",
    legal_clause_extraction: "Clause extraction snapshot",
    legal_fallback_language: "Fallback language snapshot",
    legal_negotiation_brief: "Negotiation brief snapshot",
    legal_obligation_tracker: "Obligation tracker snapshot",
    legal_matter_handoff: "Matter handoff snapshot",
  };
  return titles[workflowId] || "Review snapshot";
}

function LegalDashboardHeader({
  workflowId,
  riskItems,
  clauseItems,
  obligationItems,
  fallbackItems,
  planItems,
  fieldItems,
  openQuestions,
  approvalNotes,
}: {
  workflowId: string;
  riskItems: LegalMetadataItem[];
  clauseItems: LegalMetadataItem[];
  obligationItems: LegalMetadataItem[];
  fallbackItems: LegalMetadataItem[];
  planItems: LegalMetadataItem[];
  fieldItems: LegalMetadataItem[];
  openQuestions: string[];
  approvalNotes: string[];
}) {
  const highRiskCount = riskItems.filter((item) => severityRank(metadataText(item, ["severity", "risk_level"])) >= 4).length;
  const stats = [
    riskItems.length ? { label: "Risks", value: String(riskItems.length) } : null,
    highRiskCount ? { label: "High priority", value: String(highRiskCount) } : null,
    clauseItems.length ? { label: "Clauses", value: String(clauseItems.length) } : null,
    obligationItems.length ? { label: "Obligations", value: String(obligationItems.length) } : null,
    fallbackItems.length ? { label: "Fallbacks", value: String(fallbackItems.length) } : null,
    planItems.length ? { label: "Actions", value: String(planItems.length) } : null,
    fieldItems.length ? { label: "Details", value: String(fieldItems.length) } : null,
    approvalNotes.length ? { label: "Approval items", value: String(approvalNotes.length) } : null,
    openQuestions.length ? { label: "Open questions", value: String(openQuestions.length) } : null,
  ].filter(Boolean).slice(0, 5) as Array<{ label: string; value: string }>;

  if (!stats.length) return null;

  return (
    <div className="rounded-3xl border border-border/70 bg-muted/15 px-4 py-4 md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Review dashboard</p>
          <h2 className="mt-1 text-lg font-semibold leading-7 text-foreground">{legalDashboardTitle(workflowId)}</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-right shadow-sm">
              <div className="text-base font-semibold leading-5 text-foreground">{stat.value}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegalFullOutputDivider() {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="h-px flex-1 bg-border/70" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Full output</span>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );
}

function LegalMetadataSummary({ result }: { result: WorkflowResult }) {
  if (!isLegalResult(result)) return null;
  const metadata = result.metadata || {};
  const workflow = workflowMetadata(metadata);
  const workflowId = String(workflow.workflow_id || metadata.workflow_id || "").trim();

  if (workflowId === "legal_contract_risk_matrix") {
    return null;
  }
  const rawProfile = metadata.legal_profile && typeof metadata.legal_profile === "object" && !Array.isArray(metadata.legal_profile)
    ? metadata.legal_profile as LegalMetadataItem
    : {};
  const profile: LegalMetadataItem = { ...workflow, ...rawProfile };
  const riskItems = topMetadataItems(metadata.risk_items, 8);
  const clauseItems = topMetadataItems(metadata.clause_items, 8);
  const obligationItems = topMetadataItems(metadata.obligation_items, 8);
  const fallbackItems = topMetadataItems(metadata.fallback_items, 6);
  const planItems = topMetadataItems(metadata.plan_items, 8);
  const fieldItems = topMetadataItems(metadata.fields, 10);
  const showFieldItems = fieldItems.length > 0 && (
    workflowId === "legal_clause_extraction" || (!clauseItems.length && !obligationItems.length && !fallbackItems.length && !planItems.length)
  );
  const openQuestions = textList(metadata.open_questions);
  const approvalNotes = textList(metadata.approval_notes);

  if (
    !Object.keys(profile).length &&
    !riskItems.length &&
    !clauseItems.length &&
    !obligationItems.length &&
    !fallbackItems.length &&
    !planItems.length &&
    !showFieldItems &&
    !openQuestions.length &&
    !approvalNotes.length
  ) {
    return null;
  }

  return (
    <div className="mb-8 min-w-0 space-y-6 border-b border-border/70 pb-8">
      <LegalDashboardHeader
        workflowId={workflowId}
        riskItems={riskItems}
        clauseItems={clauseItems}
        obligationItems={obligationItems}
        fallbackItems={fallbackItems}
        planItems={planItems}
        fieldItems={showFieldItems ? fieldItems : []}
        openQuestions={openQuestions}
        approvalNotes={approvalNotes}
      />
      <LegalProfileProse profile={profile} />
      <RiskItemsProse items={riskItems} />
      <ObligationItemsProse items={obligationItems} />
      <FallbackItemsProse items={fallbackItems} />
      <PlanItemsProse items={planItems} />
      <ClauseItemsProse items={clauseItems} />
      {showFieldItems ? <FieldItemsProse items={fieldItems} /> : null}
      <NotesProseSection title="Approval checklist" items={approvalNotes} />
      <NotesProseSection title="Open questions" items={openQuestions} />
      <LegalFullOutputDivider />
    </div>
  );
}

type MarkdownContentBlock =
  | { type: "markdown"; id: string; content: string }
  | { type: "table"; id: string; title: string; headingLevel: number; tableMarkdown: string };

export type WorkflowMarkdownTableBlock = Extract<MarkdownContentBlock, { type: "table" }>;

const TABLE_SCROLL_CLASS = "max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-border/70 bg-background";
const TABLE_CLASS = "w-max max-w-none border-collapse text-sm";
const TABLE_CELL_WRAP_CLASS = "whitespace-normal [overflow-wrap:anywhere]";

function isMarkdownTableSeparator(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function isMarkdownTableStart(lines: string[], index: number) {
  const header = lines[index] || "";
  const separator = lines[index + 1] || "";
  return header.includes("|") && isMarkdownTableSeparator(separator);
}

function extractTableTitle(buffer: string[]) {
  let endIndex = buffer.length - 1;
  while (endIndex >= 0 && !buffer[endIndex].trim()) {
    endIndex -= 1;
  }

  if (endIndex < 0) return { title: "Table", headingLevel: 3, contentLines: buffer };

  const headingMatch = buffer[endIndex].match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!headingMatch) return { title: "Table", headingLevel: 3, contentLines: buffer };

  const contentLines = buffer.slice(0, endIndex);
  while (contentLines.length > 0 && !contentLines[contentLines.length - 1].trim()) {
    contentLines.pop();
  }

  return {
    title: headingMatch[2].trim() || "Table",
    headingLevel: headingMatch[1].length,
    contentLines,
  };
}

function splitMarkdownTableBlocks(markdown: string): MarkdownContentBlock[] {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownContentBlock[] = [];
  let buffer: string[] = [];
  let tableIndex = 0;

  const flushMarkdown = () => {
    const content = buffer.join("\n").trim();
    if (content) blocks.push({ type: "markdown", id: `markdown-${blocks.length}`, content });
    buffer = [];
  };

  for (let index = 0; index < lines.length;) {
    if (isMarkdownTableStart(lines, index)) {
      const titleResult = extractTableTitle(buffer);
      buffer = titleResult.contentLines;
      flushMarkdown();

      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }

      blocks.push({
        type: "table",
        id: `table-${tableIndex}`,
        title: titleResult.title,
        headingLevel: titleResult.headingLevel,
        tableMarkdown: tableLines.join("\n"),
      });
      tableIndex += 1;
      continue;
    }

    buffer.push(lines[index]);
    index += 1;
  }

  flushMarkdown();
  return blocks;
}

function tableTitleClass(headingLevel: number) {
  if (headingLevel <= 1) return "text-2xl font-semibold leading-tight tracking-[-0.02em]";
  if (headingLevel === 2) return "text-lg font-semibold leading-7";
  return "text-base font-semibold leading-6";
}

function MarkdownTableRenderer({ tableMarkdown, expanded = false }: { tableMarkdown: string; expanded?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => (
          <div className={cn(TABLE_SCROLL_CLASS, expanded ? "m-0 h-full min-h-0 rounded-xl" : "my-5")}>
            <table className={cn(TABLE_CLASS, expanded ? "min-w-[1600px]" : "min-w-[1280px]")}>{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th
            className={cn(
              "min-w-[160px] max-w-[300px] border-b border-border/70 bg-muted/30 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground",
              expanded ? "sticky top-0 z-10 min-w-[220px] max-w-[380px] bg-muted" : "",
              TABLE_CELL_WRAP_CLASS,
            )}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            className={cn(
              "min-w-[160px] max-w-[340px] border-t border-border/70 px-3 py-2 align-top text-sm leading-6 text-foreground/90",
              expanded ? "min-w-[220px] max-w-[460px] px-4 py-3" : "",
              TABLE_CELL_WRAP_CLASS,
            )}
          >
            {children}
          </td>
        ),
        p: ({ children }) => <>{children}</>,
        code: ({ children, className }) => (
          <code className={cn("break-words rounded-md bg-muted px-1.5 py-0.5 text-[0.9em] [overflow-wrap:anywhere]", className)}>{children}</code>
        ),
      }}
    >
      {tableMarkdown}
    </ReactMarkdown>
  );
}

function WorkflowMarkdownBlock({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="mb-5 break-words text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground [overflow-wrap:anywhere]">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 mt-7 break-words text-lg font-semibold leading-7 text-foreground first:mt-0 [overflow-wrap:anywhere]">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-5 break-words text-base font-semibold leading-6 text-foreground [overflow-wrap:anywhere]">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-2 mt-5 text-[15px] font-semibold leading-6 text-foreground">{children}</h4>,
        h5: ({ children }) => <h5 className="mb-2 mt-4 text-sm font-semibold leading-6 text-foreground">{children}</h5>,
        h6: ({ children }) => <h6 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h6>,
        p: ({ children }) => <p className="my-3 min-w-0 break-words text-[15px] leading-7 text-foreground/90 [overflow-wrap:anywhere]">{children}</p>,
        ul: ({ children }) => <ul className="my-3 ml-5 min-w-0 list-disc space-y-2 text-[15px] leading-7 text-foreground/90">{children}</ul>,
        ol: ({ children }) => <ol className="my-3 ml-5 min-w-0 list-decimal space-y-2 text-[15px] leading-7 text-foreground/90">{children}</ol>,
        li: ({ children }) => <li className="min-w-0 break-words pl-1 [overflow-wrap:anywhere]">{children}</li>,
        blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-border pl-4 text-[15px] leading-7 text-muted-foreground">{children}</blockquote>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        table: ({ children }) => <div className={cn(TABLE_SCROLL_CLASS, "my-5")}><table className={cn(TABLE_CLASS, "min-w-[1280px]")}>{children}</table></div>,
        th: ({ children }) => <th className={cn("min-w-[160px] max-w-[280px] border-b border-border/70 bg-muted/30 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground", TABLE_CELL_WRAP_CLASS)}>{children}</th>,
        td: ({ children }) => <td className={cn("min-w-[160px] max-w-[320px] border-t border-border/70 px-3 py-2 align-top text-sm leading-6 text-foreground/90", TABLE_CELL_WRAP_CLASS)}>{children}</td>,
        code: ({ children, className }) => (
          <code className={cn("break-words rounded-md bg-muted px-1.5 py-0.5 text-[0.9em] [overflow-wrap:anywhere]", className)}>{children}</code>
        ),
        pre: ({ children }) => <pre className="my-4 max-w-full overflow-x-auto rounded-2xl bg-muted px-4 py-3 text-sm leading-6">{children}</pre>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function ExpandableMarkdownTable({ block, onExpand }: { block: WorkflowMarkdownTableBlock; onExpand: (block: WorkflowMarkdownTableBlock) => void }) {
  return (
    <section className="my-7 min-w-0">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <h2 className={cn("min-w-0 break-words text-foreground [overflow-wrap:anywhere]", tableTitleClass(block.headingLevel))}>{block.title}</h2>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 rounded-full px-3 text-xs" onClick={() => onExpand(block)}>
          <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
          Expand
        </Button>
      </div>
      <MarkdownTableRenderer tableMarkdown={block.tableMarkdown} />
    </section>
  );
}

function WorkflowMarkdownContent({ markdown, onExpandTable }: { markdown: string; onExpandTable: (block: WorkflowMarkdownTableBlock) => void }) {
  const blocks = useMemo(() => splitMarkdownTableBlocks(markdown), [markdown]);
  return (
    <>
      {blocks.map((block) =>
        block.type === "table" ? (
          <ExpandableMarkdownTable key={block.id} block={block} onExpand={onExpandTable} />
        ) : (
          <WorkflowMarkdownBlock key={block.id} content={block.content} />
        )
      )}
    </>
  );
}

function ExpandedTableDialog({ table, onClose }: { table: WorkflowMarkdownTableBlock | null; onClose: () => void }) {
  return (
    <Dialog open={!!table} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100dvw-1rem)] max-w-[calc(100dvw-1rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[calc(100dvw-1rem)]">
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-14 md:px-6">
          <DialogTitle className="break-words pr-2 text-lg leading-7 [overflow-wrap:anywhere]">{table?.title || "Table"}</DialogTitle>
          <DialogDescription>Full table view</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-auto px-4 py-4 md:px-6 md:py-5">
          {table ? <MarkdownTableRenderer tableMarkdown={table.tableMarkdown} expanded /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type WorkflowOutputEditState = {
  draftMarkdown: string;
  baseMarkdown: string;
  aiEditDraftPrompt?: string;
  aiEditBusy?: boolean;
  aiEditPrompt?: string;
  aiEditRequestId?: string;
};

type Props = {
  result: WorkflowResult;
  selection?: WorkflowSelection;
  sourceRun?: WorkflowRun;
  artifact?: WorkflowArtifactSummary | null;
  artifactBusy?: boolean;
  refineBusy?: boolean;
  aiEditBusy?: boolean;
  editState?: WorkflowOutputEditState | null;
  versions?: WorkflowRunVersion[];
  activeVersionId?: string | null;
  versionBusyId?: string | null;
  onSaveArtifact?: () => void;
  onBeginOutputEdit?: (baseMarkdown: string) => void;
  onDraftOutputChange?: (content: string) => void;
  onCancelOutputEdit?: () => void;
  onCancelAiEdit?: () => void;
  onSaveEditedOutput?: (content: string, mode: WorkflowEditSaveMode, options?: WorkflowEditSaveOptions) => void | Promise<void>;
  onAiEditSelectedOutput?: (payload: WorkflowAiPartialEditRequest) => WorkflowAiPartialEditResponse | Promise<WorkflowAiPartialEditResponse>;
  onDownloadArtifact?: (format: WorkflowArtifactFormat) => void;
  onSelectVersion?: (version: WorkflowRunVersion) => void;
  onRenameVersion?: (version: WorkflowRunVersion, label: string) => void | Promise<void>;
  onMoveVersion?: (version: WorkflowRunVersion, position: { x: number; y: number }) => void | Promise<void>;
  onResetVersionLayout?: () => void | Promise<void>;
  onDownloadVersion?: (version: WorkflowRunVersion, format: WorkflowArtifactFormat) => void;
  onBranchVersion?: (version: WorkflowRunVersion) => void;
  onRefine?: (prompt: string) => void;
  expandedTable?: WorkflowMarkdownTableBlock | null;
  onExpandedTableChange?: (table: WorkflowMarkdownTableBlock | null) => void;
  onWorkflowAction?: (action: WorkflowSuggestedAction, selection: WorkflowSelection, sourceRun: WorkflowRun) => void;
};

const DOWNLOAD_FORMATS: Array<{ value: WorkflowArtifactFormat; label: string; helper: string }> = [
  { value: "markdown", label: "Markdown (.md)", helper: "Best for editing or reusing later." },
  { value: "txt", label: "Text (.txt)", helper: "Plain text for quick sharing." },
  { value: "docx", label: "Word (.docx)", helper: "Formatted document for Word or Google Docs." },
  { value: "pdf", label: "PDF (.pdf)", helper: "Polished file for sharing." },
];

type VersionHistoryPanelProps = {
  versions: WorkflowRunVersion[];
  activeVersionId?: string | null;
  versionBusyId?: string | null;
  onSelectVersion?: (version: WorkflowRunVersion) => void;
  onRenameVersion?: (version: WorkflowRunVersion, label: string) => void | Promise<void>;
  onMoveVersion?: (version: WorkflowRunVersion, position: { x: number; y: number }) => void | Promise<void>;
  onResetVersionLayout?: () => void | Promise<void>;
};

type VersionNodePosition = { x: number; y: number };

type VersionGraphNode = {
  version: WorkflowRunVersion;
  row: number;
  depth: number;
  x: number;
  y: number;
};

function versionDisplayName(version: WorkflowRunVersion) {
  return String(version.title || version.prompt || `${versionKindLabel(version)} output`).trim();
}

function versionMapLabel(version: WorkflowRunVersion) {
  return String(version.label || versionLabel(version)).trim();
}

function savedVersionPosition(version: WorkflowRunVersion): VersionNodePosition | null {
  if (version.layout_x == null || version.layout_y == null) {
    return null;
  }

  const x = Number(version.layout_x);
  const y = Number(version.layout_y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function VersionHistoryPanel({
  versions,
  activeVersionId,
  versionBusyId,
  onSelectVersion,
  onRenameVersion,
  onMoveVersion,
  onResetVersionLayout,
}: VersionHistoryPanelProps) {
  const [treeOpen, setTreeOpen] = useState(false);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [versionLabelDraft, setVersionLabelDraft] = useState("");
  const [localNodePositions, setLocalNodePositions] = useState<Record<string, VersionNodePosition>>({});
  const [draggingVersionId, setDraggingVersionId] = useState<string | null>(null);
  const [resettingLayout, setResettingLayout] = useState(false);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panDragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const graphOriginRef = useRef({ x: 0, y: 0 });
  const treeWasOpenRef = useRef(false);
  const nodeDragRef = useRef<{
    active: boolean;
    versionId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWorldX: number;
    startWorldY: number;
    originalSavedPosition: VersionNodePosition | null;
    moved: boolean;
  }>({
    active: false,
    versionId: "",
    pointerId: 0,
    startClientX: 0,
    startClientY: 0,
    startWorldX: 0,
    startWorldY: 0,
    originalSavedPosition: null,
    moved: false,
  });

  const orderedVersions = useMemo(() => sortedVersions(versions), [versions]);
  const activeVersion = orderedVersions.find((version) => version.id === activeVersionId) || orderedVersions[orderedVersions.length - 1];
  const activeVersionRef = useRef<WorkflowRunVersion | undefined>(activeVersion);
  const hasMultipleVersions = orderedVersions.length > 1;

  const graphColumnGap = 112;
  const graphRowGap = 92;
  const graphPaddingX = 1200;
  const graphPaddingY = 900;

  const graphNodes = useMemo<VersionGraphNode[]>(() => {
    return orderedVersions.map((version, row) => {
      const depth = Math.min(versionDepth(version, orderedVersions), 6);
      const autoPosition = {
        x: depth * graphColumnGap,
        y: row * graphRowGap,
      };
      const position = localNodePositions[version.id] || savedVersionPosition(version) || autoPosition;
      return {
        version,
        row,
        depth,
        x: position.x,
        y: position.y,
      };
    });
  }, [graphColumnGap, graphRowGap, localNodePositions, orderedVersions]);

  const graphNodeById = useMemo(() => new Map(graphNodes.map((node) => [node.version.id, node])), [graphNodes]);

  const graphBounds = useMemo(() => {
    if (!graphNodes.length) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    return graphNodes.reduce(
      (bounds, node) => ({
        minX: Math.min(bounds.minX, node.x),
        maxX: Math.max(bounds.maxX, node.x),
        minY: Math.min(bounds.minY, node.y),
        maxY: Math.max(bounds.maxY, node.y),
      }),
      { minX: graphNodes[0].x, maxX: graphNodes[0].x, minY: graphNodes[0].y, maxY: graphNodes[0].y }
    );
  }, [graphNodes]);

  const computedGraphOriginX = graphPaddingX - graphBounds.minX;
  const computedGraphOriginY = graphPaddingY - graphBounds.minY;

  useEffect(() => {
    if (!draggingVersionId) {
      graphOriginRef.current = { x: computedGraphOriginX, y: computedGraphOriginY };
    }
  }, [computedGraphOriginX, computedGraphOriginY, draggingVersionId]);

  const graphOriginX = draggingVersionId ? graphOriginRef.current.x : computedGraphOriginX;
  const graphOriginY = draggingVersionId ? graphOriginRef.current.y : computedGraphOriginY;
  const renderedGraphOriginRef = useRef({ x: graphOriginX, y: graphOriginY });
  const graphWidth = Math.max(3400, graphBounds.maxX - graphBounds.minX + graphPaddingX * 2);
  const graphHeight = Math.max(2400, graphBounds.maxY - graphBounds.minY + graphPaddingY * 2);

  useLayoutEffect(() => {
    const previousOrigin = renderedGraphOriginRef.current;
    const nextOrigin = { x: graphOriginX, y: graphOriginY };
    if (previousOrigin.x === nextOrigin.x && previousOrigin.y === nextOrigin.y) return;

    if (treeOpen && treeWasOpenRef.current) {
      setPanOffset((current) => ({
        x: current.x + previousOrigin.x - nextOrigin.x,
        y: current.y + previousOrigin.y - nextOrigin.y,
      }));
    }

    renderedGraphOriginRef.current = nextOrigin;
  }, [graphOriginX, graphOriginY, treeOpen]);

  const getNodePosition = useCallback((node: VersionGraphNode) => ({
    x: graphOriginX + node.x,
    y: graphOriginY + node.y,
  }), [graphOriginX, graphOriginY]);

  const centerVersion = useCallback((version = activeVersion) => {
    if (!version || !viewportRef.current) return;

    const node = graphNodeById.get(version.id);
    if (!node) return;

    const { x, y } = getNodePosition(node);
    setPanOffset({
      x: viewportRef.current.clientWidth / 2 - x,
      y: viewportRef.current.clientHeight / 2 - y,
    });
  }, [activeVersion, getNodePosition, graphNodeById]);
  const centerVersionRef = useRef(centerVersion);

  useEffect(() => {
    activeVersionRef.current = activeVersion;
  }, [activeVersion]);

  useEffect(() => {
    centerVersionRef.current = centerVersion;
  }, [centerVersion]);

  useEffect(() => {
    if (!treeOpen) {
      treeWasOpenRef.current = false;
      return undefined;
    }

    if (treeWasOpenRef.current) return undefined;

    treeWasOpenRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      centerVersionRef.current(activeVersionRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [treeOpen]);

  useEffect(() => {
    if (!editingVersionId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingVersionId]);

  const beginLabelEdit = (version: WorkflowRunVersion) => {
    setEditingVersionId(version.id);
    setVersionLabelDraft(versionMapLabel(version));
  };

  const cancelLabelEdit = () => {
    setEditingVersionId(null);
    setVersionLabelDraft("");
  };

  const saveLabelEdit = async (version: WorkflowRunVersion) => {
    const nextLabel = versionLabelDraft.trim();
    const currentLabel = versionMapLabel(version);

    if (!nextLabel || nextLabel === currentLabel) {
      cancelLabelEdit();
      return;
    }

    await onRenameVersion?.(version, nextLabel);
    cancelLabelEdit();
  };

  const handleLabelKeyDown = (event: KeyboardEvent<HTMLInputElement>, version: WorkflowRunVersion) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveLabelEdit(version);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelLabelEdit();
    }
  };

  const openVersion = (version: WorkflowRunVersion) => {
    if (version.id !== activeVersion?.id) {
      onSelectVersion?.(version);
    }
    setTreeOpen(false);
  };

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[data-version-map-node]")) return;

    panDragRef.current = { active: true, lastX: event.clientX, lastY: event.clientY };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    if (!panDragRef.current.active) return;

    const deltaX = event.clientX - panDragRef.current.lastX;
    const deltaY = event.clientY - panDragRef.current.lastY;
    panDragRef.current.lastX = event.clientX;
    panDragRef.current.lastY = event.clientY;
    setPanOffset((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
  };

  const stopPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!panDragRef.current.active) return;

    panDragRef.current.active = false;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const startNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: VersionGraphNode) => {
    if (versionBusyId === node.version.id || editingVersionId === node.version.id) return;

    event.preventDefault();
    event.stopPropagation();
    nodeDragRef.current = {
      active: true,
      versionId: node.version.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: node.x,
      startWorldY: node.y,
      originalSavedPosition: savedVersionPosition(node.version),
      moved: false,
    };
    setDraggingVersionId(node.version.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: VersionGraphNode) => {
    const drag = nodeDragRef.current;
    if (!drag.active || drag.versionId !== node.version.id) return;

    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) > 4) {
      nodeDragRef.current.moved = true;
    }
    if (!nodeDragRef.current.moved) return;

    const nextPosition = {
      x: drag.startWorldX + deltaX,
      y: drag.startWorldY + deltaY,
    };
    setLocalNodePositions((current) => ({ ...current, [node.version.id]: nextPosition }));
  };

  const stopNodeDrag = async (event: PointerEvent<HTMLButtonElement>, node: VersionGraphNode) => {
    const drag = nodeDragRef.current;
    if (!drag.active || drag.versionId !== node.version.id) return;

    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    const moved = drag.moved || Math.hypot(deltaX, deltaY) > 4;
    const nextPosition = {
      x: drag.startWorldX + deltaX,
      y: drag.startWorldY + deltaY,
    };
    nodeDragRef.current.active = false;
    setDraggingVersionId(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!moved) {
      openVersion(node.version);
      return;
    }

    setLocalNodePositions((current) => ({ ...current, [node.version.id]: nextPosition }));
    try {
      await onMoveVersion?.(node.version, nextPosition);
    } catch {
      setLocalNodePositions((current) => {
        const next = { ...current };
        if (drag.originalSavedPosition) {
          next[node.version.id] = drag.originalSavedPosition;
        } else {
          delete next[node.version.id];
        }
        return next;
      });
    }
  };

  const cancelNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: VersionGraphNode) => {
    const drag = nodeDragRef.current;
    if (!drag.active || drag.versionId !== node.version.id) return;

    nodeDragRef.current.active = false;
    setDraggingVersionId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setLocalNodePositions((current) => {
      const next = { ...current };
      if (drag.originalSavedPosition) {
        next[node.version.id] = drag.originalSavedPosition;
      } else {
        delete next[node.version.id];
      }
      return next;
    });
  };

  const resetLayout = async () => {
    if (!onResetVersionLayout || resettingLayout) return;
    setResettingLayout(true);
    setLocalNodePositions({});
    try {
      await onResetVersionLayout();
    } finally {
      setResettingLayout(false);
    }
  };

  if (!hasMultipleVersions) return null;

  return (
    <>
      <div className="rounded-2xl border border-border/70 bg-muted/10 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium leading-5 text-foreground">
              <History className="h-4 w-4 text-muted-foreground" />
              Versions
              {activeVersion ? (
                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">
                  Viewing {versionMapLabel(activeVersion)}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              Pick a saved output from the dropdown or use the map to jump between versions.
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-9 w-full justify-between rounded-full px-3 text-xs sm:w-[230px]">
                  <span className="truncate text-left">
                    {activeVersion ? `Viewing ${versionMapLabel(activeVersion)} · ${versionKindLabel(activeVersion)}` : "Choose version"}
                  </span>
                  <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[360px] w-[320px] overflow-y-auto rounded-2xl p-2">
                <DropdownMenuLabel className="px-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Saved outputs</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {orderedVersions.map((version) => {
                  const active = version.id === activeVersion?.id;
                  const busy = versionBusyId === version.id;
                  return (
                    <DropdownMenuItem
                      key={version.id}
                      disabled={busy}
                      className="items-start gap-2 rounded-xl px-2 py-2"
                      onSelect={(event) => {
                        if (active) {
                          event.preventDefault();
                          return;
                        }
                        onSelectVersion?.(version);
                      }}
                    >
                      <div className="pt-0.5">
                        {active ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium leading-5 text-foreground">{versionMapLabel(version)}</span>
                          <span className="text-xs leading-5 text-muted-foreground">{versionKindLabel(version)}</span>
                          {active ? <span className="ml-auto text-[11px] text-primary">Current</span> : null}
                        </div>
                        <div className="truncate text-[11px] leading-4 text-muted-foreground">
                          {versionDisplayName(version)}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-full rounded-full px-3 text-xs sm:w-auto"
              onClick={() => setTreeOpen(true)}
            >
              <GitBranch className="mr-1 h-4 w-4" />
              Open map
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={treeOpen} onOpenChange={setTreeOpen}>
        <DialogContent className="flex max-h-[96vh] w-[98vw] max-w-[1800px] flex-col overflow-hidden rounded-3xl border-border p-0 shadow-[0_32px_90px_rgba(15,23,42,0.22)]">
          <DialogTitle className="sr-only">Version map</DialogTitle>

          <div
            ref={viewportRef}
            className={cn(
              "relative h-[92vh] min-h-[620px] flex-1 overflow-hidden bg-muted/10 select-none touch-none",
              isPanning ? "cursor-grabbing" : "cursor-grab"
            )}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
          >
            <div
              className="absolute left-0 top-0 will-change-transform"
              style={{ width: graphWidth, height: graphHeight, transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                {graphNodes.map((node) => {
                  if (!node.version.parent_version_id) return null;
                  const parent = graphNodeById.get(node.version.parent_version_id);
                  if (!parent) return null;
                  const { x: x1, y: y1 } = getNodePosition(parent);
                  const { x: x2, y: y2 } = getNodePosition(node);
                  const midX = x1 + Math.max(28, (x2 - x1) / 2);
                  return (
                    <path
                      key={`${node.version.id}-line`}
                      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                      className="fill-none stroke-border"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </svg>

              {graphNodes.map((node) => {
                const active = node.version.id === activeVersion?.id;
                const busy = versionBusyId === node.version.id;
                const dragging = draggingVersionId === node.version.id;
                const { x, y } = getNodePosition(node);
                return (
                  <div
                    key={node.version.id}
                    data-version-map-node
                    className="absolute"
                    style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
                      {editingVersionId === node.version.id ? (
                        <Input
                          ref={editInputRef}
                          value={versionLabelDraft}
                          maxLength={120}
                          disabled={busy}
                          onChange={(event) => setVersionLabelDraft(event.target.value)}
                          onBlur={() => { void saveLabelEdit(node.version); }}
                          onKeyDown={(event) => handleLabelKeyDown(event, node.version)}
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                          className="h-auto w-32 rounded-xl border-border bg-background/95 px-2 py-1 text-center text-[11px] font-medium leading-4 shadow-lg"
                        />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={busy || dragging}
                              onClick={(event) => {
                                event.stopPropagation();
                                beginLabelEdit(node.version);
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              className={cn(
                                "min-w-[2.75rem] max-w-[120px] rounded-xl border border-border/70 bg-background/95 px-2 py-1 text-center text-[11px] font-medium leading-4 text-foreground shadow-sm transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70",
                                active && "border-primary/40 bg-primary/10 text-primary"
                              )}
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 3,
                                overflow: "hidden",
                                overflowWrap: "break-word",
                                wordBreak: "normal",
                              }}
                            >
                              {versionMapLabel(node.version)}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={8} className="max-w-[240px] rounded-xl px-3 py-2 text-xs shadow-lg">
                            <div
                              className="font-medium leading-5"
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 3,
                                overflow: "hidden",
                                wordBreak: "break-word",
                              }}
                            >
                              {versionMapLabel(node.version)}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${versionMapLabel(node.version)} ${versionDisplayName(node.version)}`}
                          aria-current={active ? "true" : undefined}
                          disabled={busy}
                          onPointerDown={(event) => startNodeDrag(event, node)}
                          onPointerMove={(event) => moveNodeDrag(event, node)}
                          onPointerUp={(event) => { void stopNodeDrag(event, node); }}
                          onPointerCancel={(event) => cancelNodeDrag(event, node)}
                          className={cn(
                            "group relative grid h-6 w-6 cursor-grab place-items-center rounded-full border bg-background shadow-sm transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:cursor-grabbing disabled:cursor-wait disabled:opacity-70",
                            active ? "border-primary bg-primary/10 ring-4 ring-primary/15" : "border-border hover:border-primary/50",
                            dragging && "scale-110 cursor-grabbing border-primary shadow-lg ring-4 ring-primary/10"
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full bg-muted-foreground/45 transition-colors group-hover:bg-primary",
                              node.version.kind === "branch" && "h-2 w-2",
                              active && "bg-primary"
                            )}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={8} className="max-w-[240px] rounded-xl px-3 py-2 text-xs shadow-lg">
                        <div
                          className="font-medium leading-5"
                          style={{
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 3,
                            overflow: "hidden",
                            wordBreak: "break-word",
                          }}
                        >
                          {versionMapLabel(node.version)}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>

            <div
              className="absolute bottom-5 right-5 z-20 flex flex-col gap-2 sm:flex-row"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-11 w-11 rounded-full border border-border/70 bg-background/95 shadow-lg backdrop-blur transition hover:scale-105"
                    aria-label="Center current version"
                    onClick={() => centerVersion()}
                  >
                    <Crosshair className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="rounded-xl px-3 py-2 text-xs shadow-lg">
                  Center current
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-11 w-11 rounded-full border border-border/70 bg-background/95 shadow-lg backdrop-blur transition hover:scale-105 disabled:opacity-60"
                    aria-label={resettingLayout ? "Resetting version map layout" : "Reset version map layout"}
                    disabled={!onResetVersionLayout || resettingLayout}
                    onClick={() => { void resetLayout(); }}
                  >
                    <RefreshCw className={cn("h-4 w-4", resettingLayout && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="rounded-xl px-3 py-2 text-xs shadow-lg">
                  {resettingLayout ? "Resetting" : "Reset layout"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkflowResultDetails({
  result,
  selection,
  sourceRun,
  artifact,
  artifactBusy = false,
  refineBusy = false,
  aiEditBusy = false,
  editState = null,
  versions = [],
  activeVersionId,
  versionBusyId = null,
  onSaveArtifact,
  onBeginOutputEdit,
  onDraftOutputChange,
  onCancelOutputEdit,
  onCancelAiEdit,
  onSaveEditedOutput,
  onAiEditSelectedOutput,
  onDownloadArtifact,
  onSelectVersion,
  onRenameVersion,
  onMoveVersion,
  onResetVersionLayout,
  onRefine,
  expandedTable: controlledExpandedTable,
  onExpandedTableChange,
  onWorkflowAction,
}: Props) {
  const rawSourceFiles = asArray<SourceFileMeta>(result.metadata?.source_files);
  const visibleSourceFiles = useMemo(() => uniqueSourceFiles(rawSourceFiles), [rawSourceFiles]);
  const markdown = useMemo(() => workflowDocumentMarkdown(result), [result]);
  const displayMarkdown = useMemo(() => formatLegalClauseTokensInText(markdown), [markdown]);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [aiEditSelection, setAiEditSelection] = useState<MarkdownEditorSelection | null>(null);
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [aiEditSubmitting, setAiEditSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localExpandedTable, setLocalExpandedTable] = useState<WorkflowMarkdownTableBlock | null>(null);
  const expandedTable = controlledExpandedTable === undefined ? localExpandedTable : controlledExpandedTable;
  const setExpandedTable = useCallback((table: WorkflowMarkdownTableBlock | null) => {
    if (onExpandedTableChange) onExpandedTableChange(table);
    else setLocalExpandedTable(table);
  }, [onExpandedTableChange]);
  const outputIdentityRef = useRef({ activeVersionId: activeVersionId || null, markdown });

  useEffect(() => {
    const nextIdentity = { activeVersionId: activeVersionId || null, markdown };
    const previousIdentity = outputIdentityRef.current;
    outputIdentityRef.current = nextIdentity;

    if (
      previousIdentity.activeVersionId === nextIdentity.activeVersionId &&
      previousIdentity.markdown === nextIdentity.markdown
    ) {
      return;
    }

    setAiEditSelection(null);
    setAiEditPrompt("");
    setCopied(false);
    setExpandedTable(null);
  }, [activeVersionId, markdown, setExpandedTable]);

  const editingOutput = !!editState;
  const draftMarkdown = editState?.draftMarkdown ?? markdown;
  const baseMarkdown = editState?.baseMarkdown ?? markdown;
  const aiEditDraftPrompt = editState?.aiEditDraftPrompt || "";
  const editLocked = !!editState?.aiEditBusy;
  const outputMarkdown = editingOutput ? draftMarkdown : displayMarkdown;
  const hasEditedOutput = draftMarkdown !== baseMarkdown;
  const canSaveEditedOutput = !!onSaveEditedOutput && hasEditedOutput && !!draftMarkdown.trim() && !artifactBusy && !editLocked;
  const aiEditIsBusy = artifactBusy || refineBusy || aiEditBusy || aiEditSubmitting || editLocked;
  const aiEditSelectedPreview = useMemo(() => compactSelectionPreview(aiEditSelection?.selectedText || aiEditSelection?.selectedContent || ""), [aiEditSelection]);

  const suggestedActions = useMemo(() => {
    return asArray<WorkflowSuggestedAction>(result.metadata?.suggested_actions)
      .map((action) => ({
        kind: String(action.kind || "workflow").trim(),
        label: String(action.label || "").trim(),
        workflow_id: String(action.workflow_id || "").trim(),
        focus: String(action.focus || "").trim(),
        description: String(action.description || "").trim(),
      }))
      .filter((action) => action.label && action.workflow_id);
  }, [result.metadata]);

  const submitRefinement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = refinePrompt.trim();
    if (!prompt || refineBusy) return;
    onRefine?.(prompt);
    setRefinePrompt("");
  };

  const copyOutput = async () => {
    await navigator.clipboard.writeText(outputMarkdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const cancelOutputEdit = () => {
    if (editLocked) return;
    onCancelOutputEdit?.();
  };

  const beginOutputEdit = () => {
    onBeginOutputEdit?.(markdown);
  };

  const saveEditedOutput = async (mode: WorkflowEditSaveMode) => {
    if (!canSaveEditedOutput) return;
    const options: WorkflowEditSaveOptions = aiEditDraftPrompt
      ? { edit_source: "ai_section", edit_prompt: aiEditDraftPrompt }
      : {};
    await onSaveEditedOutput?.(draftMarkdown, mode, options);
  };

  const openAiEditModal = (selection: MarkdownEditorSelection) => {
    setAiEditSelection(selection);
    setAiEditPrompt("");
  };

  const closeAiEditModal = () => {
    setAiEditSelection(null);
    setAiEditPrompt("");
  };

  const submitAiEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = aiEditPrompt.trim();
    if (!aiEditSelection || !prompt || !onAiEditSelectedOutput || aiEditIsBusy) return;

    const payload = {
      prompt,
      content_before: aiEditSelection.contentBefore,
      selected_content: aiEditSelection.selectedContent,
      content_after: aiEditSelection.contentAfter,
    };

    setAiEditSelection(null);
    setAiEditPrompt("");
    setAiEditSubmitting(true);
    void Promise.resolve(onAiEditSelectedOutput(payload))
      .catch(() => undefined)
      .finally(() => setAiEditSubmitting(false));
  };

  return (
    <div className="min-w-0 space-y-5">
      <VersionHistoryPanel
        versions={versions}
        activeVersionId={activeVersionId}
        versionBusyId={versionBusyId}
        onSelectVersion={onSelectVersion}
        onRenameVersion={onRenameVersion}
        onMoveVersion={onMoveVersion}
        onResetVersionLayout={onResetVersionLayout}
      />

      <div className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-background shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-end md:px-5">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {editingOutput ? (
              <>
                <Button variant="ghost" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={cancelOutputEdit} disabled={artifactBusy || editLocked}>
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full rounded-full px-3 text-xs sm:w-auto"
                  onClick={() => { void saveEditedOutput("overwrite"); }}
                  disabled={!canSaveEditedOutput}
                >
                  <Save className="mr-1 h-4 w-4" />
                  {artifactBusy ? "Saving" : "Overwrite"}
                </Button>
                <Button
                  size="sm"
                  className="h-8 w-full rounded-full px-3 text-xs sm:w-auto"
                  onClick={() => { void saveEditedOutput("new_version"); }}
                  disabled={!canSaveEditedOutput}
                >
                  <GitBranch className="mr-1 h-4 w-4" />
                  {artifactBusy ? "Saving" : "Save as new version"}
                </Button>
              </>
            ) : (
              <>
                {onSaveEditedOutput ? (
                  <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={beginOutputEdit} disabled={artifactBusy}>
                    <PencilLine className="mr-1 h-4 w-4" />
                    Edit
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={() => { void copyOutput(); }}>
                  <Copy className="mr-1 h-4 w-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
                {!artifact && onSaveArtifact ? (
                  <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={onSaveArtifact} disabled={artifactBusy}>
                    <Save className="mr-1 h-4 w-4" />
                    Save
                  </Button>
                ) : null}
                {onDownloadArtifact ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" disabled={artifactBusy}>
                        <Download className="mr-1 h-4 w-4" />
                        {artifact ? "Download" : "Save and download"}
                        <ChevronDown className="ml-1 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 rounded-2xl">
                      <DropdownMenuLabel className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Download format</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {DOWNLOAD_FORMATS.map((item) => (
                        <DropdownMenuItem
                          key={item.value}
                          className="items-start rounded-xl px-2 py-2"
                          onSelect={() => onDownloadArtifact(item.value)}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium leading-5 text-foreground">{item.label}</div>
                            <div className="text-[11px] leading-4 text-muted-foreground">{item.helper}</div>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </>
            )}
          </div>
        </div>
        {editingOutput ? (
          <>
            {editLocked ? (
              <div className="flex flex-col gap-3 border-t border-border/70 bg-primary/5 px-4 py-3 text-sm leading-6 text-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
                <div className="flex min-w-0 items-start gap-2">
                  <Sparkles className="mt-1 h-4 w-4 shrink-0 animate-pulse text-primary" />
                  <div>
                    <div className="font-medium">AI edit is running.</div>
                    <div className="text-xs leading-5 text-muted-foreground">The editor is locked until the draft is ready.</div>
                  </div>
                </div>
                {onCancelAiEdit ? (
                  <Button type="button" variant="outline" size="sm" className="h-8 rounded-full px-3 text-xs" onClick={onCancelAiEdit}>
                    Cancel AI edit
                  </Button>
                ) : null}
              </div>
            ) : null}
            <MarkdownRichEditor
              value={draftMarkdown}
              onChange={(value) => onDraftOutputChange?.(value)}
              disabled={artifactBusy || editLocked}
              ariaLabel="Edit workflow output"
              onAiEditSelection={onAiEditSelectedOutput ? openAiEditModal : undefined}
              aiEditDisabled={!onAiEditSelectedOutput || aiEditIsBusy}
              aiEditBusy={aiEditIsBusy}
            />
          </>
        ) : (
          <article className="mx-auto min-w-0 w-full max-w-[960px] overflow-hidden px-5 py-6 md:px-8 md:py-8">
            <LegalMetadataSummary result={result} />
            <WorkflowMarkdownContent markdown={displayMarkdown} onExpandTable={setExpandedTable} />
          </article>
        )}
      </div>

      <ExpandedTableDialog table={expandedTable} onClose={() => setExpandedTable(null)} />

      {onRefine ? (
        <form onSubmit={submitRefinement} className="rounded-2xl border border-border/70 bg-background px-4 py-4 shadow-sm">
          <label htmlFor="workflow-refine-prompt" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
            Refine output
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              id="workflow-refine-prompt"
              value={refinePrompt}
              onChange={(event) => setRefinePrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask for a revision. The new output will be saved as another version."
              className="min-h-[88px] flex-1 rounded-2xl resize-none"
              disabled={refineBusy}
            />
            <Button type="submit" className="h-10 rounded-full px-4" disabled={refineBusy || !refinePrompt.trim()}>
              <SendHorizontal className="mr-2 h-4 w-4" />
              {refineBusy ? "Refining" : "Refine"}
            </Button>
          </div>
        </form>
      ) : null}

      {!!visibleSourceFiles.length && (
        <Section title="Sources used" icon={Files}>
          <div className="flex flex-wrap gap-1">
            {visibleSourceFiles.map((source, idx) => (
              <Badge
                key={`${source.file_id || source.name || "source"}-${idx}`}
                variant="secondary"
                className="max-w-full whitespace-normal rounded-full px-2 py-0.5 text-left text-[10px] font-normal"
              >
                {formatSourceLabel(source)}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      <Dialog open={!!aiEditSelection} onOpenChange={(open) => {
        if (!open) closeAiEditModal();
      }}>
        <DialogContent className="max-w-lg rounded-3xl border-border p-0 shadow-[0_32px_80px_rgba(15,23,42,0.18)]">
          <form onSubmit={submitAiEdit}>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="h-4 w-4" />
                Edit selected text with AI
              </DialogTitle>
              <DialogDescription>Describe the change. You can review the edited output before saving it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-6 py-4">
              {aiEditSelectedPreview ? (
                <div className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 text-xs leading-5 text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">Selected text</div>
                  <div className="max-h-28 overflow-y-auto whitespace-pre-wrap">{aiEditSelectedPreview}</div>
                </div>
              ) : null}
              <Textarea
                autoFocus
                value={aiEditPrompt}
                onChange={(event) => setAiEditPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Rewrite this section, make it shorter, change the tone, add missing details…"
                className="min-h-[120px] resize-none rounded-2xl"
                disabled={aiEditIsBusy}
                maxLength={2000}
              />
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button type="button" variant="outline" onClick={closeAiEditModal} disabled={aiEditSubmitting}>Cancel</Button>
              <Button type="submit" disabled={aiEditIsBusy || !aiEditPrompt.trim()}>
                {aiEditSubmitting ? "Starting" : "Preview edit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {!!suggestedActions.length && selection && sourceRun && onWorkflowAction && (
        <Section title="Continue from this output">
          <div className="grid gap-3 lg:grid-cols-2">
            {suggestedActions.map((action) => (
              <Button
                key={`${action.workflow_id}-${action.label}`}
                variant="outline"
                className="h-auto min-h-[92px] w-full items-start justify-start whitespace-normal rounded-2xl px-4 py-4 text-left"
                onClick={() => onWorkflowAction(action, selection, sourceRun)}
              >
                <div className="min-w-0 space-y-2">
                  <div className="text-base font-medium leading-6 break-words text-foreground">{action.label}</div>
                  {action.description ? (
                    <div className="text-sm leading-6 break-words text-muted-foreground">{action.description}</div>
                  ) : null}
                </div>
              </Button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
