import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listFiles, type FileItem } from "@/features/files/api";
import { parseErr } from "@/features/files/utils/formatters";
import { cn } from "@/lib/utils";

import { createWorkflowRun, listWorkflowRuns, listWorkflows } from "./api";
import { WorkflowLauncher } from "./components/WorkflowLauncher";
import { WorkflowResultDetails } from "./components/WorkflowResultDetails";
import { WorkflowStatusBadge } from "./components/WorkflowStatusBadge";
import { getWorkflowIcon } from "./registry";
import type {
  WorkflowCapability,
  WorkflowManifest,
  WorkflowRun,
  WorkflowSelection,
  WorkflowSuggestedAction,
  WorkflowStatus,
} from "./types";
import { summarizeWorkflowSelection } from "./utils/selection";

function asObjectArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function evidenceBackedTakeaways(run: WorkflowRun) {
  const evidence = asObjectArray<{ claim?: string; sources?: string[] }>(run.result?.metadata?.evidence_highlights);
  const items = evidence
    .map((item) => {
      const claim = String(item.claim || "").trim();
      if (!claim) return null;
      const sources = asObjectArray<string>(item.sources)
        .map((source) => String(source || "").trim())
        .filter(Boolean);
      return sources.length ? `${claim} (${sources.join(", ")})` : claim;
    })
    .filter((item): item is string => Boolean(item));
  return items.length ? items : (run.result?.bullets || []);
}

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

