import { useEffect, useMemo, useState } from "react";

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
import type { FileItem } from "@/features/files/api";

import { getWorkflowIcon } from "../registry";
import type { WorkflowManifest, WorkflowSelection } from "../types";
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
  onOpenChange: (open: boolean) => void;
  onRun: (workflow: WorkflowManifest, focus: string, selection: WorkflowSelection) => void;
};

export function WorkflowLauncher({
  open,
  workflow,
  selection,
  selectionMode = "fixed",
  availableFiles = [],
  filesLoading = false,
  submitting = false,
  onOpenChange,
  onRun,
}: Props) {
  const [focus, setFocus] = useState("");
  const [editableSelection, setEditableSelection] = useState<WorkflowSelection>(selection);

  useEffect(() => {
    if (!open) {
      setFocus("");
      setEditableSelection(selection);
      return;
    }
    setEditableSelection(selection);
  }, [open, selection, workflow?.workflow_id, selectionMode]);

  const suggestions = useMemo(() => workflow?.launcher.suggested_prompts ?? [], [workflow]);
  const Icon = workflow ? getWorkflowIcon(workflow.workflow_id) : null;
  const activeSelection = selectionMode === "picker" ? summarizeWorkflowSelection(editableSelection) : selection;
  const selectionMessage = workflow ? getWorkflowSelectionMessage(workflow, activeSelection) : "Select a workflow.";
  const canRun = !!workflow && isWorkflowSelectionValid(workflow, activeSelection) && !(selectionMode === "picker" && filesLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
              {Icon ? <Icon className="h-5 w-5" /> : null}
            </div>
            <div className="space-y-1">
              <DialogTitle>{workflow?.title ?? "Workflow"}</DialogTitle>
              <DialogDescription>
                {workflow?.description ?? "Configure the workflow run."}
              </DialogDescription>
            </div>
          </div>

          <div className="rounded-2xl border bg-muted/20 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Included in this run</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="rounded-full">{activeSelection.label}</Badge>
              <Badge variant="outline" className="rounded-full">Folder: {activeSelection.current_folder || "Root"}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{selectionMessage}</p>
          </div>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => workflow && onRun(workflow, focus, activeSelection)} disabled={!canRun || submitting}>
            {workflow?.launcher.submit_label ?? "Run workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
