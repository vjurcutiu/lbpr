import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ChevronRight,
  CornerDownRight,
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
import { useMediaQuery } from "@/features/files/hooks/useMediaQuery";
import { parseErr } from "@/features/files/utils/formatters";
import { cn } from "@/lib/utils";

import { createWorkflowRun, downloadWorkflowArtifact, listWorkflowRuns, listWorkflows, saveWorkflowArtifact } from "./api";
import { WorkflowLauncher } from "./components/WorkflowLauncher";
import { WorkflowResultDetails } from "./components/WorkflowResultDetails";
import { WorkflowStatusBadge } from "./components/WorkflowStatusBadge";
import { getWorkflowIcon } from "./registry";
import type {
  WorkflowCapability,
  WorkflowManifest,
  WorkflowRun,
  WorkflowSelection,
  WorkflowChainSource,
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



function compactCopy(text: string, max = 320) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max).trimEnd()}…` : normalized;
}

function workflowTitleForId(catalog: WorkflowManifest[], workflowId?: string, fallback = "Workflow") {
  if (!workflowId) return fallback;
  return catalog.find((item) => item.workflow_id === workflowId)?.title || fallback;
}

function cleanLauncherInputs(inputs: Record<string, unknown> | undefined | null) {
  const next = { ...(inputs || {}) };
  delete next.workflow_chain;
  return next;
}

function chainSourceFromRun(run: WorkflowRun | null | undefined, catalog: WorkflowManifest[]): WorkflowChainSource | null {
  const raw = run?.inputs?.workflow_chain;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const parentRunId = String(value.parent_run_id || "").trim();
  const parentWorkflowId = String(value.parent_workflow_id || "").trim();
  if (!parentRunId || !parentWorkflowId) return null;
  const parentWorkflowTitle = String(value.parent_workflow_title || workflowTitleForId(catalog, parentWorkflowId, "Workflow")).trim();
  return {
    parent_run_id: parentRunId,
    parent_workflow_id: parentWorkflowId,
    parent_workflow_title: parentWorkflowTitle || "Workflow",
    parent_title: String(value.parent_title || parentWorkflowTitle || "Previous run").trim(),
    action_label: String(value.action_label || "").trim() || undefined,
    summary: String(value.summary || "").trim() || undefined,
    selection_label: String(value.selection_label || "").trim() || undefined,
    source_file_count: Number(value.source_file_count || 0) || undefined,
    source_folder_count: Number(value.source_folder_count || 0) || undefined,
    parent_updated_at: String(value.parent_updated_at || "").trim() || undefined,
  };
}

function chainSourceForAction(run: WorkflowRun, action: WorkflowSuggestedAction, catalog: WorkflowManifest[]): WorkflowChainSource {
  return {
    parent_run_id: run.id,
    parent_workflow_id: run.workflow_id,
    parent_workflow_title: workflowTitleForId(catalog, run.workflow_id, run.title),
    parent_title: run.title,
    action_label: action.label,
    summary: compactCopy(run.result?.summary || ""),
    selection_label: formatSelection(run),
    source_file_count: run.selection.file_ids.length,
    source_folder_count: run.selection.folder_paths.length,
    parent_updated_at: run.updated_at,
  };
}

type LauncherOptions = {
  selection?: WorkflowSelection;
  initialInputs?: Record<string, unknown>;
  chainSource?: WorkflowChainSource | null;
};

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

function PaneScroller({
  mobile,
  className,
  children,
}: {
  mobile: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (mobile) return <div className={className}>{children}</div>;
  return <ScrollArea className={cn("h-full", className)}>{children}</ScrollArea>;
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

type MobilePanel = "inbox" | "details" | "flows";

export default function WorkflowsPage() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("inbox");
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
  const [artifactBusyRunId, setArtifactBusyRunId] = useState<string | null>(null);

  const emptyLauncherSelection = useMemo(
    () => summarizeWorkflowSelection({ file_ids: [], folder_paths: [], current_folder: "" }),
    []
  );
  const [launcherSelection, setLauncherSelection] = useState(emptyLauncherSelection);
  const [launcherInitialInputs, setLauncherInitialInputs] = useState<Record<string, unknown>>({});
  const [launcherChainSource, setLauncherChainSource] = useState<WorkflowChainSource | null>(null);

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
    (workflow: WorkflowManifest, options?: LauncherOptions) => {
      setActiveWorkflow(workflow);
      setLauncherSelection(summarizeWorkflowSelection(options?.selection || { file_ids: [], folder_paths: [], current_folder: "" }));
      setLauncherInitialInputs(cleanLauncherInputs(options?.initialInputs));
      setLauncherChainSource(options?.chainSource || null);
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
          inputs: {
            ...inputs,
            ...(launcherChainSource ? { workflow_chain: launcherChainSource } : {}),
          },
        });
        setRuns((prev) => [run, ...prev.filter((item) => item.id !== run.id)].slice(0, 24));
        setSelectedRunId(run.id);
        setWorkflowLauncherOpen(false);
        setActiveWorkflow(null);
        setLauncherSelection(emptyLauncherSelection);
        setLauncherInitialInputs({});
        setLauncherChainSource(null);
        if (isMobile) setMobilePanel("details");
        toast.success(`${workflow.title} started`, {
          description: launcherChainSource
            ? "The chained run is now live in the inbox and linked to its source workflow."
            : "You can follow the run in the inbox and review the finished output here.",
        });
      } catch (err) {
        console.error("[workflows] run error", err);
        toast.error(`Failed to run ${workflow.title}`, { description: parseErr(err) });
      } finally {
        setWorkflowSubmitting(false);
      }
    },
    [emptyLauncherSelection, isMobile, launcherChainSource]
  );

  const handleWorkflowAction = useCallback(
    (action: WorkflowSuggestedAction, selection: WorkflowSelection, sourceRun: WorkflowRun) => {
      const workflow = catalog.find((item) => item.workflow_id === action.workflow_id);
      if (!workflow) {
        toast.error("That follow-up flow is not available right now.");
        return;
      }
      openWorkflowLauncher(workflow, {
        selection,
        initialInputs: {
          ...(action.focus ? { focus: action.focus } : {}),
        },
        chainSource: chainSourceForAction(sourceRun, action, catalog),
      });
    },
    [catalog, openWorkflowLauncher]
  );

  const handleSaveArtifact = useCallback(async (run: WorkflowRun) => {
    if (!run.result || run.status !== "completed") return;
    setArtifactBusyRunId(run.id);
    try {
      const artifact = await saveWorkflowArtifact(run.id);
      setRuns((prev) => prev.map((item) => (item.id === run.id ? { ...item, artifact } : item)));
      toast.success("Artifact saved", {
        description: `${artifact.file_name} is now attached to this workflow run.`,
      });
      return artifact;
    } catch (err) {
      console.error("[workflows] save artifact error", err);
      toast.error("Failed to save artifact", { description: parseErr(err) });
      return null;
    } finally {
      setArtifactBusyRunId((current) => (current === run.id ? null : current));
    }
  }, []);

  const handleDownloadArtifact = useCallback(async (run: WorkflowRun) => {
    if (!run.result || run.status !== "completed") return;
    setArtifactBusyRunId(run.id);
    try {
      let artifact = run.artifact || null;
      if (!artifact) {
        artifact = await saveWorkflowArtifact(run.id);
        setRuns((prev) => prev.map((item) => (item.id === run.id ? { ...item, artifact } : item)));
      }
      await downloadWorkflowArtifact(artifact.id);
      toast.success("Artifact download started", { description: artifact.file_name });
    } catch (err) {
      console.error("[workflows] download artifact error", err);
      toast.error("Failed to download artifact", { description: parseErr(err) });
    } finally {
      setArtifactBusyRunId((current) => (current === run.id ? null : current));
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

  useEffect(() => {
    if (!isMobile) setMobilePanel("inbox");
  }, [isMobile]);

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
  const selectedRunChainSource = useMemo(() => chainSourceFromRun(selectedRun, catalog), [catalog, selectedRun]);
  const handleSelectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    if (isMobile) setMobilePanel("details");
  }, [isMobile]);
  const showInbox = !isMobile || mobilePanel === "inbox";
  const showDetails = !isMobile || mobilePanel === "details";
  const showFlows = !isMobile || mobilePanel === "flows";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {isMobile ? (
        <div className="sticky top-0 z-20 shrink-0 border border-border/70 border-b-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="border-b border-border/70 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Workflows</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {stats.inFlight ? `${stats.inFlight} active run${stats.inFlight === 1 ? "" : "s"}` : "Track runs and launch flows from one place."}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <Badge variant="outline" className="rounded-none px-1.5 py-0 font-normal">{runs.length} total</Badge>
              <Badge variant="outline" className="rounded-none px-1.5 py-0 font-normal">{stats.completedToday} done today</Badge>
              <Badge variant="outline" className="rounded-none px-1.5 py-0 font-normal">{stats.successRate}% success</Badge>
            </div>
          </div>
          <div className="px-4 py-3">
            <Tabs value={mobilePanel} onValueChange={(value) => setMobilePanel(value as MobilePanel)}>
              <TabsList className="grid h-auto w-full grid-cols-3 rounded-none bg-muted/40 p-1">
                <TabsTrigger value="inbox" className="h-8 rounded-none px-2 text-xs">Inbox {runs.length}</TabsTrigger>
                <TabsTrigger value="details" className="h-8 rounded-none px-2 text-xs">Details</TabsTrigger>
                <TabsTrigger value="flows" className="h-8 rounded-none px-2 text-xs">Flows {catalog.length}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      ) : null}

      <div className={cn("min-h-0 flex-1", isMobile ? "overflow-y-auto overscroll-contain" : "overflow-hidden")}>
        <div className={cn(
          "border border-border/70 bg-background",
          isMobile ? "border-t-0" : "grid h-full min-h-0 xl:grid-cols-[320px_minmax(0,1fr)_280px] xl:divide-x xl:divide-border/70"
        )}>
        <section className={cn("flex min-h-[220px] min-w-0 flex-col border-b border-border/70 xl:min-h-0 xl:border-b-0", !showInbox && "hidden")}>
          <PaneHeader
            title="Run inbox"
            meta={`Recent activity • ${stats.inFlight ? `${stats.inFlight} running` : "idle"} • ${stats.failed} failed • ${stats.completedToday} done today`}
            action={!isMobile ? (
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
            ) : null}
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
              <PaneScroller mobile={isMobile} className="h-full">
                <div className="divide-y divide-border/70">
                  {visibleRuns.map((run) => (
                    <RunListItem key={run.id} run={run} active={run.id === selectedRunId} onSelect={handleSelectRun} />
                  ))}
                </div>
              </PaneScroller>
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

        <section className={cn("flex min-h-[320px] min-w-0 flex-col border-b border-border/70 xl:min-h-0 xl:border-b-0", !showDetails && "hidden")}>
          <PaneHeader
            title="Run details"
            meta={selectedRun ? `Updated ${formatRelativeTime(selectedRun.updated_at)}` : "Select a run to review output"}
            action={!isMobile ? (
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
            ) : null}
          />

          {selectedRun ? (
            <div className="min-h-0 flex-1 overflow-hidden bg-muted/10">
              <PaneScroller mobile={isMobile} className="h-full">
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-5 md:px-8 lg:px-12 xl:px-16">
                  <div className="border border-border/70 bg-background px-5 py-5 shadow-sm md:px-8 md:py-8">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <div className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center border border-border/70 bg-background", statusAccent(selectedRun.status))}>
                            {(() => {
                              const Icon = getWorkflowIcon(selectedRun.workflow_id);
                              return <Icon className="h-5 w-5" />;
                            })()}
                          </div>
                          <div className="min-w-0 flex-1">
                            {selectedRunChainSource ? (
                              <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">
                                  <CornerDownRight className="mr-1 h-3 w-3" />
                                  Chained run
                                </Badge>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-left transition-colors hover:text-foreground"
                                  onClick={() => {
                                    if (runs.some((item) => item.id === selectedRunChainSource.parent_run_id)) {
                                      setSelectedRunId(selectedRunChainSource.parent_run_id);
                                      if (isMobile) setMobilePanel("details");
                                    }
                                  }}
                                  disabled={!runs.some((item) => item.id === selectedRunChainSource.parent_run_id)}
                                >
                                  <span>{selectedRunChainSource.parent_workflow_title}</span>
                                  <ChevronRight className="h-3 w-3" />
                                  <span>{selectedRun.title}</span>
                                </button>
                              </div>
                            ) : null}
                            <div className="text-lg font-semibold leading-7 text-foreground md:text-[1.35rem]">{selectedRun.title}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <WorkflowStatusBadge status={selectedRun.status} className="px-1.5 py-0 text-[10px]" />
                              {selectedRun.artifact ? (
                                <Badge variant="secondary" className="rounded-none px-1.5 py-0 text-[10px] font-normal">
                                  Artifact saved
                                </Badge>
                              ) : null}
                              <span>{formatCapability(selectedRun.capability)}</span>
                              <span className="h-1 w-1 rounded-full bg-border" />
                              <span>{formatSelection(selectedRun)}</span>
                              <span className="h-1 w-1 rounded-full bg-border" />
                              <span>{selectedRun.selection.current_folder || "Root"}</span>
                            </div>
                            <p className="mt-4 max-w-3xl text-[15px] leading-7 text-foreground/90">{renderStatusCopy(selectedRun)}</p>
                            {selectedRunChainSource ? (
                              <div className="mt-4 max-w-3xl border border-border/70 bg-muted/15 px-3 py-3">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">Inherited from previous workflow</div>
                                <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                  <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">{selectedRunChainSource.parent_title}</Badge>
                                  {selectedRunChainSource.selection_label ? <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">{selectedRunChainSource.selection_label}</Badge> : null}
                                  {selectedRunChainSource.action_label ? <Badge variant="secondary" className="rounded-none px-1.5 py-0 text-[10px] font-normal">{selectedRunChainSource.action_label}</Badge> : null}
                                </div>
                                {selectedRunChainSource.summary ? (
                                  <p className="mt-2 text-sm leading-6 text-foreground/85">{selectedRunChainSource.summary}</p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-none px-4 text-xs"
                        onClick={() => {
                          const workflow = catalog.find((item) => item.workflow_id === selectedRun.workflow_id);
                          if (workflow) {
                            openWorkflowLauncher(workflow, {
                              selection: selectedRun.selection,
                              initialInputs: cleanLauncherInputs(selectedRun.inputs),
                            });
                          }
                        }}
                        disabled={!catalog.some((item) => item.workflow_id === selectedRun.workflow_id)}
                      >
                        Run again
                      </Button>
                    </div>

                    {(selectedRun.result?.bullets?.length || selectedRun.result?.next_actions?.length) ? (
                      <div className="mt-6 grid gap-4 border-t border-border/70 pt-6 lg:grid-cols-2 lg:gap-6">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Takeaways</div>
                          <div className="mt-3 space-y-3">
                            {evidenceBackedTakeaways(selectedRun).slice(0, 3).map((item, index) => (
                              <div key={`${item}-${index}`} className="text-[15px] leading-7 text-foreground">
                                {item}
                              </div>
                            ))}
                            {!evidenceBackedTakeaways(selectedRun).length ? (
                              <div className="text-[15px] leading-7 text-muted-foreground">No takeaways yet for this run.</div>
                            ) : null}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Next steps</div>
                          <div className="mt-3 space-y-3">
                            {(selectedRun.result?.next_actions || []).slice(0, 3).map((item, index) => (
                              <div key={`${item}-${index}`} className="text-[15px] leading-7 text-foreground">
                                {item}
                              </div>
                            ))}
                            {!selectedRun.result?.next_actions?.length ? (
                              <div className="text-[15px] leading-7 text-muted-foreground">No recommended next steps yet for this run.</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="border border-border/70 bg-background px-5 py-5 shadow-sm md:px-8 md:py-8">
                    {selectedRun.result ? (
                      <WorkflowResultDetails
                        result={selectedRun.result}
                        selection={selectedRun.selection}
                        sourceRun={selectedRun}
                        artifact={selectedRun.artifact || null}
                        artifactBusy={artifactBusyRunId === selectedRun.id}
                        onSaveArtifact={() => { void handleSaveArtifact(selectedRun); }}
                        onDownloadArtifact={() => { void handleDownloadArtifact(selectedRun); }}
                        onWorkflowAction={handleWorkflowAction}
                      />
                    ) : selectedRun.status === "failed" ? (
                      <div className="border border-destructive/20 bg-destructive/5 px-4 py-4 text-[15px] leading-7 text-destructive">
                        {selectedRun.error || "This workflow failed before returning an output."}
                      </div>
                    ) : (
                      <div className="text-[15px] leading-7 text-muted-foreground">
                        This run is still in progress. Refresh to pick up the latest result.
                      </div>
                    )}
                  </div>
                </div>
              </PaneScroller>
            </div>
          ) : (
            <div className="p-5 text-sm leading-6 text-muted-foreground md:px-8 md:py-6">
              {isMobile ? (
                <div className="space-y-3">
                  <div>Choose a run from the inbox to review it, or open flows to launch a new workflow.</div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="h-8 rounded-none px-3 text-xs" onClick={() => setMobilePanel("inbox")}>Open inbox</Button>
                    <Button size="sm" className="h-8 rounded-none px-3 text-xs" onClick={() => setMobilePanel("flows")}>Browse flows</Button>
                  </div>
                </div>
              ) : (
                "Choose a flow on the right to start a run here, or select a run from the inbox to review the latest output."
              )}
            </div>
          )}
        </section>

        <section className={cn("flex min-h-[220px] min-w-0 flex-col xl:min-h-0", !showFlows && "hidden")}>
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
              <PaneScroller mobile={isMobile} className="h-full">
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
              </PaneScroller>
            ) : (
              <div className="p-3 text-sm leading-5 text-muted-foreground">
                Workflow starters will appear here once the catalog loads.
              </div>
            )}
          </div>
        </section>
        </div>
      </div>

      <WorkflowLauncher
        open={workflowLauncherOpen}
        workflow={activeWorkflow}
        selection={launcherSelection}
        selectionMode="picker"
        availableFiles={launcherFiles}
        filesLoading={launcherFilesLoading}
        submitting={workflowSubmitting}
        initialInputs={launcherInitialInputs}
        chainSource={launcherChainSource}
        onOpenChange={(open) => {
          setWorkflowLauncherOpen(open);
          if (!open) {
            setActiveWorkflow(null);
            setLauncherSelection(emptyLauncherSelection);
            setLauncherInitialInputs({});
            setLauncherChainSource(null);
          }
        }}
        onRun={handleRunWorkflow}
      />
    </div>
  );
}