function formatSelection(run: WorkflowRun) {
  const files = run.selection.file_ids.length;
  const folders = run.selection.folder_paths.length;
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  return parts.join(" • ") || "No source selection";
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

function sameLocalDay(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

type RunView = "all" | "active" | "completed" | "attention";

function filterRunsByView(runs: WorkflowRun[], view: RunView) {
  switch (view) {
    case "active":
      return runs.filter((run) => run.status === "queued" || run.status === "running");
    case "completed":
      return runs.filter((run) => run.status === "completed");
    case "attention":
      return runs.filter((run) => run.status === "failed");
    default:
      return runs;
  }
}

function matchesSearch(run: WorkflowRun, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    run.title,
    run.workflow_id,
    run.result?.summary,
    run.error,
    run.selection.current_folder,
    formatCapability(run.capability),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function statusAccent(status: WorkflowStatus) {
  switch (status) {
    case "completed":
      return "bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "bg-destructive/8 text-destructive";
    case "running":
      return "bg-sky-500/8 text-sky-700 dark:text-sky-300";
    case "queued":
      return "bg-amber-500/8 text-amber-700 dark:text-amber-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function PaneHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-3">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">{title}</div>
        {meta ? <div className="truncate text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {action}
    </div>
  );
}

function RunListItem({
  run,
  active,
  onSelect,
}: {
  run: WorkflowRun;
  active: boolean;
  onSelect: (runId: string) => void;
}) {
  const Icon = getWorkflowIcon(run.workflow_id);

  return (
    <button
      type="button"
      onClick={() => onSelect(run.id)}
      className={cn(
        "w-full border-l-2 px-3 py-3 text-left transition-colors",
        active ? "border-l-primary bg-accent/30" : "border-l-transparent hover:bg-muted/25"
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-border/70 bg-background",
            statusAccent(run.status)
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium leading-5 text-foreground">{run.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{formatCapability(run.capability)}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span>{formatRelativeTime(run.updated_at)}</span>
              </div>
            </div>
            <WorkflowStatusBadge status={run.status} className="shrink-0 px-1.5 py-0 text-[10px]" />
          </div>

          <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-muted-foreground">{renderStatusCopy(run)}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{formatSelection(run)}</span>
            <span className="h-1 w-1 rounded-full bg-border" />
            <span className="truncate">{run.selection.current_folder || "Root"}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function WorkflowCatalogItem({
  workflow,
  onLaunch,
  disabled = false,
}: {
  workflow: WorkflowManifest;
  onLaunch: (workflow: WorkflowManifest) => void;
  disabled?: boolean;
}) {
  const Icon = getWorkflowIcon(workflow.workflow_id);

  return (
    <button
      type="button"
      onClick={() => onLaunch(workflow)}
      disabled={disabled}
      className="w-full border-b border-border/70 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/25 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border/70 bg-primary/5 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium leading-5 text-foreground">{workflow.title}</div>
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{workflow.description}</div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">
              {formatCapability(workflow.capability)}
            </Badge>
            {formatSelectionRequirements(workflow)
              .slice(0, 2)
              .map((item) => (
                <Badge
                  key={item}
                  variant="secondary"
                  className="rounded-none px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                >
                  {item}
                </Badge>
              ))}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function WorkflowsPage() {
  const [catalog, setCatalog] = useState<WorkflowManifest[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<RunView>("all");
  const [search, setSearch] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [workflowLauncherOpen, setWorkflowLauncherOpen] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowManifest | null>(null);
  const [launcherFiles, setLauncherFiles] = useState<FileItem[]>([]);
  const [launcherFilesLoading, setLauncherFilesLoading] = useState(false);
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);

  const emptyLauncherSelection = useMemo(
    () => summarizeWorkflowSelection({ file_ids: [], folder_paths: [], current_folder: "" }),
    []
  );

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

  const ensureLauncherFilesLoaded = useCallback(async () => {
    if (launcherFiles.length || launcherFilesLoading) return;
    setLauncherFilesLoading(true);
    try {
      const files = await listFiles();
      setLauncherFiles(files || []);
    } catch (err) {
      console.error("[workflows] file picker load error", err);
      toast.error("Failed to load files", { description: parseErr(err) });
    } finally {
      setLauncherFilesLoading(false);
    }
  }, [launcherFiles.length, launcherFilesLoading]);

  const openWorkflowLauncher = useCallback(
    (workflow: WorkflowManifest) => {
      setActiveWorkflow(workflow);
      setWorkflowLauncherOpen(true);
      void ensureLauncherFilesLoaded();
    },
    [ensureLauncherFilesLoaded]
  );

  const handleRunWorkflow = useCallback(
    async (workflow: WorkflowManifest, inputs: Record<string, unknown>, selection: WorkflowSelection) => {
      setWorkflowSubmitting(true);
      try {
        const run = await createWorkflowRun({
          workflow_id: workflow.workflow_id,
          selection,
          inputs,
        });
        setRuns((prev) => [run, ...prev.filter((item) => item.id !== run.id)].slice(0, 24));
        setSelectedRunId(run.id);
        setWorkflowLauncherOpen(false);
        setActiveWorkflow(null);
        toast.success(`${workflow.title} started`, {
          description: "You can follow the run in the inbox and review the finished output here.",
        });
      } catch (err) {
        console.error("[workflows] run error", err);
        toast.error(`Failed to run ${workflow.title}`, { description: parseErr(err) });
      } finally {
        setWorkflowSubmitting(false);
      }
    },
    []
  );

  const handleWorkflowAction = useCallback(
    async (action: WorkflowSuggestedAction, selection: WorkflowSelection) => {
      const workflow = catalog.find((item) => item.workflow_id === action.workflow_id);
      if (!workflow) {
        toast.error("That follow-up flow is not available right now.");
        return;
      }
      await handleRunWorkflow(
        workflow,
        {
          ...(action.focus ? { focus: action.focus } : {}),
        },
        selection,
      );
    },
    [catalog, handleRunWorkflow]
  );

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
    const completed = runs.filter((run) => run.status === "completed");
    const failed = runs.filter((run) => run.status === "failed");
    const inFlight = runs.filter((run) => run.status === "queued" || run.status === "running");
    const completedToday = completed.filter((run) => sameLocalDay(run.updated_at)).length;
    const terminalCount = completed.length + failed.length;
    const successRate = terminalCount ? Math.round((completed.length / terminalCount) * 100) : 0;

    return {
      completed: completed.length,
      failed: failed.length,
      inFlight: inFlight.length,
      completedToday,
      successRate,
    };
  }, [runs]);

  const runsByView = useMemo(
    () => ({
      all: runs,
      active: filterRunsByView(runs, "active"),
      completed: filterRunsByView(runs, "completed"),
      attention: filterRunsByView(runs, "attention"),
    }),
    [runs]
  );

  const visibleRuns = useMemo(() => {
    return filterRunsByView(runs, view).filter((run) => matchesSearch(run, search));
  }, [runs, search, view]);

  useEffect(() => {
    if (!visibleRuns.length) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !visibleRuns.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(visibleRuns[0]?.id ?? null);
    }
  }, [selectedRunId, visibleRuns]);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) || null, [runs, selectedRunId]);

  return (
    <div className="h-full min-h-0">
      <div className="grid h-full min-h-0 border border-border/70 bg-background xl:grid-cols-[320px_minmax(0,1fr)_280px] xl:divide-x xl:divide-border/70">
        <section className="flex min-h-[220px] min-w-0 flex-col border-b border-border/70 xl:min-h-0 xl:border-b-0">
          <PaneHeader
            title="Run inbox"
            meta={`Recent activity • ${stats.inFlight ? `${stats.inFlight} running` : "idle"} • ${stats.failed} failed • ${stats.completedToday} done today`}
            action={
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  className="h-8 rounded-none px-3 text-xs"
                  onClick={() => catalog[0] && openWorkflowLauncher(catalog[0])}
                  disabled={!catalog.length || workflowSubmitting}
                >
                  <Sparkles className="mr-1 h-3 w-3" />
                  New workflow
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-none px-3 text-xs"
                  onClick={() => loadPage({ silent: true })}
                  disabled={loading || refreshing}
                >
                  <RefreshCw className={cn("mr-1 h-3 w-3", refreshing && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            }
          />
          <div className="shrink-0 border-b border-border/70 px-3 py-3">
            <Tabs value={view} onValueChange={(value) => setView(value as RunView)}>
              <TabsList className="h-auto w-full justify-start rounded-none bg-muted/40 p-1">
                <TabsTrigger value="all" className="h-7 rounded-none px-2 text-xs">All {runsByView.all.length}</TabsTrigger>
                <TabsTrigger value="active" className="h-7 rounded-none px-2 text-xs">Active {runsByView.active.length}</TabsTrigger>
                <TabsTrigger value="completed" className="h-7 rounded-none px-2 text-xs">Done {runsByView.completed.length}</TabsTrigger>
                <TabsTrigger value="attention" className="h-7 rounded-none px-2 text-xs">Failed {runsByView.attention.length}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search runs"
                className="h-8 rounded-none border-border/80 bg-background pl-8 text-sm shadow-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {loading ? (
              <div className="p-3 text-sm text-muted-foreground">Loading workflow runs…</div>
            ) : visibleRuns.length ? (
              <ScrollArea className="h-full">
                <div className="divide-y divide-border/70">
                  {visibleRuns.map((run) => (
                    <RunListItem key={run.id} run={run} active={run.id === selectedRunId} onSelect={setSelectedRunId} />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="p-3 text-sm leading-5 text-muted-foreground">
                {search.trim()
                  ? "No workflow runs match this search yet."
                  : view === "all"
                    ? "No workflow runs yet. Pick a flow on the right to start one here."
                    : view === "active"
                      ? "No runs are currently queued or running."
                      : view === "completed"
                        ? "Completed workflow output will appear here once a run finishes."
                        : "Nothing needs review right now."}
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-[320px] min-w-0 flex-col border-b border-border/70 xl:min-h-0 xl:border-b-0">
          <PaneHeader
            title="Run details"
            meta={selectedRun ? `Updated ${formatRelativeTime(selectedRun.updated_at)}` : "Select a run to review output"}
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-none px-3 text-xs"
                onClick={() => loadPage({ silent: true })}
                disabled={loading || refreshing}
              >
                <RefreshCw className={cn("mr-1 h-3 w-3", refreshing && "animate-spin")} />
                Sync
              </Button>
            }
          />

          {selectedRun ? (
            <>
              <div className="shrink-0 border-b border-border/70 px-3 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center border border-border/70 bg-background", statusAccent(selectedRun.status))}>
                        {(() => {
                          const Icon = getWorkflowIcon(selectedRun.workflow_id);
                          return <Icon className="h-4 w-4" />;
                        })()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5 text-foreground">{selectedRun.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <WorkflowStatusBadge status={selectedRun.status} className="px-1.5 py-0 text-[10px]" />
                          <span>{formatCapability(selectedRun.capability)}</span>
                          <span className="h-1 w-1 rounded-full bg-border" />
                          <span>{formatSelection(selectedRun)}</span>
                          <span className="h-1 w-1 rounded-full bg-border" />
                          <span>{selectedRun.selection.current_folder || "Root"}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-none px-3 text-xs"
                    onClick={() => {
                      const workflow = catalog.find((item) => item.workflow_id === selectedRun.workflow_id);
                      if (workflow) openWorkflowLauncher(workflow);
                    }}
                    disabled={!catalog.some((item) => item.workflow_id === selectedRun.workflow_id)}
                  >
                    Run again
                  </Button>
                </div>
                <div className="mt-3 border-t border-border/70 pt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Overview</div>
                  <p className="mt-1.5 text-sm leading-5 text-foreground">{renderStatusCopy(selectedRun)}</p>
                </div>
              </div>

              {(selectedRun.result?.bullets?.length || selectedRun.result?.next_actions?.length) ? (
                <div className="grid shrink-0 border-b border-border/70 lg:grid-cols-2 lg:divide-x lg:divide-border/70">
                  <div className="px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Takeaways</div>
                    <div className="mt-2 space-y-2">
                      {evidenceBackedTakeaways(selectedRun).slice(0, 3).map((item, index) => (
                        <div key={`${item}-${index}`} className="text-sm leading-5 text-foreground">
                          {item}
                        </div>
                      ))}
                      {!evidenceBackedTakeaways(selectedRun).length ? (
                        <div className="text-sm leading-5 text-muted-foreground">No takeaways yet for this run.</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="border-t border-border/70 px-3 py-3 lg:border-t-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Next steps</div>
                    <div className="mt-2 space-y-2">
                      {(selectedRun.result?.next_actions || []).slice(0, 3).map((item, index) => (
                        <div key={`${item}-${index}`} className="text-sm leading-5 text-foreground">
                          {item}
                        </div>
                      ))}
                      {!selectedRun.result?.next_actions?.length ? (
                        <div className="text-sm leading-5 text-muted-foreground">No recommended next steps yet for this run.</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-3">
                    {selectedRun.result ? (
                      <WorkflowResultDetails
                        result={selectedRun.result}
                        selection={selectedRun.selection}
                        onWorkflowAction={handleWorkflowAction}
                      />
                    ) : selectedRun.status === "failed" ? (
                      <div className="border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm leading-5 text-destructive">
                        {selectedRun.error || "This workflow failed before returning an output."}
                      </div>
                    ) : (
                      <div className="text-sm leading-5 text-muted-foreground">
                        This run is still in progress. Refresh to pick up the latest result.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </>
          ) : (
            <div className="p-3 text-sm leading-5 text-muted-foreground">
              Choose a flow on the right to start a run here, or select a run from the inbox to review the latest output.
            </div>
          )}
        </section>

        <section className="flex min-h-[220px] min-w-0 flex-col xl:min-h-0">
          <PaneHeader
            title="Available flows"
            meta="Choose a flow, then pick files in the launcher"
            action={
              <Button asChild variant="ghost" size="sm" className="h-8 rounded-none px-3 text-xs">
                <Link to="/files">
                  Open Files
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            }
          />
          <div className="min-h-0 flex-1">
            {catalog.length ? (
              <ScrollArea className="h-full">
                <div>
                  {catalog.map((workflow) => (
                    <WorkflowCatalogItem
                      key={workflow.workflow_id}
                      workflow={workflow}
                      onLaunch={openWorkflowLauncher}
                      disabled={workflowSubmitting}
                    />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="p-3 text-sm leading-5 text-muted-foreground">
                Workflow starters will appear here once the catalog loads.
              </div>
            )}
          </div>
        </section>
      </div>

      <WorkflowLauncher
        open={workflowLauncherOpen}
        workflow={activeWorkflow}
        selection={emptyLauncherSelection}
        selectionMode="picker"
        availableFiles={launcherFiles}
        filesLoading={launcherFilesLoading}
        submitting={workflowSubmitting}
        onOpenChange={setWorkflowLauncherOpen}
        onRun={handleRunWorkflow}
      />
    </div>
  );
}
