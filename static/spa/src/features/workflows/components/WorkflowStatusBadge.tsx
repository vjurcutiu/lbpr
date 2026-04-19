import type { ComponentType } from "react";
import { CheckCircle2, CircleAlert, Clock3, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { WorkflowRun } from "../types";

const STATUS_META: Record<WorkflowRun["status"], { label: string; icon: ComponentType<{ className?: string }>; className: string }> = {
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    label: "Needs review",
    icon: CircleAlert,
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
  queued: {
    label: "Queued",
    icon: Clock3,
    className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  running: {
    label: "Running",
    icon: Loader2,
    className: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
};

export function WorkflowStatusBadge({ status, className }: { status: WorkflowRun["status"]; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-full px-2.5 py-1 font-medium", meta.className, className)}>
      <Icon className={cn("h-3.5 w-3.5", status === "running" && "animate-spin")} />
      {meta.label}
    </Badge>
  );
}
