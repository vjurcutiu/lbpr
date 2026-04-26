import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, CornerDownRight, Pencil, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listFiles, type FileItem } from "@/features/files/api";
import { useMediaQuery } from "@/features/files/hooks/useMediaQuery";
import { parseErr } from "@/features/files/utils/formatters";
import { cn } from "@/lib/utils";

import { createWorkflowRun, downloadWorkflowArtifact, listWorkflowRuns, listWorkflows, renameWorkflowRun, saveWorkflowArtifact } from "./api";
import { WorkflowLauncher } from "./components/WorkflowLauncher";
import { WorkflowResultDetails } from "./components/WorkflowResultDetails";
import { WorkflowStatusBadge } from "./components/WorkflowStatusBadge";
import { getWorkflowIcon } from "./registry";
import type {
  WorkflowCapability,
  WorkflowArtifactFormat,
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

function sourceFileKeysFromMetadata(metadata: Record<string, unknown> | undefined | null) {
  const sourceFiles = asObjectArray<{ file_id?: string; name?: string }>(metadata?.source_files);
  return Array.from(
    new Set(
      sourceFiles
        .map((source) => String(source.file_id || source.name || "").trim())
        .filter(Boolean),
    ),
  );
}

function isSingleSourceWorkflow(run: WorkflowRun) {
  if (run.result?.metadata?.single_source_workflow === true) return true;
  const explicitCount = Number(run.result?.metadata?.source_file_count || 0);
  if (explicitCount === 1) return true;
  return sourceFileKeysFromMetadata(run.result?.metadata).length === 1;
}

function evidenceBackedTakeaways(run: WorkflowRun) {
  const evidence = asObjectArray<{ claim?: string; sources?: string[] }>(run.result?.metadata?.evidence_highlights);
  const hideSources = isSingleSourceWorkflow(run);
  const items = evidence
    .map((item) => {
      const claim = String(item.claim || "").trim();
      if (!claim) return null;
      const sources = hideSources
        ? []
        : asObjectArray<string>(item.sources)
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

function summarizeWorkflowSelectionLabel(selection: WorkflowSelection) {
  const files = selection.file_ids.length;
  const folders = selection.folder_paths.length;
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  return parts.join(" • ") || "the current selection";
}

function workflowQueuedDescription(selection: WorkflowSelection, chained: boolean) {
  const target = summarizeWorkflowSelectionLabel(selection);
  return chained
    ? `Started for ${target}. This follow-up run will stay linked to the original result.`
    : `Started for ${target}. The result will appear in Runs when it is ready.`;
}

function workflowCompletedDescription(run: WorkflowRun) {
  const artifactName = String(run.artifact?.file_name || "").trim();
  return artifactName ? `${artifactName} is ready to review.` : "The output is ready to review.";
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
    parts.push(`Needs exactly ${selection.exact_file_count} file${selection.exact_file_count === 1 ? "" : "s"}`);
  } else {
    parts.push(`Needs ${selection.min_total_items}+ item${selection.min_total_items === 1 ? "" : "s"}`);
    if (selection.max_total_items != null) {
      parts.push(`Up to ${selection.max_total_items}`);
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
    return run.result?.summary || "This result is ready to review.";
  }
  if (run.status === "failed") {
    return run.error || "This workflow did not complete. Check the message below or try again with a different selection.";
  }
  if (run.status === "running") {
    return "Processing now. The result will appear here automatically when it finishes.";
  }
  return "Waiting to start. No action is needed.";
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
        active ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-muted/30"
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background",
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
            {run.selection.current_folder ? (
              <>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span className="truncate">{run.selection.current_folder}</span>
              </>
            ) : null}
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
      className="w-full border-b border-border/70 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-primary/5 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium leading-5 text-foreground">{workflow.title}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{workflow.description}</div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">
              {formatCapability(workflow.capability)}
            </Badge>
            {formatSelectionRequirements(workflow)
              .slice(0, 2)
              .map((item) => (
                <Badge
                  key={item}
                  variant="secondary"
                  className="rounded-full px-2 py-0 text-[10px] font-normal text-muted-foreground"
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
  const [, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [workflowLauncherOpen, setWorkflowLauncherOpen] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowManifest | null>(null);
  const [launcherFiles, setLauncherFiles] = useState<FileItem[]>([]);
  const [launcherFilesLoading, setLauncherFilesLoading] = useState(false);
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const [artifactBusyRunId, setArtifactBusyRunId] = useState<string | null>(null);
  const [renamingRunId, setRenamingRunId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const prevRunStatusRef = useRef<Map<string, WorkflowStatus>>(new Map());
  const hasHydratedRunStatusesRef = useRef(false);

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
        toast.message(`${workflow.title} queued`, {
          description: workflowQueuedDescription(selection, !!launcherChainSource),
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
      toast.success("Output saved", {
        description: `${artifact.file_name} is saved with this result.`,
      });
      return artifact;
    } catch (err) {
      console.error("[workflows] save artifact error", err);
      toast.error("Failed to save output", { description: parseErr(err) });
      return null;
    } finally {
      setArtifactBusyRunId((current) => (current === run.id ? null : current));
    }
  }, []);

  const handleDownloadArtifact = useCallback(async (run: WorkflowRun, format: WorkflowArtifactFormat = "markdown") => {
    if (!run.result || run.status !== "completed") return;
    setArtifactBusyRunId(run.id);
    try {
      let artifact = run.artifact || null;
      if (!artifact) {
        artifact = await saveWorkflowArtifact(run.id);
        setRuns((prev) => prev.map((item) => (item.id === run.id ? { ...item, artifact } : item)));
      }
      await downloadWorkflowArtifact(artifact.id, format);
      toast.success("Download started", { description: `${artifact.title} • ${format.toUpperCase()}` });
    } catch (err) {
      console.error("[workflows] download artifact error", err);
      toast.error("Failed to download output", { description: parseErr(err) });
    } finally {
      setArtifactBusyRunId((current) => (current === run.id ? null : current));
    }
  }, []);

  useEffect(() => {
    const nextMap = new Map<string, WorkflowStatus>();
    for (const run of runs) nextMap.set(run.id, run.status);

    if (!hasHydratedRunStatusesRef.current) {
      prevRunStatusRef.current = nextMap;
      hasHydratedRunStatusesRef.current = true;
      return;
    }

    const prev = prevRunStatusRef.current;
    const completed = runs.filter((run) => {
      const before = prev.get(run.id);
      return (before === "queued" || before === "running") && run.status === "completed";
    });
    const failed = runs.filter((run) => {
      const before = prev.get(run.id);
      return (before === "queued" || before === "running") && run.status === "failed";
    });

    prevRunStatusRef.current = nextMap;

    if (completed.length === 1) {
      toast.success(`${completed[0].title} finished`, {
        description: workflowCompletedDescription(completed[0]),
      });
    } else if (completed.length > 1) {
      toast.success(`${completed.length} workflows finished`, {
        description: "Open Runs to review the outputs.",
      });
    }

    if (failed.length === 1) {
      toast.error(`${failed[0].title} failed`, {
        description: failed[0].error?.trim() || "Open Runs to review the error.",
      });
    } else if (failed.length > 1) {
      toast.error(`${failed.length} workflows failed`, {
        description: "Open Runs to review the errors.",
      });
    }
  }, [runs]);

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



  const visibleRuns = useMemo(() => {
    return runs.filter((run) => matchesSearch(run, search));
  }, [runs, search]);

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

  const startRenamingRun = useCallback((run: WorkflowRun) => {
    setRenamingRunId(run.id);
    setRenameTitle(run.title);
  }, []);

  const cancelRenamingRun = useCallback(() => {
    if (renameSaving) return;
    setRenamingRunId(null);
    setRenameTitle("");
  }, [renameSaving]);

  const submitRunRename = useCallback(async (run: WorkflowRun) => {
    const title = renameTitle.replace(/\s+/g, " ").trim();
    if (!title) {
      toast.error("Add a title before saving.");
      return;
    }
    if (title === run.title) {
      setRenamingRunId(null);
      setRenameTitle("");
      return;
    }

    setRenameSaving(true);
    try {
      const updated = await renameWorkflowRun(run.id, title);
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setRenamingRunId(null);
      setRenameTitle("");
      toast.success("Workflow renamed");
    } catch (err) {
      console.error("[workflows] rename error", err);
      toast.error("Failed to rename workflow", { description: parseErr(err) });
    } finally {
      setRenameSaving(false);
    }
  }, [renameTitle]);

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
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">Workflows</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {stats.inFlight ? `${stats.inFlight} active run${stats.inFlight === 1 ? "" : "s"}` : "Run document workflows and review finished outputs."}
                </div>
              </div>
            </div>
          </div>
          <div className="px-4 py-3">
            <Tabs value={mobilePanel} onValueChange={(value) => setMobilePanel(value as MobilePanel)}>
              <TabsList className="grid h-auto w-full grid-cols-3 rounded-full bg-muted/40 p-1">
                <TabsTrigger value="inbox" className="h-8 rounded-full px-2 text-xs">Runs {runs.length}</TabsTrigger>
                <TabsTrigger value="details" className="h-8 rounded-full px-2 text-xs">Details</TabsTrigger>
                <TabsTrigger value="flows" className="h-8 rounded-full px-2 text-xs">Workflows {catalog.length}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      ) : null}

      <div className={cn("min-h-0 flex-1", isMobile ? "overflow-y-auto overscroll-contain" : "overflow-hidden")}>
        <div className={cn(
          "border border-border/70 bg-background shadow-sm",
          isMobile ? "border-t-0" : "grid h-full min-h-0 xl:grid-cols-[310px_minmax(0,1fr)_300px] xl:divide-x xl:divide-border/70"
        )}>
        <section className={cn("flex min-h-[220px] min-w-0 flex-col border-b border-border/70 xl:min-h-0 xl:border-b-0", !showInbox && "hidden")}>
          <div className="shrink-0 border-b border-border/70 px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search runs"
                className="h-8 rounded-full border-border/80 bg-background pl-8 text-sm shadow-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {loading ? (
              <div className="p-3 text-sm text-muted-foreground">Loading workflow runs…</div>
            ) : visibleRuns.length ? (
              <PaneScroller mobile={isMobile} className={isMobile ? undefined : "h-full"}>
                <div className="divide-y divide-border/70">
                  {visibleRuns.map((run) => (
                    <RunListItem key={run.id} run={run} active={run.id === selectedRunId} onSelect={handleSelectRun} />
                  ))}
                </div>
              </PaneScroller>
            ) : (
              <div className="p-3 text-sm leading-5 text-muted-foreground">
                {search.trim() ? "No workflow runs match this search yet." : "No workflow runs yet. Start one from the workflow list."}
              </div>
            )}
          </div>
        </section>

        <section className={cn("flex min-h-[320px] min-w-0 flex-col border-b border-border/70 xl:min-h-0 xl:border-b-0", !showDetails && "hidden")}>

          {selectedRun ? (
            <div className={cn("min-h-0 flex-1 bg-muted/15", !isMobile && "overflow-hidden")}>
              <PaneScroller mobile={isMobile} className={isMobile ? undefined : "h-full"}>
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-3 py-4 sm:px-4 md:px-8 lg:px-10 xl:px-12">
                  <div className="rounded-2xl border border-border/70 bg-background px-5 py-5 shadow-sm md:px-8 md:py-7">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <div className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background", statusAccent(selectedRun.status))}>
                            {(() => {
                              const Icon = getWorkflowIcon(selectedRun.workflow_id);
                              return <Icon className="h-5 w-5" />;
                            })()}
                          </div>
                          <div className="min-w-0 flex-1">
                            {selectedRunChainSource ? (
                              <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">
                                  <CornerDownRight className="mr-1 h-3 w-3" />
                                  Follow-up
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
                            {renamingRunId === selectedRun.id ? (
                              <form
                                className="flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void submitRunRename(selectedRun);
                                }}
                              >
                                <Input
                                  autoFocus
                                  value={renameTitle}
                                  onChange={(event) => setRenameTitle(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") cancelRenamingRun();
                                  }}
                                  className="h-10 rounded-xl text-base font-semibold md:text-lg"
                                  maxLength={120}
                                  disabled={renameSaving}
                                />
                                <div className="flex shrink-0 gap-1.5">
                                  <button
                                    type="submit"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={renameSaving}
                                    aria-label="Save workflow title"
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                    onClick={cancelRenamingRun}
                                    disabled={renameSaving}
                                    aria-label="Cancel rename"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <div className="flex max-w-3xl items-start gap-2">
                                <div className="min-w-0 flex-1 text-lg font-semibold leading-7 text-foreground md:text-[1.35rem]">{selectedRun.title}</div>
                                <button
                                  type="button"
                                  className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition-colors hover:text-foreground"
                                  onClick={() => startRenamingRun(selectedRun)}
                                  aria-label="Rename workflow"
                                  title="Rename"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <WorkflowStatusBadge status={selectedRun.status} className="px-1.5 py-0 text-[10px]" />
                              {selectedRun.artifact ? (
                                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">
                                  Output saved
                                </Badge>
                              ) : null}
                              <span>{formatCapability(selectedRun.capability)}</span>
                              <span className="h-1 w-1 rounded-full bg-border" />
                              <span>{formatSelection(selectedRun)}</span>
                              {selectedRun.selection.current_folder ? (
                                <>
                                  <span className="h-1 w-1 rounded-full bg-border" />
                                  <span>{selectedRun.selection.current_folder}</span>
                                </>
                              ) : null}
                            </div>
                            <p className="mt-4 max-w-3xl text-[15px] leading-7 text-foreground/90">{renderStatusCopy(selectedRun)}</p>
                            {selectedRunChainSource ? (
                              <div className="mt-4 max-w-3xl border border-border/70 bg-muted/15 px-3 py-3">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">Built from previous result</div>
                                <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                  <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">{selectedRunChainSource.parent_title}</Badge>
                                  {selectedRunChainSource.selection_label ? <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">{selectedRunChainSource.selection_label}</Badge> : null}
                                  {selectedRunChainSource.action_label ? <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">{selectedRunChainSource.action_label}</Badge> : null}
                                </div>
                                {selectedRunChainSource.summary ? (
                                  <p className="mt-2 text-sm leading-6 text-foreground/85">{selectedRunChainSource.summary}</p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    {(selectedRun.result?.bullets?.length || selectedRun.result?.next_actions?.length) ? (
                      <div className="mt-6 grid gap-4 border-t border-border/70 pt-6 lg:grid-cols-2 lg:gap-6">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">Takeaways</div>
                          <div className="mt-3 space-y-3">
                            {evidenceBackedTakeaways(selectedRun).slice(0, 3).map((item, index) => (
                              <div key={`${item}-${index}`} className="text-[15px] leading-7 text-foreground">
                                {item}
                              </div>
                            ))}
                            {!evidenceBackedTakeaways(selectedRun).length ? (
                              <div className="text-[15px] leading-7 text-muted-foreground">No takeaways yet.</div>
                            ) : null}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">Next steps</div>
                          <div className="mt-3 space-y-3">
                            {(selectedRun.result?.next_actions || []).slice(0, 3).map((item, index) => (
                              <div key={`${item}-${index}`} className="text-[15px] leading-7 text-foreground">
                                {item}
                              </div>
                            ))}
                            {!selectedRun.result?.next_actions?.length ? (
                              <div className="text-[15px] leading-7 text-muted-foreground">No recommended next steps yet.</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-background px-5 py-5 shadow-sm md:px-8 md:py-7">
                    {selectedRun.result ? (
                      <WorkflowResultDetails
                        result={selectedRun.result}
                        selection={selectedRun.selection}
                        sourceRun={selectedRun}
                        artifact={selectedRun.artifact || null}
                        artifactBusy={artifactBusyRunId === selectedRun.id}
                        onSaveArtifact={() => { void handleSaveArtifact(selectedRun); }}
                        onDownloadArtifact={(format) => { void handleDownloadArtifact(selectedRun, format); }}
                        onWorkflowAction={handleWorkflowAction}
                      />
                    ) : selectedRun.status === "failed" ? (
                      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-4 text-[15px] leading-7 text-destructive">
                        {selectedRun.error || "This workflow failed before returning an output."}
                      </div>
                    ) : (
                      <div className="text-[15px] leading-7 text-muted-foreground">
                        This workflow is still processing. Refresh to check for the latest result.
                      </div>
                    )}
                  </div>
                </div>
              </PaneScroller>
            </div>
          ) : (
            <div className="p-5 text-sm leading-6 text-muted-foreground md:px-8 md:py-6">
              {isMobile
                ? "Choose a run to review it, or open the Workflows tab to start a new one."
                : "Start a workflow from the right panel, or choose a run to review its result."}
            </div>
          )}
        </section>

        <section className={cn("flex min-h-[220px] min-w-0 flex-col xl:min-h-0", !showFlows && "hidden")}>
          <div className="min-h-0 flex-1">
            {catalog.length ? (
              <PaneScroller mobile={isMobile} className={isMobile ? undefined : "h-full"}>
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
                Workflows will appear here once the catalog loads.
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
