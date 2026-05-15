import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, MoreHorizontal, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { clearUploadJobs, listUploadJobs, type UploadJob } from "../uploadTrackerApi";

function phaseLabel(p: UploadJob["phase"]) {
  switch (p) {
    case "receive":
      return "Receiving";
    case "queued":
      return "Queued";
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

function uploadStatusLabel(status: UploadJob["status"]) {
  switch (status) {
    case "done":
      return "Complete";
    case "error":
      return "Error";
    case "running":
      return "Running";
  }
}

function UploadStatusIcon({ status }: { status: UploadJob["status"] }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "error") return <XCircle className="h-4 w-4" />;
  return <Loader2 className="h-4 w-4 animate-spin" />;
}

function uploadStatusAccentClass(status: UploadJob["status"]) {
  if (status === "done") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  if (status === "error") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400";
}

function formatUploadSecondaryText(job: UploadJob) {
  if (job.status === "running") {
    return `${fmtBytes(job.bytes)} / ${fmtBytes(job.total_bytes || 0)}`;
  }
  if (job.status === "error") {
    return job.error?.trim() || "Upload failed.";
  }
  return `Uploaded ${formatRelativeTime(new Date(job.updated_at * 1000).toISOString())}`;
}
export function UploadTrackerPanel({
  open,
  onClose,
  refreshKey,
  onAnyComplete,
  onCleared,
  onOpenUpload,
  optimistic = [],
  batchFilenames = [],
  showHistory = false,
  seedFetched = [],
}: {
  open: boolean;
  onClose: () => void;
  refreshKey?: number | string;
  onAnyComplete?: (newlyCompleted: UploadJob[]) => void;
  onCleared?: (scope: "done" | "all") => void;
  onOpenUpload?: (job: UploadJob) => void;
  optimistic?: UploadJob[];
  batchFilenames?: string[];
  showHistory?: boolean;
  seedFetched?: UploadJob[];
}) {
  const [jobsFetched, setJobsFetched] = useState<UploadJob[]>(seedFetched || []);
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
  const prevStatusRef = useRef<Map<string, UploadJob["status"]>>(new Map());
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (seedFetched && seedFetched.length > 0) {
      setJobsFetched(seedFetched);
      const nextMap = new Map<string, UploadJob["status"]>();
      for (const j of seedFetched) nextMap.set(j.job_id, j.status);
      prevStatusRef.current = nextMap;
    }
  }, [seedFetched]);

  const refresh = useCallback(
    async (options?: { showBusy?: boolean }) => {
      const showBusy = !!options?.showBusy;
      if (showBusy) setManualRefreshBusy(true);

      if (!refreshInFlightRef.current) {
        refreshInFlightRef.current = (async () => {
          try {
            const items = await listUploadJobs();
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
            if (newly.length > 0) onAnyComplete?.(newly);
          } catch (e) {
            console.error("[taskTracker] list error", e);
          }
        })().finally(() => {
          refreshInFlightRef.current = null;
        });
      }

      try {
        await refreshInFlightRef.current;
      } finally {
        if (showBusy) setManualRefreshBusy(false);
      }
    },
    [onAnyComplete]
  );

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

  const anyActive = useMemo(() => mergedJobs.some((j) => j.status === "running"), [mergedJobs]);

  const hasActiveOptimisticJobs = useMemo(() => optimistic.some((j) => j.status === "running"), [optimistic]);
  const shouldTrack = open || anyActive || hasActiveOptimisticJobs;

  useEffect(() => {
    if (shouldTrack) void refresh();
  }, [refresh, shouldTrack]);
  useEffect(() => {
    if (shouldTrack) void refresh();
  }, [refresh, refreshKey, shouldTrack]);

  useEffect(() => {
    if (!shouldTrack) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      await refresh();
      if (cancelled) return;
      const delay = anyActive ? 1000 : 5000;
      timer = window.setTimeout(tick, delay);
    };

    const delay = anyActive ? 1000 : 5000;
    timer = window.setTimeout(tick, delay);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [refresh, shouldTrack, anyActive]);

  const uploadTotals = useMemo(() => {
    const all = mergedJobs.length;
    const done = mergedJobs.filter((j) => j.status !== "running").length;
    return { all, done };
  }, [mergedJobs]);

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
  const isEmpty = !hasUploads;

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
          <div className="text-sm font-medium">Uploads</div>
          <div className="text-xs text-muted-foreground">
            {uploadTotals.all > 0 ? `(${uploadTotals.done}/${uploadTotals.all} complete)` : "Upload activity"}
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
        <Button size="sm" variant="ghost" onClick={() => void refresh({ showBusy: true })} disabled={manualRefreshBusy}>
          {manualRefreshBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
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
              {mergedJobs.map((j) => {
                const isRunning = j.status === "running";
                const canOpen = j.status === "done" && !!onOpenUpload && j.job_id.includes("/uploads/");
                const content = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border",
                              uploadStatusAccentClass(j.status)
                            )}
                          >
                            <UploadStatusIcon status={j.status} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground" title={j.filename}>
                              {j.filename}
                            </div>
                            <div
                              className={cn(
                                "mt-1 text-xs text-muted-foreground",
                                j.status === "error" && "text-destructive"
                              )}
                            >
                              {formatUploadSecondaryText(j)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          uploadStatusAccentClass(j.status)
                        )}
                      >
                        {isRunning ? phaseLabel(j.phase) : uploadStatusLabel(j.status)}
                      </div>
                    </div>

                    {isRunning ? (
                      <>
                        <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${Math.max(0, Math.min(100, j.pct))}%` }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                          <div>{fmtBytes(j.bytes)} / {fmtBytes(j.total_bytes || 0)}</div>
                          <div>{j.pct}%</div>
                        </div>
                      </>
                    ) : null}
                  </>
                );

                if (canOpen) {
                  return (
                    <button
                      key={j.job_id}
                      type="button"
                      onClick={() => onOpenUpload?.(j)}
                      className="block w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label={`Open file ${j.filename}`}
                    >
                      {content}
                    </button>
                  );
                }

                return (
                  <div key={j.job_id} className="rounded-xl border p-3">
                    {content}
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
