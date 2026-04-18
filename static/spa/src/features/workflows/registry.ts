import type { LucideIcon } from "lucide-react";
import {
  FileSearch,
  Files,
  FileDiff,
  TableProperties,
  PencilLine,
  FileText,
  ListTodo,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  summarize_documents: Files,
  compare_documents: FileDiff,
  extract_information: TableProperties,
  draft_from_sources: PencilLine,
  generate_report: FileText,
  create_action_plan: ListTodo,
};

export function getWorkflowIcon(workflowId: string): LucideIcon {
  return ICONS[workflowId] || FileSearch;
}
