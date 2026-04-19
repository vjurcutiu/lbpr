import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, FolderSearch, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { parseErr } from "@/features/files/utils/formatters";

import { listWorkflowRuns, listWorkflows } from "./api";
import { getWorkflowIcon } from "./registry";
import type { WorkflowManifest, WorkflowRun } from "./types";
import { WorkflowRunCard } from "./components/WorkflowRunCard";

function formatSelectionRequirements(workflow: WorkflowManifest) {
  const parts: string[] = [];
  const selection = workflow.selection;

  if (selection.exact_file_count != null) {
    parts.push(`${selection.exact_file_count} file${selection.exact_file_count === 1 ? "" : "s"} required`);
  } else {
    parts.push(`Min ${selection.min_total_items} item${selection.min_total_items === 1 ? "" : "s"}`);
    if (selection.max_total_items != null) {
      parts.push(`Max ${selection.max_total_items} item${selection.max_total_items === 1 ? "" : "s"}`);
    }
  }

  parts.push(selection.allow_folders ? "Files or folders" : "Files only");
  return parts;
}

export default function WorkflowsPage() {
  const [catalog, setCatalog] = useState<WorkflowManifest[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPage = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const [catalogRes, runsRes] = await Promise.all([listWorkflows(), listWorkflowRuns(24)]);
      setCatalog(catalogRes || []);
      setRuns(runsRes.items || []);
    } catch (err) {
      console.error("[workflows] load error", err);
      toast.error("Failed to load workflows", { description: parseErr(err) });
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    const id = window.setInterval(() => {
      loadPage({ silent: true });
    }, 15000);
    return () => window.clearInterval(id);
  }, [loadPage]);

  const stats = useMemo(() => {
    const completed = runs.filter((run) => run.status === "completed").length;
    const failed = runs.filter((run) => run.status === "failed").length;
    const inFlight = runs.filter((run) => run.status === "queued" || run.status === "running").length;
    return { completed, failed, inFlight };
  }, [runs]);

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-3xl border bg-gradient-to-br from-background via-background to-muted/40 p-5 shadow-sm md:flex-row md:items-start md:justify-between md:p-6">
        <div className="max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Workflow jobs and results
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Workflows</h1>
            <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
              Every workflow run lands here, so users have one place to review progress, inspect results, and reopen the latest output.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/files">
              <FolderSearch className="mr-2 h-4 w-4" />
              Open Files to run one
            </Link>
          </Button>
          <Button variant="default" onClick={() => loadPage({ silent: true })} disabled={loading || refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Available workflows</CardDescription>
            <CardTitle className="text-3xl">{catalog.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Shared starters available from the Files view.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Recent runs</CardDescription>
            <CardTitle className="text-3xl">{runs.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Recent workflow jobs and results returned by the app.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Completed</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <CheckCircle2 className="h-6 w-6 text-primary" />
              {stats.completed}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Finished runs with result cards ready to review.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Needs attention</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <XCircle className="h-6 w-6 text-destructive" />
              {stats.failed + stats.inFlight}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Failed, queued, or running jobs that may need a follow-up.
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="min-h-[420px]">
          <CardHeader>
            <CardTitle>Recent workflow runs</CardTitle>
            <CardDescription>
              This page auto-refreshes every 15 seconds so new jobs triggered from Files appear here automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">
                Loading workflow runs…
              </div>
            ) : runs.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {runs.map((run) => (
                  <WorkflowRunCard key={run.id} run={run} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">
                No workflow runs yet. Start one from the Files view and the job will show up here.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow starters</CardTitle>
            <CardDescription>
              These are the workflow starters currently available from the Files view.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {catalog.map((workflow, index) => {
              const Icon = getWorkflowIcon(workflow.workflow_id);
              return (
                <div key={workflow.workflow_id} className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl border bg-muted/40 p-2">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <div className="text-sm font-medium">{workflow.title}</div>
                        <p className="text-sm text-muted-foreground">{workflow.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="capitalize">
                          {workflow.capability}
                        </Badge>
                        {workflow.tags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {formatSelectionRequirements(workflow).map((item) => (
                          <Badge key={item} variant="outline" className="whitespace-normal text-left text-[11px] text-muted-foreground">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  {index < catalog.length - 1 ? <Separator /> : null}
                </div>
              );
            })}

            <Button asChild className="w-full" variant="outline">
              <Link to="/files">
                Select files and launch a workflow
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
