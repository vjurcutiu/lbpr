export type WorkflowCapability =
  | "summarize"
  | "compare"
  | "extract"
  | "draft"
  | "report"
  | "plan";

export type WorkflowStatus = "queued" | "running" | "completed" | "failed";

export type WorkflowSelectionRequirements = {
  min_total_items: number;
  max_total_items?: number | null;
  exact_file_count?: number | null;
  allow_folders: boolean;
};

export type WorkflowLauncherSchema = {
  prompt_label: string;
  prompt_placeholder: string;
  submit_label: string;
  suggested_prompts: string[];
};

export type WorkflowManifest = {
  workflow_id: string;
  title: string;
  description: string;
  capability: WorkflowCapability;
  selection: WorkflowSelectionRequirements;
  launcher: WorkflowLauncherSchema;
  tags: string[];
};

export type WorkflowSelection = {
  file_ids: string[];
  folder_paths: string[];
  current_folder: string;
};

export type WorkflowResult = {
  summary: string;
  bullets: string[];
  next_actions: string[];
  preview_markdown: string;
  metadata: Record<string, unknown>;
};

export type WorkflowRun = {
  id: string;
  workflow_id: string;
  title: string;
  capability: WorkflowCapability;
  status: WorkflowStatus;
  selection: WorkflowSelection;
  inputs: Record<string, unknown>;
  result: WorkflowResult | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowRunList = {
  items: WorkflowRun[];
};

export type CreateWorkflowRunRequest = {
  workflow_id: string;
  selection: WorkflowSelection;
  inputs?: Record<string, unknown>;
};
