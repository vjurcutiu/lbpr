import type { WorkflowManifest, WorkflowSelection } from "../types";

export type WorkflowSelectionSummary = WorkflowSelection & {
  fileCount: number;
  folderCount: number;
  totalCount: number;
  label: string;
  hasSelection: boolean;
};

export function summarizeWorkflowSelection(args: WorkflowSelection): WorkflowSelectionSummary {
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
}

export function isWorkflowSelectionValid(workflow: WorkflowManifest, selection: WorkflowSelectionSummary) {
  const req = workflow.selection;
  if (selection.totalCount < req.min_total_items) return false;
  if (req.max_total_items != null && selection.totalCount > req.max_total_items) return false;
  if (req.exact_file_count != null && selection.fileCount !== req.exact_file_count) return false;
  if (!req.allow_folders && selection.folderCount > 0) return false;
  return true;
}

export function getWorkflowSelectionMessage(workflow: WorkflowManifest, selection: WorkflowSelectionSummary) {
  const req = workflow.selection;

  if (!selection.hasSelection) {
    if (req.exact_file_count != null) {
      return `Select exactly ${req.exact_file_count} file${req.exact_file_count === 1 ? "" : "s"} to run this workflow.`;
    }
    return `Select at least ${req.min_total_items} item${req.min_total_items === 1 ? "" : "s"} to run this workflow.`;
  }

  if (req.exact_file_count != null && selection.fileCount !== req.exact_file_count) {
    return `This workflow requires exactly ${req.exact_file_count} file${req.exact_file_count === 1 ? "" : "s"}.`;
  }

  if (selection.totalCount < req.min_total_items) {
    return `Add ${req.min_total_items - selection.totalCount} more item${req.min_total_items - selection.totalCount === 1 ? "" : "s"} to continue.`;
  }

  if (req.max_total_items != null && selection.totalCount > req.max_total_items) {
    return `Remove ${selection.totalCount - req.max_total_items} item${selection.totalCount - req.max_total_items === 1 ? "" : "s"} to continue.`;
  }

  if (!req.allow_folders && selection.folderCount > 0) {
    return "This workflow only supports direct file selection.";
  }

  return "Selection ready.";
}
