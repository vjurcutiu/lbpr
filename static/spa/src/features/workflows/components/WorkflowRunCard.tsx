import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import type { WorkflowRun } from "../types";
import { getWorkflowIcon } from "../registry";
import { WorkflowResultDetails } from "./WorkflowResultDetails";

function StatusIcon({ status }: { status: WorkflowRun["status"] }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (status === "failed") return <CircleAlert className="h-4 w-4 text-destructive" />;
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
}

function formatSelection(run: WorkflowRun) {
  const files = run.selection.file_ids.length;
  const folders = run.selection.folder_paths.length;
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  return parts.join(" • ") || "No selection";
}

type Props = {
  run: WorkflowRun;
};

export function WorkflowRunCard({ run }: Props) {
  const Icon = getWorkflowIcon(run.workflow_id);
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4 text-primary" />
              {run.title}
            </CardTitle>
            <CardDescription className="mt-1">
              {formatSelection(run)} • {run.selection.current_folder || "Root"}
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 capitalize">
            <StatusIcon status={run.status} />
            {run.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-4 text-sm">
        {run.result?.summary ? <p className="text-sm">{run.result.summary}</p> : null}
        {run.result ? <WorkflowResultDetails result={run.result} /> : null}
        {run.error ? <p className="text-destructive">{run.error}</p> : null}
      </CardContent>
    </Card>
  );
}
