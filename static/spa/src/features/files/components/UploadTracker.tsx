import { useEffect, useMemo, useRef, useState } from "react";
import { listUploadJobs, type UploadJob, clearUploadJobs } from "../uploadTrackerApi";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

function phaseLabel(p: UploadJob["phase"]) {
  switch (p) {
    case "receive": return "Receiving";
    case "upload": return "Storing";
    case "ocr": return "OCR";
    case "extract": return "Extracting";
    case "embed": return "Embedding";
    case "upsert": return "Upserting";
    case "complete": return "Complete";
    case "error": return "Error";
  }
}

function fmtBytes(n: number) {
  const units = ["B","KB","MB","GB","TB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function UploadTrackerPanel({
  open,
  onClose,
  refreshKey,
  onAnyComplete,
  optimistic = [],
  /** NEW: filter panel to *this* batch only (by filename). */
  batchFilenames = [],
  /** Optional: show completed items from earlier history even if not in this batch. */
  showHistory = false,
  /** NEW: seed fetched jobs so existing history appears immediately when panel opens. */
  seedFetched = [],
}: {
  open: boolean;
  onClose: () => void;
  /** When this changes, the panel will force-refresh immediately. */
  refreshKey?: number | string;
  /** Called when one or more jobs transition to 'done' (or 'error'). */
  onAnyComplete?: (newlyCompleted: UploadJob[]) => void;
  /** Optimistic jobs seeded by the Files page when files are *selected* (before the server creates jobs). */
  optimistic?: UploadJob[];
  batchFilenames?: string[];
  showHistory?: boolean;
  seedFetched?: UploadJob[];
}) {
  // Initialize from seedFetched to show existing jobs immediately
  const [jobsFetched, setJobsFetched] = useState<UploadJob[]>(seedFetched || []);
  const [busy, setBusy] = useState(false);
  const prevStatusRef = useRef<Map<string, UploadJob["status"]>>(new Map());

  // Keep jobsFetched in sync if parent updates the seed
  useEffect(() => {
    if (seedFetched && seedFetched.length > 0) {
      setJobsFetched(seedFetched);
      const nextMap = new Map<string, UploadJob["status"]>();
      for (const j of seedFetched) nextMap.set(j.job_id, j.status);
      prevStatusRef.current = nextMap;
    }
    // if seed becomes empty we do nothing (panel will poll anyway)
  }, [seedFetched]);

  const refresh = async () => {
    if (!open) return;
    setBusy(true);
    try {
      const items = await listUploadJobs(); // returns recent history (not just active)
      // detect newly completed/error
      const prev = prevStatusRef.current;
      const newly: UploadJob[] = [];
      for (const j of items) {
        const before = prev.get(j.job_id);
        if ((before === "running" || before === undefined) && (j.status === "done" || j.status === "error")) {
          newly.push(j);
        }
      }
      // update status map
      const nextMap = new Map<string, UploadJob["status"]>();
      for (const j of items) nextMap.set(j.job_id, j.status);
      prevStatusRef.current = nextMap;

      setJobsFetched(items);
      if (newly.length > 0) onAnyComplete?.(newly);
    } catch (e) {
      console.error("[uploadTracker] list error", e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (open) refresh(); }, [open]);
  useEffect(() => { if (open) refresh(); }, [refreshKey]); // force refresh when key changes

  // Merge optimistic + fetched with *robust de-duplication*:
  // - Prefer server-fetched items over optimistic "temp:" rows for the same filename
  // - When filtering to the current batch (showHistory=false), collapse to the *latest per filename*
  const mergedJobs = useMemo(() => {
    // Index fetched by filename
    const fetchedByFilename = new Map<string, UploadJob>();
    for (const j of jobsFetched) {
      const prev = fetchedByFilename.get(j.filename);
      if (!prev || j.updated_at >= prev.updated_at) fetchedByFilename.set(j.filename, j);
    }

    // Keep only optimistic items that don't have a server record for the same filename
    const dedupOptimistic = optimistic.filter(o => {
      if (!o.job_id.startsWith("temp:")) return true; // if it's already a real id, keep
      return !fetchedByFilename.has(o.filename); // drop temp if server already sent a row for this filename
    });

    let arr = [...jobsFetched, ...dedupOptimistic];

    // Apply batch filter unless we explicitly want full history
    if (!showHistory && batchFilenames.length > 0) {
      const allow = new Set(batchFilenames);
      // Collapse to latest per filename, preferring server vs temp
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
      // Else: ensure uniqueness by job_id
      const byId = new Map<string, UploadJob>();
      for (const j of arr) byId.set(j.job_id, j);
      arr = Array.from(byId.values());
    }

    return arr.sort((a, b) => (b.updated_at - a.updated_at));
  }, [optimistic, jobsFetched, batchFilenames, showHistory]);

  // Compute "any active" from VISIBLE rows only to drive polling cadence
  const anyActive = mergedJobs.some(j => j.status === "running");

  // Self-scheduling poller
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: any = null;
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
        timer = setTimeout(tick, delay);
      }
    };

    // Kick off immediately
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, anyActive, refreshKey]);

  const totals = useMemo(() => {
    const all = mergedJobs.length;
    const done = mergedJobs.filter(j => j.status !== "running").length;
    return { all, done };
  }, [mergedJobs]);

  const doClear = async (scope: "done" | "all") => {
    try {
      const { removed } = await clearUploadJobs(scope);
      if (removed > 0) {
        toast.success(scope === "all" ? "Tracker cleared" : "Completed cleared", {
          description: `${removed} entr${removed === 1 ? "y" : "ies"} removed.`
        });
      } else {
        toast.message("Nothing to clear", { description: "No matching entries." });
      }
      await refresh();
    } catch (e) {
      console.error(e);
      toast.error("Failed to clear", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div
      className={cn(
        "fixed right-4 bottom-4 w-[460px] max-w-[95vw] border rounded-lg shadow-xl bg-background",
        "transition-transform duration-200",
        open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"
      )}
      role="dialog"
      aria-hidden={!open}
    >
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <div className="text-sm font-medium">Transfers</div>
        <div className="text-xs text-muted-foreground">({totals.done}/{totals.all} complete)</div>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" title="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem]">
            <DropdownMenuItem onClick={() => doClear("done")}>
              Clear completed
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => doClear("all")}>
              Clear all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <div className="max-h-[50vh] overflow-auto p-2 space-y-2">
        {mergedJobs.length === 0 && (
          <div className="text-sm text-muted-foreground px-2 py-6 text-center">
            {batchFilenames.length > 0 && !showHistory
              ? "This batch has no visible items yet. Waiting for server to create jobs…"
              : "No recent uploads."}
          </div>
        )}
        {mergedJobs.map((j) => (
          <div key={j.job_id} className="border rounded p-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="truncate" title={j.filename}>{j.filename}</div>
              <div className={cn(
                "px-1.5 py-0.5 rounded",
                j.status === "error" ? "bg-destructive/20 text-destructive" :
                j.status === "done" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              )}>
                {phaseLabel(j.phase)}
              </div>
            </div>
            <div className="h-2 rounded bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all",
                  j.status === "error" ? "bg-destructive" : "bg-primary"
                )}
                style={{ width: `${Math.max(0, Math.min(100, j.pct))}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground flex justify-between">
              <div>{fmtBytes(j.bytes)} / {fmtBytes(j.total_bytes || 0)}</div>
              <div>{j.pct}%</div>
            </div>
            {j.error && j.status === "error" && (
              <div className="mt-1 text-xs text-destructive">{j.error}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
