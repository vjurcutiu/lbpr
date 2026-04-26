import { useEffect, useMemo, useState } from "react";
import { CornerDownRight, History } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FileItem } from "@/features/files/api";

import { getWorkflowIcon } from "../registry";
import type { WorkflowChainSource, WorkflowManifest, WorkflowSelection } from "../types";
import { WorkflowFilePicker } from "./WorkflowFilePicker";
import {
  getWorkflowSelectionMessage,
  isWorkflowSelectionValid,
  summarizeWorkflowSelection,
  type WorkflowSelectionSummary,
} from "../utils/selection";

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

function defaultFieldValues(workflow: WorkflowManifest | null, initialInputs?: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of workflow?.launcher.fields ?? []) {
    const seeded = String(initialInputs?.[field.key] || "").trim();
    const fallback = seeded || field.default_value || field.options[0]?.value || "";
    if (fallback) values[field.key] = fallback;
  }
  return values;
}

function defaultFocus(initialInputs?: Record<string, unknown>) {
  return String(initialInputs?.focus || "").trim();
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

export function WorkflowLauncher({
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
  const [editableSelection, setEditableSelection] = useState<WorkflowSelection>(selection);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => defaultFieldValues(workflow, initialInputs));

  useEffect(() => {
    if (!open) {
      setFocus(defaultFocus(initialInputs));
      setEditableSelection(selection);
      setFieldValues(defaultFieldValues(workflow, initialInputs));
      return;
    }
    setFocus(defaultFocus(initialInputs));
    setEditableSelection(selection);
    setFieldValues(defaultFieldValues(workflow, initialInputs));
  }, [open, selection, workflow, selectionMode, initialInputs]);

  const suggestions = useMemo(() => workflow?.launcher.suggested_prompts ?? [], [workflow]);
  const Icon = workflow ? getWorkflowIcon(workflow.workflow_id) : null;
  const activeSelection = selectionMode === "picker" ? summarizeWorkflowSelection(editableSelection) : selection;
  const selectionMessage = workflow ? getWorkflowSelectionMessage(workflow, activeSelection) : "Select a workflow.";
  const canRun = !!workflow && isWorkflowSelectionValid(workflow, activeSelection) && !(selectionMode === "picker" && filesLoading);
  const launcherFields = workflow?.launcher.fields ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[calc(100vw-2rem)] max-w-xl max-h-[calc(100vh-2rem)] flex-col overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="space-y-4 px-6 pt-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
              {Icon ? <Icon className="h-5 w-5" /> : null}
            </div>
            <div className="space-y-1">
              <DialogTitle>{workflow?.title ?? "Workflow"}</DialogTitle>
              <DialogDescription>
                {workflow?.description ?? "Choose files and optional instructions."}
              </DialogDescription>
            </div>
          </div>

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
              ) : (
                <p className="mt-2 text-sm leading-6 text-foreground/80">
                  This workflow will use the previous result together with the files selected below.
                </p>
              )}
            </div>
          ) : null}

          <div className="rounded-2xl border bg-muted/20 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Selection</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="rounded-full">{activeSelection.label}</Badge>
              {activeSelection.current_folder ? (
                <Badge variant="outline" className="rounded-full">Folder: {activeSelection.current_folder}</Badge>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{selectionMessage}</p>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            {selectionMode === "picker" ? (
              <WorkflowFilePicker
                files={availableFiles}
                selection={editableSelection}
                loading={filesLoading}
                disabled={submitting}
                onSelectionChange={setEditableSelection}
              />
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {workflow?.launcher.prompt_label ?? "Focus"}
              </label>
              <Textarea
                rows={4}
                placeholder={workflow?.launcher.prompt_placeholder ?? "What should this workflow focus on?"}
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Add a goal, audience, or output preference to steer the result.
              </p>
            </div>

            {!!launcherFields.length && (
              <div className="grid gap-3 sm:grid-cols-2">
                {launcherFields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">{field.label}</label>
                    <Select
                      value={fieldValues[field.key] || field.default_value || field.options[0]?.value || ""}
                      onValueChange={(value) => setFieldValues((prev) => ({ ...prev, [field.key]: value }))}
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
                  </div>
                ))}
              </div>
            )}

            {!!suggestions.length && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Try one of these</div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <Button key={suggestion} variant="outline" size="sm" className="rounded-full" onClick={() => setFocus(suggestion)}>
                      {suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            )}
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
                  ...(focus.trim() ? { focus: focus.trim() } : {}),
                  ...Object.fromEntries(Object.entries(fieldValues).filter(([, value]) => String(value || "").trim())),
                },
                activeSelection,
              )
            }
            disabled={!canRun || submitting}
          >
            {workflow?.launcher.submit_label ?? "Run workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
