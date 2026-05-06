export type EvalCaseWorkflowSummary = {
  key: string;
  index: number;
  workflow_id: string;
  label?: string | null;
  modes?: string[];
};

export type EvalCaseSummary = {
  id: string;
  path: string;
  eval_id?: string | null;
  description: string;
  workflow_count: number;
  mode?: string | null;
  workflows?: EvalCaseWorkflowSummary[];
  modified_at?: string | null;
};

export type EvalResultSummary = {
  id: string;
  path: string;
  eval_id: string;
  description: string;
  mode: string;
  created_at?: string | null;
  modified_at?: string | null;
  run_count: number;
  completed_count: number;
  failed_count: number;
  skipped_count: number;
  validation_error_count: number;
  validation_warning_count: number;
  has_review: boolean;
};

export type WorkflowSelectionInput = {
  file_ids?: string[];
  file_paths?: string[];
  folder_paths?: string[];
  current_folder?: string;
};

export type EvalSelectionOptions = {
  uid: string;
  files: Array<Record<string, unknown>>;
  folders: Array<{ path: string; name: string; parent_path?: string | null; direct_file_count?: number; recursive_file_count?: number }>;
};

export type EvalRunRequest = {
  case_path: string;
  document_source?: "local" | "app";
  uid?: string | null;
  mode?: string | null;
  markdown?: boolean;
  compare_to?: string | null;
  prompt_version?: string | null;
  workflow_version?: string | null;
  notes?: string;
  selection?: WorkflowSelectionInput | null;
  manifest_paths?: string[];
  apply_selection_to_workflows?: boolean;
  workflow_id?: string | null;
  workflow_run_key?: string | null;
  ad_hoc_workflow_id?: string | null;
  ad_hoc_workflow_label?: string | null;
  ad_hoc_workflow_inputs?: Record<string, unknown>;
};

export type EvalJobMessage = {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  run_key?: string | null;
  workflow_id?: string | null;
  label?: string | null;
};

export type EvalJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  requested_by_uid: string;
  requested_by_email?: string | null;
  request: EvalRunRequest;
  result_id?: string | null;
  export_path?: string | null;
  markdown_path?: string | null;
  comparison_path?: string | null;
  comparison_markdown_path?: string | null;
  error?: string | null;
  total_runs?: number;
  completed_runs?: number;
  failed_runs?: number;
  skipped_runs?: number;
  validation_error_count?: number;
  validation_warning_count?: number;
  current_run_key?: string | null;
  current_workflow_id?: string | null;
  current_label?: string | null;
  last_message?: string | null;
  messages?: EvalJobMessage[];
};

export type EvalCriterionScore = {
  criterion_id: string;
  label: string;
  weight: number;
  max_score: number;
  score?: number | null;
  notes?: string;
};

export type EvalValidationIssue = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string | null;
};

export type EvalRunRecord = {
  workflow_id: string;
  run_key: string;
  label?: string | null;
  status: "completed" | "failed" | "skipped";
  title?: string;
  duration_ms?: number;
  error?: string | null;
  summary?: string;
  output_markdown?: string;
  sources?: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  structured_metadata?: Record<string, unknown>;
  prompt_version?: string | null;
  workflow_version?: string | null;
  rubric_id?: string | null;
  criterion_scores?: EvalCriterionScore[];
  validation?: { status: string; issues: EvalValidationIssue[] };
  output_fingerprint?: string;
  config_fingerprint?: string;
};

export type EvalResultDetail = {
  eval_id: string;
  description?: string;
  mode: string;
  created_at: string;
  app_git_commit?: string | null;
  uid: string;
  case_fingerprint?: string;
  document_set?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  runs: EvalRunRecord[];
  _internal?: {
    id: string;
    path: string;
    review?: EvalReviewRecord | null;
  };
};

export type EvalReviewRecord = {
  result_id: string;
  updated_at: string;
  updated_by_uid: string;
  updated_by_email?: string | null;
  reviewer_notes: string;
  run_reviews: Record<string, { scores?: Record<string, number | null>; notes?: Record<string, string>; summary?: string }>;
};

export type EvalComparisonResponse = {
  comparison: Record<string, unknown>;
  path?: string | null;
};
