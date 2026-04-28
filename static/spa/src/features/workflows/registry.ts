import type { LucideIcon } from "lucide-react";
import {
  Scale,
  BriefcaseBusiness,
  ClipboardCheck,
  FileCheck2,
  FileDiff,
  FileSearch,
  Files,
  FileText,
  Handshake,
  ListChecks,
  ListTodo,
  PencilLine,
  ShieldAlert,
  TableProperties,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  summarize_documents: Files,
  compare_documents: FileDiff,
  extract_information: TableProperties,
  draft_from_sources: PencilLine,
  generate_report: FileText,
  create_action_plan: ListTodo,

  legal_contract_review: Scale,
  legal_contract_risk_matrix: ShieldAlert,
  legal_nda_review: FileCheck2,
  legal_msa_review: BriefcaseBusiness,
  legal_clause_extraction: TableProperties,
  legal_fallback_language: PencilLine,
  legal_negotiation_brief: Handshake,
  legal_obligation_tracker: ListChecks,
  legal_matter_handoff: ClipboardCheck,
};

export function getWorkflowIcon(workflowId: string): LucideIcon {
  return ICONS[workflowId] || FileSearch;
}
