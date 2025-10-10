
import { useEffect, useMemo, useState } from "react";
import { listUploadJobs, type UploadJob } from "../uploadTrackerApi";
import { useInterval } from "../hooks/useInterval";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

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
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!open) return;
    setBusy(true);
    try {
      const items = await listUploadJobs();
      setJobs(items);
    } catch (e) {
      console.error("[uploadTracker] list error", e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (open) refresh(); }, [open]);
  // Poll every second while any job is running
  const anyActive = jobs.some(j => j.status === "running");
  useInterval(() => { refresh(); }, open ? (anyActive ? 1000 : 5000) : null);

  const totals = useMemo(() => {
    const all = jobs.length;
    const done = jobs.filter(j => j.status !== "running").length;
    return { all, done };
  }, [jobs]);

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
        <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <div className="max-h-[50vh] overflow-auto p-2 space-y-2">
        {jobs.length === 0 && (
          <div className="text-sm text-muted-foreground px-2 py-6 text-center">No recent uploads.</div>
        )}
        {jobs.map((j) => (
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
