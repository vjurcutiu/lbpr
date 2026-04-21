import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MoreHorizontal, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { listWorkflowRuns } from "@/features/workflows/api";
import { WorkflowStatusBadge } from "@/features/workflows/components/WorkflowStatusBadge";
import { getWorkflowIcon } from "@/features/workflows/registry";
import type { WorkflowRun } from "@/features/workflows/types";

import { clearUploadJobs, listUploadJobs, type UploadJob } from "../uploadTrackerApi";

function phaseLabel(p: UploadJob["phase"]) {
  switch (p) {
    case "receive":
      return "Receiving";
    case "upload":
      return "Storing";
    case "transcribe":
      return "Transcribing";
    case "ocr":
      return "OCR";
    case "extract":
      return "Extracting";
    case "embed":
      return "Embedding";
    case "upsert":
      return "Upserting";
    case "complete":
      return "Complete";
    case "error":
      return "Error";
  }
}

function fmtBytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
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

function formatWorkflowSelection(run: WorkflowRun) {
  const files = run.selection.file_ids.length;
  const folders = run.selection.folder_paths.length;
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  if (run.selection.current_folder) parts.push(run.selection.current_folder);
  return parts.join(" • ") || "No source selection";
}


function workflowCompletionDescription(run: WorkflowRun) {
  const artifactName = String(run.artifact?.file_name || "").trim();
  return artifactName ? `${artifactName} is ready to review.` : "The output is ready to review.";
}

