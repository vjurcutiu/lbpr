import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FolderSearch,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { parseErr } from "@/features/files/utils/formatters";

import { listWorkflowRuns, listWorkflows } from "./api";
import { getWorkflowIcon } from "./registry";
import type { WorkflowCapability, WorkflowManifest, WorkflowRun } from "./types";
import { WorkflowRunCard } from "./components/WorkflowRunCard";
import { WorkflowStatusBadge } from "./components/WorkflowStatusBadge";

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
      return "Reporting";
    case "plan":
      return "Planning";
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
    const successRate = runs.length ? Math.round((completed / runs.length) * 100) : 0;
    return { completed, failed, inFlight, successRate };
  }, [runs]);

  const runsByView = useMemo(() => {
    return {
      all: runs,
      active: runs.filter((run) => run.status === "queued" || run.status === "running"),
      completed: runs.filter((run) => run.status === "completed"),
      attention: runs.filter((run) => run.status === "failed"),
    };
  }, [runs]);

  const latestRun = runs[0] || null;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[28px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm md:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Production-ready workflow hub
            </Badge>
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs text-muted-foreground">
              Auto-refreshes every 15 seconds
            </Badge>
          </div>

          <div className="mt-5 space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-4xl">Workflows</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
              Turn selected files into summaries, comparisons, drafts, reports, and action plans — then track every run, review the output, and reopen the latest result from one customer-facing workspace.
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "Launch from Files",
                body: "Start from the files you already selected, so every run stays grounded in the right source material.",
              },
              {
                title: "Review results here",
                body: "Each run keeps its summary, output preview, and source context in one place for easy follow-up.",
              },
              {
                title: "Share-ready outputs",
                body: "Use workflows to move from raw documents to deliverables your team can act on faster.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-3xl border bg-background/80 p-4 shadow-sm">
                <div className="text-sm font-medium">{item.title}</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <Card className="rounded-[28px] border shadow-sm">
            <CardHeader className="pb-3">
              <CardDescription>Latest activity</CardDescription>
              <CardTitle className="text-xl">{latestRun ? latestRun.title : "No runs yet"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {latestRun ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <WorkflowStatusBadge status={latestRun.status} />
                    <Badge variant="outline" className="rounded-full text-muted-foreground">
                      Updated {formatRelativeTime(latestRun.updated_at)}
                    </Badge>
                  </div>
                  <p className="leading-6 text-muted-foreground">
                    {latestRun.result?.summary || latestRun.error || "This run is still in progress."}
                  </p>
                </>
              ) : (
                <p className="leading-6 text-muted-foreground">
                  Start a workflow from the Files view and the latest run will appear here automatically.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border shadow-sm">
            <CardHeader className="pb-3">
              <CardDescription>Quick actions</CardDescription>
              <CardTitle className="text-xl">Keep work moving</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="default" className="rounded-full">
                <Link to="/files">
                  <FolderSearch className="mr-2 h-4 w-4" />
                  Open Files
                </Link>
              </Button>
              <Button variant="outline" className="rounded-full" onClick={() => loadPage({ silent: true })} disabled={loading || refreshing}>
                <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
                Refresh now
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-3xl border shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Available workflows</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <Sparkles className="h-6 w-6 text-primary" />
              {catalog.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Shared workflow starters available from the Files view.
          </CardContent>
        </Card>
        <Card className="rounded-3xl border shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Runs tracked</CardDescription>
            <CardTitle className="text-3xl">{runs.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Recent workflow activity stored here for quick review.
          </CardContent>
        </Card>
        <Card className="rounded-3xl border shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Completion rate</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <CheckCircle2 className="h-6 w-6 text-primary" />
              {stats.successRate}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Based on the recent runs shown on this page.
          </CardContent>
        </Card>
        <Card className="rounded-3xl border shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Needs attention</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <XCircle className="h-6 w-6 text-destructive" />
              {stats.failed + stats.inFlight}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Includes queued, running, and failed runs that may need a follow-up.
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="min-h-[420px] rounded-[28px] border shadow-sm">
          <CardHeader className="space-y-3 pb-0">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Run history</CardTitle>
                <CardDescription>
                  Review workflow output, reopen the latest result, and keep an eye on anything still in progress.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="rounded-full">
                  <Clock3 className="h-3.5 w-3.5" />
                  Updates every 15 seconds
                </Badge>
                {latestRun ? <span>Latest update {formatRelativeTime(latestRun.updated_at)}</span> : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            {loading ? (
              <div className="rounded-3xl border border-dashed p-8 text-sm text-muted-foreground">
                Loading workflow runs…
              </div>
            ) : (
              <Tabs defaultValue="all" className="gap-4">
                <TabsList className="h-auto flex-wrap rounded-2xl p-1">
                  <TabsTrigger value="all" className="rounded-xl">All ({runsByView.all.length})</TabsTrigger>
                  <TabsTrigger value="active" className="rounded-xl">In progress ({runsByView.active.length})</TabsTrigger>
                  <TabsTrigger value="completed" className="rounded-xl">Completed ({runsByView.completed.length})</TabsTrigger>
                  <TabsTrigger value="attention" className="rounded-xl">Needs review ({runsByView.attention.length})</TabsTrigger>
                </TabsList>

                {(["all", "active", "completed", "attention"] as const).map((view) => (
                  <TabsContent key={view} value={view}>
                    {runsByView[view].length ? (
                      <div className="grid gap-4 lg:grid-cols-2">
                        {runsByView[view].map((run) => (
                          <WorkflowRunCard key={run.id} run={run} />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed p-8 text-sm text-muted-foreground">
                        {view === "all" && "No workflow runs yet. Start one from the Files view and it will appear here."}
                        {view === "active" && "No runs are currently queued or running."}
                        {view === "completed" && "Completed workflow output will appear here once a run finishes."}
                        {view === "attention" && "Nothing needs review right now."}
                      </div>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[28px] border shadow-sm">
            <CardHeader>
              <CardTitle>Workflow catalog</CardTitle>
              <CardDescription>
                The launchers below are also available from the Files view, using your current selection.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {catalog.map((workflow, index) => {
                const Icon = getWorkflowIcon(workflow.workflow_id);
                return (
                  <div key={workflow.workflow_id} className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <div className="text-sm font-medium">{workflow.title}</div>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{workflow.description}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary" className="rounded-full">{formatCapability(workflow.capability)}</Badge>
                          {workflow.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="rounded-full">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {formatSelectionRequirements(workflow).map((item) => (
                            <Badge key={item} variant="outline" className="whitespace-normal rounded-full text-left text-[11px] text-muted-foreground">
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

              <Button asChild className="w-full rounded-full" variant="outline">
                <Link to="/files">
                  Select files and launch a workflow
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border shadow-sm">
            <CardHeader>
              <CardTitle>Built for customer-facing work</CardTitle>
              <CardDescription>
                The workflow view is designed to feel clear, trustworthy, and easy to review with stakeholders.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {[
                "Every run keeps its source context visible, so outputs stay tied to the files that informed them.",
                "Results are grouped into summaries, structured output, and next steps so teams can act quickly.",
                "Run history lives outside chat, which makes it easier to revisit deliverables without digging through old conversations.",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                  <p className="leading-6 text-muted-foreground">{item}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
