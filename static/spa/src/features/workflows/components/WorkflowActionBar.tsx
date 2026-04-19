import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";

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
    <div className="border-b bg-gradient-to-r from-background via-background to-muted/20 px-3 py-4">
      <div className="flex flex-col gap-4 rounded-3xl border bg-background/80 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-medium text-foreground">Workflows</span>
            <span className="text-muted-foreground">Select one file or more to start a workflow.</span>
            {selection.totalCount > 0 ? (
              <Badge variant="outline" className="rounded-full font-normal text-muted-foreground">
                {selection.label}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workflows.map((workflow) => {
            const Icon = getWorkflowIcon(workflow.workflow_id);
            const runnable = isRunnable(workflow, selection);
            return (
              <Button
                key={workflow.workflow_id}
                size="sm"
                variant={runnable ? "default" : "outline"}
                disabled={loading || !runnable}
                className={cn(
                  "rounded-full px-4",
                  !runnable && "app-theme-action-button text-muted-foreground disabled:opacity-100",
                )}
                title={runnable ? workflow.description : "Adjust the current selection to use this workflow"}
                onClick={() => onLaunch(workflow)}
              >
                <Icon className="h-4 w-4" />
                <span className="ml-1.5">{workflow.title}</span>
              </Button>
            );
          })}

          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link to="/workflows">
              View all runs
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
