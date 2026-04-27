export type WorkflowCapability =
  | "summarize"
  | "compare"
  | "extract"
  | "draft"
  | "report"
  | "plan";

export type WorkflowStatus = "queued" | "running" | "completed" | "failed";

export type WorkflowArtifactFormat = "markdown" | "txt" | "docx" | "pdf";
export type WorkflowEditSaveMode = "new_version" | "overwrite";

export type WorkflowAiPartialEditRequest = {
  prompt: string;
  content_before: string;
  selected_content: string;
  content_after: string;
};

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
  fields: WorkflowLauncherField[];
};

export type WorkflowLauncherFieldOption = {
  value: string;
  label: string;
  description?: string | null;
};

export type WorkflowLauncherField = {
  key: string;
  label: string;
  kind: "select";
  placeholder?: string | null;
  default_value?: string | null;
  options: WorkflowLauncherFieldOption[];
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


export type WorkflowArtifactSummary = {
  id: string;
  run_id: string;
  workflow_id: string;
  title: string;
  capability: WorkflowCapability;
  file_name: string;
  format: WorkflowArtifactFormat;
  content_type: string;
  byte_size: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowArtifact = WorkflowArtifactSummary & {
  content: string;
  metadata: Record<string, unknown>;
};

export type WorkflowResult = {
  summary: string;
  bullets: string[];
  next_actions: string[];
  preview_markdown: string;
  metadata: Record<string, unknown>;
};

export type WorkflowRunVersion = {
  id: string;
  run_id: string;
  parent_version_id?: string | null;
  version_number: number;
  title: string;
  label?: string | null;
  layout_x?: number | null;
  layout_y?: number | null;
  kind: "original" | "refinement" | "branch" | "edit";
  prompt?: string | null;
  result: WorkflowResult;
  artifact?: WorkflowArtifactSummary | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowRunVersionList = {
  items: WorkflowRunVersion[];
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
  artifact?: WorkflowArtifactSummary | null;
  versions: WorkflowRunVersion[];
  active_version_id?: string | null;
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

export type WorkflowSuggestedAction = {
  label?: string;
  workflow_id?: string;
  focus?: string;
  description?: string;
  kind?: string;
};

export type WorkflowChainSource = {
  parent_run_id: string;
  parent_workflow_id: string;
  parent_workflow_title: string;
  parent_title: string;
  action_label?: string;
  summary?: string;
  selection_label?: string;
  source_file_count?: number;
  source_folder_count?: number;
  parent_updated_at?: string;
};
