import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { getWorkflowIcon } from "../registry";
import type { WorkflowManifest } from "../types";
import type { WorkflowSelectionSummary } from "../hooks/useWorkflowSelection";

function isRunnable(workflow: WorkflowManifest, selection: WorkflowSelectionSummary) {
  const req = workflow.selection;
  if (selection.totalCount < req.min_total_items) return false;
  if (req.max_total_items != null && selection.totalCount > req.max_total_items) return false;
  if (req.exact_file_count != null && selection.fileCount !== req.exact_file_count) return false;
  if (!req.allow_folders && selection.folderCount > 0) return false;
  return true;
}

type Props = {
  workflows: WorkflowManifest[];
  selection: WorkflowSelectionSummary;
  loading?: boolean;
  onLaunch: (workflow: WorkflowManifest) => void;
};

export function WorkflowActionBar({ workflows, selection, loading = false, onLaunch }: Props) {
  if (!workflows.length) return null;

  return (
    <div className="border-b bg-muted/30 px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            Workflow starters
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {selection.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Run a workflow on the files or folders you have selected, then review every job and result from the Workflows tab.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {workflows.map((workflow) => {
            const Icon = getWorkflowIcon(workflow.workflow_id);
            const runnable = isRunnable(workflow, selection);
            return (
              <Button
                key={workflow.workflow_id}
                size="sm"
                variant={runnable ? "default" : "outline"}
                disabled={loading || !runnable}
                className={cn(!runnable && "opacity-70")}
                title={runnable ? workflow.description : "Adjust the file selection to use this workflow"}
                onClick={() => onLaunch(workflow)}
              >
                <Icon className="h-4 w-4" />
                <span className="ml-1.5">{workflow.title}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
