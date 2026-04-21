import { useMemo } from "react";
import type { WorkflowSelection } from "../types";
import { summarizeWorkflowSelection, type WorkflowSelectionSummary } from "../utils/selection";

export type { WorkflowSelectionSummary } from "../utils/selection";

export function useWorkflowSelection(args: WorkflowSelection): WorkflowSelectionSummary {
  return useMemo(() => summarizeWorkflowSelection(args), [args]);
}
