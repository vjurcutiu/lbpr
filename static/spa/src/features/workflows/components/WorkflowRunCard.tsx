import { CheckCircle2, CircleAlert, CornerDownRight, Files, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import type { WorkflowCapability, WorkflowRun } from "../types";
import { getWorkflowIcon } from "../registry";
import { WorkflowResultDetails } from "./WorkflowResultDetails";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";

function formatSelection(run: WorkflowRun) {
  const files = run.selection.file_ids.length;
  const folders = run.selection.folder_paths.length;
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  return parts.join(" • ") || "No source selection";
}

function formatCapability(capability: WorkflowCapability) {
  switch (capability) {
    case "summarize":
      return "Summary";
    case "compare":
      return "Comparison";
    case "extract":
      return "Extraction";
    case "draft":
      return "Drafting";
    case "report":
      return "Report";
    case "plan":
      return "Action plan";
    default:
      return "Workflow";
  }
}

function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "just now";

  const diffMs = date.getTime() - Date.now();
  const minutes = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  return rtf.format(days, "day");
}

function renderStatusCopy(run: WorkflowRun) {
  if (run.status === "completed") {
    return run.result?.summary || "This run finished and is ready to review.";
  }
  if (run.status === "failed") {
    return run.error || "This run did not complete. Review the selection or launch it again.";
  }
  if (run.status === "running") {
    return "This run is in progress. Results will appear here as soon as processing finishes.";
  }
  return "This run is queued and will start automatically.";
}

type Props = {
  run: WorkflowRun;
};

export function WorkflowRunCard({ run }: Props) {
  const Icon = getWorkflowIcon(run.workflow_id);
  const keyTakeaways = run.result?.bullets?.filter(Boolean) ?? [];
  const nextActions = run.result?.next_actions?.filter(Boolean) ?? [];

  return (
    <Card className="overflow-hidden rounded-3xl border bg-gradient-to-b from-background via-background to-muted/20 shadow-sm">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-semibold leading-tight">{run.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="rounded-full capitalize">
                    {formatCapability(run.capability)}
                  </Badge>
                  <span>Updated {formatRelativeTime(run.updated_at)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="rounded-full bg-muted/70 text-foreground">
                {formatSelection(run)}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                <Files className="h-3.5 w-3.5" />
                {run.selection.current_folder || "Root"}
              </Badge>
            </div>
          </div>

          <WorkflowStatusBadge status={run.status} className="shrink-0" />
        </div>

        <div className="rounded-2xl border bg-background/80 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {run.status === "failed" ? <CircleAlert className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            Run summary
          </div>
          <p className="mt-2 text-sm leading-6">{renderStatusCopy(run)}</p>
        </div>

        {!!keyTakeaways.length && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Key takeaways
            </div>
            <div className="grid gap-2">
              {keyTakeaways.slice(0, 4).map((item, index) => (
                <div key={`${item}-${index}`} className="rounded-2xl border bg-muted/20 px-3 py-2 text-sm leading-6">
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {!!nextActions.length && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <CornerDownRight className="h-3.5 w-3.5" />
              Recommended next steps
            </div>
            <div className="grid gap-2">
              {nextActions.slice(0, 3).map((item, index) => (
                <div key={`${item}-${index}`} className="rounded-2xl border bg-background px-3 py-2 text-sm leading-6">
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {run.result ? (
          <>
            <Separator />
            <WorkflowResultDetails result={run.result} />
          </>
        ) : null}

        {run.error && run.status !== "failed" ? <p className="text-sm text-destructive">{run.error}</p> : null}
      </CardContent>
    </Card>
  );
}
