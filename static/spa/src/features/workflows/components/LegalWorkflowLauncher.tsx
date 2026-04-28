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

import type { WorkflowChainSource, WorkflowLauncherField, WorkflowManifest, WorkflowSelection } from "../types";
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

const LEGAL_FIELD_ORDER = ["document_type", "review_mode", "counterparty_position", "risk_tolerance"];

function orderedLegalFields(workflow: WorkflowManifest | null): WorkflowLauncherField[] {
  const fields = workflow?.launcher.fields ?? [];
  return [...fields].sort((a, b) => {
    const aIndex = LEGAL_FIELD_ORDER.indexOf(a.key);
    const bIndex = LEGAL_FIELD_ORDER.indexOf(b.key);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
}

function defaultFieldValues(workflow: WorkflowManifest | null, initialInputs?: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of orderedLegalFields(workflow)) {
    const seeded = String(initialInputs?.[field.key] || "").trim();
    const fallback = seeded || field.default_value || field.options[0]?.value || "";
    if (fallback) values[field.key] = fallback;
  }
  return values;
}

function defaultFocus(initialInputs?: Record<string, unknown>) {
  return String(initialInputs?.focus || "").trim();
}

function defaultMatterContext(initialInputs?: Record<string, unknown>) {
  return String(initialInputs?.matter_context || "").trim();
}

function passthroughInitialInputs(
  initialInputs: Record<string, unknown> | undefined,
  workflow: WorkflowManifest | null,
): Record<string, unknown> {
  const reservedKeys = new Set([
    "focus",
    "matter_context",
    "workflow_chain",
    ...(workflow?.launcher.fields ?? []).map((field) => field.key),
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

function selectedOptionDescription(field: WorkflowLauncherField, value: string) {
  return field.options.find((option) => option.value === value)?.description || "";
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
  return "Legal review";
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
  const [focus, setFocus] = useState(() => defaultFocus(initialInputs));
  const [matterContext, setMatterContext] = useState(() => defaultMatterContext(initialInputs));
  const [editableSelection, setEditableSelection] = useState<WorkflowSelection>(selection);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => defaultFieldValues(workflow, initialInputs));

  useEffect(() => {
    setFocus(defaultFocus(initialInputs));
    setMatterContext(defaultMatterContext(initialInputs));
    setEditableSelection(selection);
    setFieldValues(defaultFieldValues(workflow, initialInputs));
  }, [open, selection, workflow, selectionMode, initialInputs]);

  const fields = useMemo(() => orderedLegalFields(workflow), [workflow]);
  const suggestions = useMemo(() => workflow?.launcher.suggested_prompts ?? [], [workflow]);
  const activeSelection = selectionMode === "picker" ? summarizeWorkflowSelection(editableSelection) : selection;
  const selectionMessage = workflow ? getWorkflowSelectionMessage(workflow, activeSelection) : "Select a workflow.";
  const canRun = !!workflow && isWorkflowSelectionValid(workflow, activeSelection) && !(selectionMode === "picker" && filesLoading);

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
                  {workflow?.description ?? "Choose legal materials and review settings."}
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
                Review
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
                <label className="text-sm font-medium">
                  {workflow?.launcher.prompt_label ?? "Review focus"}
                </label>
                <Textarea
                  rows={5}
                  placeholder={workflow?.launcher.prompt_placeholder ?? "What should the review focus on?"}
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                  disabled={submitting}
                />
                <p className="text-xs text-muted-foreground">
                  Add terms, concerns, audience, or output preferences that matter for this review.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border bg-background p-4 shadow-sm">
                <div className="mb-3 text-sm font-semibold">Review settings</div>
                <div className="space-y-3">
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
                </div>
              </div>

              {!!suggestions.length && (
                <div className="rounded-3xl border bg-muted/10 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Common focuses</div>
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
          <Button
            className="rounded-full"
            onClick={() =>
              workflow &&
              onRun(
                workflow,
                {
                  ...passthroughInitialInputs(initialInputs, workflow),
                  ...(focus.trim() ? { focus: focus.trim() } : {}),
                  ...(matterContext.trim() ? { matter_context: matterContext.trim() } : {}),
                  ...Object.fromEntries(Object.entries(fieldValues).filter(([, value]) => String(value || "").trim())),
                },
                activeSelection,
              )
            }
            disabled={!canRun || submitting}
          >
            {workflow?.launcher.submit_label ?? "Run review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
