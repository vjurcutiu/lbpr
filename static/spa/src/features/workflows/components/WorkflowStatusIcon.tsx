import type { ComponentType } from "react";
import { CheckCircle2, Clock3, Loader2, Pencil, X } from "lucide-react";

import { cn } from "@/lib/utils";

import type { WorkflowRun } from "../types";

export type WorkflowVisualStatus = WorkflowRun["status"] | "editing";

type StatusIcon = ComponentType<{ className?: string }>;

type WorkflowStatusMeta = {
  label: string;
  Icon: StatusIcon;
  accentClassName: string;
  badgeClassName: string;
  iconClassName?: string;
};

const WORKFLOW_STATUS_META: Record<WorkflowVisualStatus, WorkflowStatusMeta> = {
  completed: {
    label: "Completed",
    Icon: CheckCircle2,
    accentClassName:
      "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
    badgeClassName: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    Icon: X,
    accentClassName: "border-destructive/30 bg-destructive/10 text-destructive",
    badgeClassName: "border-destructive/20 bg-destructive/10 text-destructive",
  },
  queued: {
    label: "Queued",
    Icon: Clock3,
    accentClassName:
      "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
    badgeClassName: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  running: {
    label: "Running",
    Icon: Loader2,
    accentClassName:
      "border-sky-200 bg-sky-500/10 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300",
    badgeClassName: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    iconClassName: "animate-spin",
  },
  editing: {
    label: "Editing",
    Icon: Pencil,
    accentClassName:
      "border-blue-200 bg-blue-500/10 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300",
    badgeClassName: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
};

export function getWorkflowStatusMeta(status: WorkflowVisualStatus) {
  return WORKFLOW_STATUS_META[status];
}

export function workflowStatusLabel(status: WorkflowVisualStatus) {
  return getWorkflowStatusMeta(status).label;
}

export function workflowStatusAccentClass(status: WorkflowVisualStatus) {
  return getWorkflowStatusMeta(status).accentClassName;
}

export function workflowStatusBadgeClass(status: WorkflowVisualStatus) {
  return getWorkflowStatusMeta(status).badgeClassName;
}

export function WorkflowStatusIcon({
  status,
  className,
}: {
  status: WorkflowVisualStatus;
  className?: string;
}) {
  const meta = getWorkflowStatusMeta(status);
  const Icon = meta.Icon;

  return <Icon className={cn("h-4 w-4", meta.iconClassName, className)} />;
}
