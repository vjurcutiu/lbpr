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

import type { WorkflowManifest } from "../types";
import type { WorkflowSelectionSummary } from "../hooks/useWorkflowSelection";

type Props = {
  open: boolean;
  workflow: WorkflowManifest | null;
  selection: WorkflowSelectionSummary;
  submitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onRun: (workflow: WorkflowManifest, focus: string) => void;
};

export function WorkflowLauncher({
  open,
  workflow,
  selection,
  submitting = false,
  onOpenChange,
  onRun,
}: Props) {
  const [focus, setFocus] = useState("");

  useEffect(() => {
    if (!open) setFocus("");
  }, [open]);

  const suggestions = useMemo(() => workflow?.launcher.suggested_prompts ?? [], [workflow]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{workflow?.title ?? "Workflow"}</DialogTitle>
          <DialogDescription>
            {workflow?.description ?? "Configure the workflow run."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{selection.label}</Badge>
            <Badge variant="outline">Current folder: {selection.current_folder || "Root"}</Badge>
          </div>

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
          </div>

          {!!suggestions.length && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggestions</div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <Button key={suggestion} variant="outline" size="sm" onClick={() => setFocus(suggestion)}>
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
          <Button onClick={() => workflow && onRun(workflow, focus)} disabled={!workflow || submitting}>
            {workflow?.launcher.submit_label ?? "Run workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