export function UploadTrackerPanel({
  open,
  onClose,
  refreshKey,
  onAnyComplete,
  onCleared,
  optimistic = [],
  batchFilenames = [],
  showHistory = false,
  seedFetched = [],
  seedWorkflowRuns = [],
}: {
  open: boolean;
  onClose: () => void;
  refreshKey?: number | string;
  onAnyComplete?: (newlyCompleted: UploadJob[]) => void;
  onCleared?: (scope: "done" | "all") => void;
  optimistic?: UploadJob[];
  batchFilenames?: string[];
  showHistory?: boolean;
  seedFetched?: UploadJob[];
  seedWorkflowRuns?: WorkflowRun[];
}) {
  const [jobsFetched, setJobsFetched] = useState<UploadJob[]>(seedFetched || []);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>(seedWorkflowRuns || []);
  const [busy, setBusy] = useState(false);
  const prevStatusRef = useRef<Map<string, UploadJob["status"]>>(new Map());
  const prevWorkflowStatusRef = useRef<Map<string, WorkflowRun["status"]>>(new Map());
  const hasHydratedWorkflowStatusesRef = useRef(false);

  useEffect(() => {
    if (seedFetched && seedFetched.length > 0) {
      setJobsFetched(seedFetched);
      const nextMap = new Map<string, UploadJob["status"]>();
      for (const j of seedFetched) nextMap.set(j.job_id, j.status);
      prevStatusRef.current = nextMap;
    }
  }, [seedFetched]);

  useEffect(() => {
    if (seedWorkflowRuns && seedWorkflowRuns.length > 0) {
      setWorkflowRuns(seedWorkflowRuns);
    }
  }, [seedWorkflowRuns]);

  useEffect(() => {
    const nextMap = new Map<string, WorkflowRun["status"]>();
    for (const run of workflowRuns) nextMap.set(run.id, run.status);

    if (!hasHydratedWorkflowStatusesRef.current) {
      prevWorkflowStatusRef.current = nextMap;
      hasHydratedWorkflowStatusesRef.current = true;
      return;
    }

    const prev = prevWorkflowStatusRef.current;
    const completed = workflowRuns.filter((run) => {
      const before = prev.get(run.id);
      return (before === "queued" || before === "running") && run.status === "completed";
    });
    const failed = workflowRuns.filter((run) => {
      const before = prev.get(run.id);
      return (before === "queued" || before === "running") && run.status === "failed";
    });

    prevWorkflowStatusRef.current = nextMap;

    if (completed.length === 1) {
      toast.success(`${completed[0].title} finished`, {
        description: workflowCompletionDescription(completed[0]),
      });
    } else if (completed.length > 1) {
      toast.success(`${completed.length} workflows finished`, {
        description: "Open Workflows to review the outputs.",
      });
    }

    if (failed.length === 1) {
      toast.error(`${failed[0].title} failed`, {
        description: failed[0].error?.trim() || "Open Workflows to review the error.",
      });
    } else if (failed.length > 1) {
      toast.error(`${failed.length} workflows failed`, {
        description: "Open Workflows to review the errors.",
      });
    }
  }, [workflowRuns]);

  const refresh = async () => {
    setBusy(true);
    try {
      const [items, workflowRes] = await Promise.all([listUploadJobs(), listWorkflowRuns(12)]);
      const prev = prevStatusRef.current;
      const newly: UploadJob[] = [];
      for (const j of items) {
        const before = prev.get(j.job_id);
        if ((before === "running" || before === undefined) && (j.status === "done" || j.status === "error")) {
          newly.push(j);
        }
      }

      const nextMap = new Map<string, UploadJob["status"]>();
      for (const j of items) nextMap.set(j.job_id, j.status);
      prevStatusRef.current = nextMap;

      setJobsFetched(items);
      setWorkflowRuns(workflowRes.items || []);
      if (newly.length > 0) onAnyComplete?.(newly);
    } catch (e) {
      console.error("[taskTracker] list error", e);
    } finally {
      setBusy(false);
    }
  };

  const mergedJobs = useMemo(() => {
    const fetchedByFilename = new Map<string, UploadJob>();
    const fetchedIds = new Set<string>();
    for (const j of jobsFetched) {
      fetchedIds.add(j.job_id);
      const prev = fetchedByFilename.get(j.filename);
      if (!prev || j.updated_at >= prev.updated_at) fetchedByFilename.set(j.filename, j);
    }

    const dedupOptimistic = optimistic.filter((o) => {
      if (fetchedIds.has(o.job_id)) return false;
      if (o.job_id.startsWith("temp:")) {
        return !fetchedByFilename.has(o.filename);
      }
      return true;
    });

    let arr = [...jobsFetched, ...dedupOptimistic];

    if (!showHistory && batchFilenames.length > 0) {
      const allow = new Set(batchFilenames);
      const best = new Map<string, UploadJob>();
      for (const j of arr) {
        if (!allow.has(j.filename) && !j.job_id.startsWith("temp:")) continue;
        const prev = best.get(j.filename);
        const isBetter =
          !prev ||
          j.updated_at > prev.updated_at ||
          (prev.job_id.startsWith("temp:") && !j.job_id.startsWith("temp:"));
        if (isBetter) best.set(j.filename, j);
      }
      arr = Array.from(best.values());
    } else {
      const byId = new Map<string, UploadJob>();
      for (const j of arr) {
        if (!byId.has(j.job_id)) byId.set(j.job_id, j);
      }
      arr = Array.from(byId.values());
    }

    return arr.sort((a, b) => b.updated_at - a.updated_at);
  }, [optimistic, jobsFetched, batchFilenames, showHistory]);

  const anyActive = useMemo(
    () =>
      mergedJobs.some((j) => j.status === "running") ||
      workflowRuns.some((run) => run.status === "queued" || run.status === "running"),
    [mergedJobs, workflowRuns]
  );

  const hasActiveOptimisticJobs = useMemo(() => optimistic.some((j) => j.status === "running"), [optimistic]);
  const hasActiveSeedWorkflowRuns = useMemo(
    () => seedWorkflowRuns.some((run) => run.status === "queued" || run.status === "running"),
    [seedWorkflowRuns]
  );
  const shouldTrack = open || anyActive || hasActiveOptimisticJobs || hasActiveSeedWorkflowRuns;

  useEffect(() => {
    if (shouldTrack) void refresh();
  }, [shouldTrack]);
  useEffect(() => {
    if (shouldTrack) void refresh();
  }, [refreshKey, shouldTrack]);


  useEffect(() => {
    if (!shouldTrack) return;
    let cancelled = false;
    let timer: number | null = null;
    let inflight = false;

    const tick = async () => {
      if (cancelled || inflight) return;
      inflight = true;
      try {
        await refresh();
      } finally {
        inflight = false;
        if (cancelled) return;
        const delay = anyActive ? 1000 : 5000;
        timer = window.setTimeout(tick, delay);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [shouldTrack, anyActive, refreshKey]);

  const uploadTotals = useMemo(() => {
    const all = mergedJobs.length;
    const done = mergedJobs.filter((j) => j.status !== "running").length;
    return { all, done };
  }, [mergedJobs]);

  const workflowTotals = useMemo(() => {
    const all = workflowRuns.length;
    const done = workflowRuns.filter((run) => run.status === "completed" || run.status === "failed").length;
    return { all, done };
  }, [workflowRuns]);

  const totals = useMemo(
    () => ({
      all: uploadTotals.all + workflowTotals.all,
      done: uploadTotals.done + workflowTotals.done,
    }),
    [uploadTotals, workflowTotals]
  );

  const doClear = async (scope: "done" | "all") => {
    try {
      const { removed } = await clearUploadJobs(scope);
      if (removed > 0) {
        const plural = removed === 1 ? "entry" : "entries";
        ;(toast as any).success(scope === "all" ? "Upload history cleared" : "Completed uploads cleared", {
          description: `${removed} ${plural} removed.`,
        });
      } else {
        (toast as any).message("Nothing to clear", { description: "No matching upload entries." });
      }

      if (scope === "all") {
        setJobsFetched([]);
        prevStatusRef.current = new Map();
      } else {
        setJobsFetched((prev) => {
          const keep = prev.filter((j) => j.status === "running");
          const nextMap = new Map<string, UploadJob["status"]>();
          for (const j of keep) nextMap.set(j.job_id, j.status);
          prevStatusRef.current = nextMap;
          return keep;
        });
      }
      onCleared?.(scope);

      await refresh();
    } catch (e: any) {
      console.error(e);
      (toast as any).error("Failed to clear uploads", { description: e?.message ?? String(e) });
    }
  };

  const hasUploads = mergedJobs.length > 0;
  const hasWorkflows = workflowRuns.length > 0;
  const isEmpty = !hasUploads && !hasWorkflows;

  return (
    <div
      className={cn(
        "fixed z-50 rounded-lg border bg-background shadow-xl",
        "left-2 right-2 bottom-2 md:left-auto md:right-4 md:bottom-4 md:w-[460px]",
        "max-w-[95vw]",
        "transition-transform duration-200",
        open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"
      )}
      role="dialog"
      aria-hidden={!open}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div>
          <div className="text-sm font-medium">Tasks</div>
          <div className="text-xs text-muted-foreground">
            {totals.all > 0 ? `(${totals.done}/${totals.all} complete)` : "Uploads and workflows in one place"}
          </div>
        </div>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" title="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[14rem]">
            <DropdownMenuItem onClick={() => doClear("done")}>Clear completed uploads</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => doClear("all")}>
              Clear all upload history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-auto p-3 md:max-h-[55vh]">
        {isEmpty ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            {batchFilenames.length > 0 && !showHistory
              ? "This batch has no visible items yet. Waiting for the server to create tasks…"
              : "No tasks right now."}
          </div>
        ) : null}

        {hasUploads ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <div>
                <div className="text-sm font-medium">Uploads</div>
                <div className="text-xs text-muted-foreground">
                  {uploadTotals.all} tracked • {uploadTotals.done} complete
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {mergedJobs.map((j) => (
                <div key={j.job_id} className="rounded-xl border p-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <div className="truncate font-medium" title={j.filename}>
                      {j.filename}
                    </div>
                    <div
                      className={cn(
                        "rounded px-1.5 py-0.5",
                        j.status === "error"
                          ? "bg-destructive/20 text-destructive"
                          : j.status === "done"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      )}
                    >
                      {phaseLabel(j.phase)}
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-muted">
                    <div
                      className={cn("h-full transition-all", j.status === "error" ? "bg-destructive" : "bg-primary")}
                      style={{ width: `${Math.max(0, Math.min(100, j.pct))}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <div>
                      {fmtBytes(j.bytes)} / {fmtBytes(j.total_bytes || 0)}
                    </div>
                    <div>{j.pct}%</div>
                  </div>
                  {j.error && j.status === "error" ? <div className="mt-1 text-xs text-destructive">{j.error}</div> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {hasWorkflows ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <div>
                <div className="text-sm font-medium">Workflows</div>
                <div className="text-xs text-muted-foreground">
                  {workflowTotals.all} tracked • {workflowTotals.done} complete
                </div>
              </div>
              <Button asChild variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs">
                <Link to="/workflows">
                  Open
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>

            <div className="space-y-2">
              {workflowRuns.map((run) => {
                const Icon = getWorkflowIcon(run.workflow_id);
                return (
                  <div key={run.id} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{run.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{formatWorkflowSelection(run)}</div>
                          </div>
                        </div>
                      </div>
                      <WorkflowStatusBadge status={run.status} className="shrink-0" />
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">Updated {formatRelativeTime(run.updated_at)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
