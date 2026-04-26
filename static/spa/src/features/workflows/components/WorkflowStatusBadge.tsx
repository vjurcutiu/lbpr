import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { WorkflowRun } from "../types";
import { WorkflowStatusIcon, workflowStatusBadgeClass, workflowStatusLabel } from "./WorkflowStatusIcon";

export function WorkflowStatusBadge({ status, className }: { status: WorkflowRun["status"]; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-full px-2.5 py-1 font-medium", workflowStatusBadgeClass(status), className)}>
      <WorkflowStatusIcon status={status} className="h-3.5 w-3.5" />
      {workflowStatusLabel(status)}
    </Badge>
  );
}
