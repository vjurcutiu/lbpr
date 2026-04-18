import { useMemo } from "react";
import type { WorkflowSelection } from "../types";

export type WorkflowSelectionSummary = WorkflowSelection & {
  fileCount: number;
  folderCount: number;
  totalCount: number;
  label: string;
  hasSelection: boolean;
};

export function useWorkflowSelection(args: WorkflowSelection): WorkflowSelectionSummary {
  return useMemo(() => {
    const fileCount = args.file_ids.length;
    const folderCount = args.folder_paths.length;
    const totalCount = fileCount + folderCount;
    const parts: string[] = [];
    if (fileCount) parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
    if (folderCount) parts.push(`${folderCount} folder${folderCount === 1 ? "" : "s"}`);
    return {
      ...args,
      fileCount,
      folderCount,
      totalCount,
      hasSelection: totalCount > 0,
      label: parts.length ? parts.join(" • ") : "No selection",
    };
  }, [args]);
}
