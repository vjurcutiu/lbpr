import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Activity, AlertTriangle, Bot, CheckCircle2, Download, FileSearch, FolderOpen, GitCompare, ListChecks, Play, RefreshCcw, Route, Save, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useAuthContext } from "@/features/auth/AuthProvider";

import {
  compareEvalResults,
  createEvalRun,
  evalResultDownloadUrl,
  getEvalJob,
  getEvalResult,
  getInternalEvalStatus,
  listEvalCases,
  listEvalJobs,
  listEvalResults,
  listEvalSelectionOptions,
  saveEvalReview,
} from "./api";
import type { FileItem } from "@/features/files/api";
import { listWorkflows } from "@/features/workflows/api";
import { LegalWorkflowLauncher } from "@/features/workflows/components/LegalWorkflowLauncher";
import { WorkflowLauncher } from "@/features/workflows/components/WorkflowLauncher";
import { buildProPackInputs, getVisibleProPackGroups } from "@/features/workflows/proPacks";
import type { WorkflowManifest, WorkflowSelection } from "@/features/workflows/types";
import { summarizeWorkflowSelection } from "@/features/workflows/utils/selection";
import type { EvalCaseSummary, EvalJob, EvalResultDetail, EvalResultSummary, EvalRunRecord, EvalSelectionOptions } from "./types";

const INTERNAL_UI_ENABLED = ["1", "true", "yes"].includes(String(import.meta.env.VITE_ENABLE_INTERNAL_EVAL_UI || "").toLowerCase());
const INTERNAL_ADMIN_EMAILS = String(import.meta.env.VITE_INTERNAL_EVAL_ADMIN_EMAILS || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

type ReviewDraft = Record<string, { scores: Record<string, number | null>; notes: Record<string, string>; summary: string }>;
type EvalView = "workflows" | "agent";
type DocumentSource = "local" | "app";
type WorkflowLibraryView = "core" | "pro";

type AgentTraceStep = {
  step?: number;
  type?: string;
  query?: string | null;
  reason?: string | null;
  chunk_ids?: string[];
  chunks_added?: number;
};

type AgentDecisionStep = {
  step?: number;
  stage?: string;
  decision?: string;
  rationale?: string;
  action?: string;
  observation?: string | null;
  outcome?: string | null;
  metadata?: Record<string, unknown>;
};

type SourceSupportRecord = {
  source_name?: string;
  file_id?: string;
  chunk_id?: string;
  excerpt?: string;
  matched_terms?: string[];
  support_score?: number;
};

type ClauseMapSpan = {
  file_id?: string;
  chunk_id?: string;
  chunk_index?: number | null;
  span?: Record<string, unknown>;
};

type ClauseMapEntry = {
  clause_map_id?: string;
  entry_id?: string;
  entry_kind?: string;
  source_file_id?: string;
  source_name?: string;
  title?: string;
  normalized_type?: string;
  clause_family?: string;
  status?: string;
  confidence?: string;
  summary?: string;
  source_spans?: ClauseMapSpan[];
  cross_references?: string[];
};

type SupportedIssueRecord = {
  issue: string;
  severity?: string;
  clause_family?: string;
  support_status?: string;
  source_support: SourceSupportRecord[];
};

type AgentContext = {
  profile?: string;
  sufficient?: boolean;
  selected_chunks?: number;
  returned_sources?: number;
  coverage_notes?: string[];
  missing_context?: string[];
  retrieval_trace?: AgentTraceStep[];
  decision_trace?: AgentDecisionStep[];
  source_support_summary?: Record<string, unknown>;
  clause_map_selection?: Record<string, unknown>;
  selected_clause_map_entries?: ClauseMapEntry[];
};

const AGENT_REVIEW_CRITERIA = [
  { id: "agent_context_sufficiency", label: "Context sufficiency", helper: "Did the agent gather enough evidence before the output was generated?" },
  { id: "agent_retrieval_relevance", label: "Retrieval relevance", helper: "Were the retrieved chunks relevant to the workflow question or task?" },
  { id: "agent_expansion_quality", label: "Expansion quality", helper: "Did neighbor and targeted-query turns expand context in the right direction?" },
  { id: "agent_output_grounding", label: "Output grounding", helper: "Does the final output stay supported by the gathered context?" },
];

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function fmtMs(value?: number | null) {
  if (!Number.isFinite(Number(value))) return "—";
  const ms = Number(value);
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function statusBadge(status?: string) {
  if (status === "completed") return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Completed</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (status === "running") return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300">Running</Badge>;
  if (status === "queued") return <Badge variant="outline">Queued</Badge>;
  if (status === "skipped") return <Badge variant="secondary">Skipped</Badge>;
  return <Badge variant="outline">{status || "Unknown"}</Badge>;
}

function jobCompletedCount(job: EvalJob): number {
  return Number(job.completed_runs || 0) + Number(job.failed_runs || 0) + Number(job.skipped_runs || 0);
}

function jobProgressPercent(job: EvalJob): number {
  const total = Number(job.total_runs || 0);
  if (!total) return job.status === "completed" ? 100 : 0;
  return Math.min(100, Math.round((jobCompletedCount(job) / total) * 100));
}

function jobMessageClass(level?: string): string {
  if (level === "success") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (level === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (level === "error") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-border bg-muted/40 text-muted-foreground";
}

function jobRuntime(job: EvalJob): string {
  const started = job.started_at ? new Date(job.started_at).getTime() : 0;
  const finished = job.finished_at ? new Date(job.finished_at).getTime() : Date.now();
  if (!started || Number.isNaN(started) || Number.isNaN(finished)) return "—";
  return fmtMs(Math.max(0, finished - started));
}

function validationSummary(run: EvalRunRecord) {
  const issues = run.validation?.issues || [];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  if (!errors && !warnings) return <span className="text-emerald-600">passed</span>;
  return <span className={errors ? "text-destructive" : "text-amber-600"}>{errors} errors · {warnings} warnings</span>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function asTraceSteps(value: unknown): AgentTraceStep[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = asRecord(item) || {};
    return {
      step: Number(record.step || index + 1),
      type: String(record.type || "turn"),
      query: typeof record.query === "string" ? record.query : null,
      reason: typeof record.reason === "string" ? record.reason : null,
      chunk_ids: asStringArray(record.chunk_ids),
      chunks_added: Number(record.chunks_added || 0),
    };
  });
}

function asDecisionSteps(value: unknown): AgentDecisionStep[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = asRecord(item) || {};
    return {
      step: Number(record.step || index + 1),
      stage: typeof record.stage === "string" ? record.stage : "decision",
      decision: typeof record.decision === "string" ? record.decision : "Agent decision",
      rationale: typeof record.rationale === "string" ? record.rationale : "",
      action: typeof record.action === "string" ? record.action : "",
      observation: typeof record.observation === "string" ? record.observation : null,
      outcome: typeof record.outcome === "string" ? record.outcome : null,
      metadata: asRecord(record.metadata) || {},
    };
  });
}

function asSourceSupportRecords(value: unknown): SourceSupportRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item) || {};
    return {
      source_name: typeof record.source_name === "string" ? record.source_name : undefined,
      file_id: typeof record.file_id === "string" ? record.file_id : undefined,
      chunk_id: typeof record.chunk_id === "string" ? record.chunk_id : undefined,
      excerpt: typeof record.excerpt === "string" ? record.excerpt : undefined,
      matched_terms: asStringArray(record.matched_terms),
      support_score: Number(record.support_score || 0),
    };
  }).filter((item) => item.source_name || item.excerpt || item.chunk_id);
}

function asClauseMapSpan(value: unknown): ClauseMapSpan | null {
  const record = asRecord(value);
  if (!record) return null;
  const chunkIndex = typeof record.chunk_index === "number" ? record.chunk_index : Number.isFinite(Number(record.chunk_index)) ? Number(record.chunk_index) : null;
  return {
    file_id: typeof record.file_id === "string" ? record.file_id : undefined,
    chunk_id: typeof record.chunk_id === "string" ? record.chunk_id : undefined,
    chunk_index: chunkIndex,
    span: asRecord(record.span) || undefined,
  };
}

function asClauseMapEntries(value: unknown): ClauseMapEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item) || {};
    return {
      clause_map_id: typeof record.clause_map_id === "string" ? record.clause_map_id : undefined,
      entry_id: typeof record.entry_id === "string" ? record.entry_id : undefined,
      entry_kind: typeof record.entry_kind === "string" ? record.entry_kind : undefined,
      source_file_id: typeof record.source_file_id === "string" ? record.source_file_id : undefined,
      source_name: typeof record.source_name === "string" ? record.source_name : undefined,
      title: typeof record.title === "string" ? record.title : undefined,
      normalized_type: typeof record.normalized_type === "string" ? record.normalized_type : undefined,
      clause_family: typeof record.clause_family === "string" ? record.clause_family : undefined,
      status: typeof record.status === "string" ? record.status : undefined,
      confidence: typeof record.confidence === "string" ? record.confidence : undefined,
      summary: typeof record.summary === "string" ? record.summary : undefined,
      source_spans: Array.isArray(record.source_spans) ? record.source_spans.map(asClauseMapSpan).filter(Boolean) as ClauseMapSpan[] : [],
      cross_references: asStringArray(record.cross_references),
    };
  }).filter((entry) => entry.entry_id || entry.title || entry.source_spans?.length);
}

function getSupportedIssues(run?: EvalRunRecord | null): SupportedIssueRecord[] {
  const structured = asRecord(run?.structured_metadata);
  const riskItems = Array.isArray(structured?.risk_items) ? structured?.risk_items : [];
  return riskItems.map((item) => {
    const record = asRecord(item) || {};
    return {
      issue: String(record.issue || record.risk || record.title || "Risk item"),
      severity: typeof record.severity === "string" ? record.severity : undefined,
      clause_family: typeof record.clause_family === "string" ? record.clause_family : undefined,
      support_status: typeof record.support_status === "string" ? record.support_status : undefined,
      source_support: asSourceSupportRecords(record.source_support),
    };
  });
}

function getAgentContext(run?: EvalRunRecord | null): AgentContext | null {
  if (!run) return null;
  const structured = asRecord(run.structured_metadata);
  const rawContext = asRecord(structured?.adaptive_context);
  if (!rawContext) return null;
  return {
    profile: typeof rawContext.profile === "string" ? rawContext.profile : undefined,
    sufficient: typeof rawContext.sufficient === "boolean" ? rawContext.sufficient : undefined,
    selected_chunks: Number(rawContext.selected_chunks || 0),
    returned_sources: Number(rawContext.returned_sources || 0),
    coverage_notes: asStringArray(rawContext.coverage_notes),
    missing_context: asStringArray(rawContext.missing_context),
    retrieval_trace: asTraceSteps(rawContext.retrieval_trace),
    decision_trace: asDecisionSteps(rawContext.decision_trace),
    source_support_summary: asRecord(rawContext.source_support_summary) || asRecord(structured?.source_support_summary) || undefined,
    clause_map_selection: asRecord(rawContext.clause_map_selection) || undefined,
    selected_clause_map_entries: asClauseMapEntries(rawContext.selected_clause_map_entries),
  };
}

function agentContextBadge(context: AgentContext | null) {
  if (!context) return <Badge variant="secondary">No agent trace</Badge>;
  if (context.sufficient) return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Sufficient</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Needs review</Badge>;
}

function agentTurnLabel(type?: string): string {
  return String(type || "turn")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function agentStageLabel(stage?: string): string {
  return String(stage || "decision")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMetadataPreview(metadata?: Record<string, unknown>): string {
  if (!metadata || !Object.keys(metadata).length) return "";
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return "";
  }
}

function buildInitialReview(result: EvalResultDetail | null): ReviewDraft {
  const review = result?._internal?.review?.run_reviews || {};
  const draft: ReviewDraft = {};
  for (const run of result?.runs || []) {
    const existing = review[run.run_key || run.workflow_id] || {};
    draft[run.run_key || run.workflow_id] = {
      scores: { ...(existing.scores || {}) },
      notes: { ...(existing.notes || {}) },
      summary: existing.summary || "",
    };
  }
  return draft;
}

function normalizeManifestPath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== ".")
    .join("/");
}

function parseManifestPaths(value: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const line of String(value || "").split(/\r?\n/)) {
    const normalized = normalizeManifestPath(line);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

function pathsFromFileList(files: FileList | null): string[] {
  if (!files) return [];
  return Array.from(files)
    .map((file) => normalizeManifestPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name))
    .filter(Boolean);
}

function mergeManifestPathText(current: string, incoming: string[]): string {
  const merged = [...parseManifestPaths(current), ...incoming];
  return parseManifestPaths(merged.join("\n")).join("\n");
}

function folderPathsFromManifest(paths: string[]): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const folder = path.split("/").slice(0, -1).join("/");
    if (folder) folders.add(folder);
  }
  return Array.from(folders).sort();
}


function getFileField(file: Record<string, unknown>, key: string): string {
  const value = file[key];
  return typeof value === "string" ? value : "";
}

function fileDisplayName(file: Record<string, unknown>): string {
  return getFileField(file, "original_name") || getFileField(file, "name") || getFileField(file, "id");
}

function fileDisplayPath(file: Record<string, unknown>): string {
  const folder = getFileField(file, "folder_path").replace(/^\/+|\/+$/g, "");
  const name = fileDisplayName(file);
  return folder ? `${folder}/${name}` : name;
}

function toWorkflowFileItem(file: Record<string, unknown>): FileItem | null {
  const id = getFileField(file, "id");
  if (!id) return null;
  return {
    id,
    name: getFileField(file, "name") || id,
    original_name: getFileField(file, "original_name") || null,
    folder_path: getFileField(file, "folder_path") || null,
    content_type: getFileField(file, "content_type") || undefined,
    created_at: getFileField(file, "created_at") || undefined,
    size: Number(file.size || 0),
  };
}

function isLegalWorkflow(workflow: WorkflowManifest | null): boolean {
  if (!workflow) return false;
  return workflow.pack_id === "legal" || workflow.workflow_id.startsWith("legal_");
}

function workflowSortKey(workflow: WorkflowManifest): string {
  return `${String(workflow.pack_order || 0).padStart(4, "0")}:${String(workflow.workflow_order || 0).padStart(4, "0")}:${workflow.title.toLowerCase()}`;
}

function summarizeAppSelection(fileIds: string[], folderPaths: string[]): string {
  const total = fileIds.length + folderPaths.length;
  if (!total) return "Select uploaded files or folders from the app workspace.";
  const parts: string[] = [];
  if (fileIds.length) parts.push(`${fileIds.length} file${fileIds.length === 1 ? "" : "s"}`);
  if (folderPaths.length) parts.push(`${folderPaths.length} folder${folderPaths.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export default function InternalEvalsPage() {
  const { user, loading } = useAuthContext();
  const [statusChecked, setStatusChecked] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [cases, setCases] = useState<EvalCaseSummary[]>([]);
  const [workflowCatalog, setWorkflowCatalog] = useState<WorkflowManifest[]>([]);
  const [results, setResults] = useState<EvalResultSummary[]>([]);
  const [selectionOptions, setSelectionOptions] = useState<EvalSelectionOptions | null>(null);
  const [selectionOptionsLoading, setSelectionOptionsLoading] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState<string>("");
  const [result, setResult] = useState<EvalResultDetail | null>(null);
  const [activeWorkflowRunKey, setActiveWorkflowRunKey] = useState<string>("");
  const [activeAgentRunKey, setActiveAgentRunKey] = useState<string>("");
  const [job, setJob] = useState<EvalJob | null>(null);
  const [jobs, setJobs] = useState<EvalJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [compareBaseline, setCompareBaseline] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({});
  const [evalView, setEvalView] = useState<EvalView>("workflows");
  const [agentLibraryView, setAgentLibraryView] = useState<WorkflowLibraryView>("core");
  const [agentLauncherOpen, setAgentLauncherOpen] = useState(false);
  const [agentWorkflow, setAgentWorkflow] = useState<WorkflowManifest | null>(null);
  const [agentInitialInputs, setAgentInitialInputs] = useState<Record<string, unknown>>({});
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const folderPickerRef = useRef<HTMLInputElement | null>(null);
  const [launcher, setLauncher] = useState({
    document_source: "local" as DocumentSource,
    case_path: "internal/evals/cases/legal_pro_public_contracts_v2_regression.example.json",
    uid: "",
    mode: "smoke",
    compare_to: "",
    prompt_version: "",
    workflow_version: "",
    notes: "",
    markdown: true,
    manifest_paths: "",
    app_file_ids: [] as string[],
    app_folder_paths: [] as string[],
    apply_selection_to_workflows: true,
    remember_manifest_paths: true,
  });

  const frontendAdminAllowed = useMemo(() => {
    if (!INTERNAL_UI_ENABLED) return false;
    if (!INTERNAL_ADMIN_EMAILS.length) return true;
    return !!user?.email && INTERNAL_ADMIN_EMAILS.includes(user.email.toLowerCase());
  }, [user?.email]);

  async function refreshAppSelectionOptions() {
    const targetUid = launcher.uid.trim() || null;
    setSelectionOptionsLoading(true);
    try {
      const next = await listEvalSelectionOptions(targetUid);
      setSelectionOptions(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load uploaded app documents");
    } finally {
      setSelectionOptionsLoading(false);
    }
  }

  async function refreshAll(nextResultId = selectedResultId) {
    const [nextCases, nextWorkflowCatalog, nextResults, nextJobs] = await Promise.all([
      listEvalCases(),
      listWorkflows(),
      listEvalResults(75),
      listEvalJobs(25),
    ]);
    setCases(nextCases);
    setWorkflowCatalog(nextWorkflowCatalog || []);
    setResults(nextResults);
    setJobs(nextJobs);
    setJob((current) => {
      const matching = current ? nextJobs.find((item) => item.id === current.id) : null;
      if (matching) return matching;
      return nextJobs.find((item) => ["queued", "running"].includes(item.status)) || nextJobs[0] || current;
    });
    if (!launcher.case_path && nextCases[0]?.path) setLauncher((prev) => ({ ...prev, case_path: nextCases[0].path }));
    const target = nextResultId || nextResults[0]?.id || "";
    setSelectedResultId(target);
    if (target) await loadResult(target);
  }

  async function loadResult(resultId: string) {
    const detail = await getEvalResult(resultId);
    setResult(detail);
    setActiveWorkflowRunKey(detail.runs[0]?.run_key || detail.runs[0]?.workflow_id || "");
    setActiveAgentRunKey("");
    setReviewNotes(detail._internal?.review?.reviewer_notes || "");
    setReviewDraft(buildInitialReview(detail));
  }

  useEffect(() => {
    if (loading || !frontendAdminAllowed) return;
    let mounted = true;
    (async () => {
      try {
        await getInternalEvalStatus();
        if (!mounted) return;
        setStatusChecked(true);
        await refreshAll();
      } catch (error) {
        if (!mounted) return;
        setStatusError(error instanceof Error ? error.message : "Internal eval UI is not available.");
        setStatusChecked(true);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, frontendAdminAllowed]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getEvalJob(job.id);
        setJob(next);
        if (next.status === "completed") {
          toast.success("Eval run completed");
          await refreshAll(next.result_id || undefined);
        } else if (next.status === "failed") {
          toast.error(next.error || "Eval run failed");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not refresh eval job");
      }
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("lbpr.internalEvals.manifestPaths");
      if (saved) setLauncher((prev) => ({ ...prev, manifest_paths: saved }));
    } catch {
      // Ignore unavailable localStorage in restricted browser contexts.
    }
  }, []);

  useEffect(() => {
    if (launcher.document_source !== "app" || selectionOptions || selectionOptionsLoading) return;
    void refreshAppSelectionOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launcher.document_source]);

  useEffect(() => {
    if (!launcher.remember_manifest_paths) return;
    try {
      window.localStorage.setItem("lbpr.internalEvals.manifestPaths", launcher.manifest_paths || "");
    } catch {
      // Ignore unavailable localStorage in restricted browser contexts.
    }
  }, [launcher.manifest_paths, launcher.remember_manifest_paths]);

  function addManifestFiles(files: FileList | null) {
    const nextPaths = pathsFromFileList(files);
    if (!nextPaths.length) return;
    setLauncher((prev) => ({ ...prev, manifest_paths: mergeManifestPathText(prev.manifest_paths, nextPaths) }));
    toast.success(`Added ${nextPaths.length} path${nextPaths.length === 1 ? "" : "s"} to the manifest`);
  }

  function toggleAppFile(fileId: string) {
    setLauncher((prev) => {
      const selected = new Set(prev.app_file_ids);
      if (selected.has(fileId)) selected.delete(fileId);
      else selected.add(fileId);
      return { ...prev, app_file_ids: Array.from(selected) };
    });
  }

  function toggleAppFolder(folderPath: string) {
    setLauncher((prev) => {
      const selected = new Set(prev.app_folder_paths);
      if (selected.has(folderPath)) selected.delete(folderPath);
      else selected.add(folderPath);
      return { ...prev, app_folder_paths: Array.from(selected) };
    });
  }

  async function onRunEval() {
    const manifestPaths = parseManifestPaths(launcher.manifest_paths);
    const folderPaths = folderPathsFromManifest(manifestPaths);
    const isAppSource = launcher.document_source === "app";
    if (isAppSource && !launcher.app_file_ids.length && !launcher.app_folder_paths.length) {
      toast.error("Select at least one uploaded app document or folder");
      return;
    }
    setBusy(true);
    try {
      const response = await createEvalRun({
        case_path: launcher.case_path,
        document_source: launcher.document_source,
        uid: launcher.uid.trim() || null,
        mode: launcher.mode.trim() || null,
        compare_to: launcher.compare_to.trim() || null,
        prompt_version: launcher.prompt_version.trim() || null,
        workflow_version: launcher.workflow_version.trim() || null,
        notes: launcher.notes,
        markdown: launcher.markdown,
        manifest_paths: isAppSource ? [] : manifestPaths,
        selection: isAppSource
          ? {
              file_ids: launcher.app_file_ids,
              folder_paths: launcher.app_folder_paths,
              current_folder: launcher.app_folder_paths[0] || "",
            }
          : manifestPaths.length
            ? {
                file_paths: manifestPaths,
                current_folder: folderPaths[0] || "",
              }
            : null,
        apply_selection_to_workflows: launcher.apply_selection_to_workflows,
      });
      setJob(response.job);
      toast.success("Eval run started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start eval run");
    } finally {
      setBusy(false);
    }
  }

  function openAgentWorkflowLauncher(workflow: WorkflowManifest, initialInputs: Record<string, unknown> = {}) {
    setAgentWorkflow(workflow);
    setAgentInitialInputs(initialInputs);
    setAgentLauncherOpen(true);
    if (!selectionOptions && !selectionOptionsLoading) {
      void refreshAppSelectionOptions();
    }
  }

  async function onRunAgentWorkflow(workflow: WorkflowManifest, inputs: Record<string, unknown>, selection: WorkflowSelection) {
    setAgentSubmitting(true);
    try {
      const response = await createEvalRun({
        case_path: launcher.case_path,
        document_source: "app",
        uid: launcher.uid.trim() || null,
        mode: launcher.mode.trim() || null,
        compare_to: launcher.compare_to.trim() || null,
        prompt_version: launcher.prompt_version.trim() || null,
        workflow_version: launcher.workflow_version.trim() || null,
        notes: launcher.notes,
        markdown: launcher.markdown,
        selection,
        manifest_paths: [],
        apply_selection_to_workflows: true,
        ad_hoc_workflow_id: workflow.workflow_id,
        ad_hoc_workflow_label: workflow.title,
        ad_hoc_workflow_inputs: inputs,
      });
      setJob(response.job);
      setAgentLauncherOpen(false);
      setAgentWorkflow(null);
      setAgentInitialInputs({});
      toast.success(`${workflow.title} eval started`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not start ${workflow.title} eval`);
    } finally {
      setAgentSubmitting(false);
    }
  }

  async function onSelectResult(resultId: string) {
    setSelectedResultId(resultId);
    await loadResult(resultId);
  }

  async function onSaveReview() {
    if (!selectedResultId) return;
    setBusy(true);
    try {
      const saved = await saveEvalReview(selectedResultId, {
        reviewer_notes: reviewNotes,
        run_reviews: reviewDraft,
      });
      setResult((prev) => prev ? { ...prev, _internal: { ...(prev._internal || { id: selectedResultId, path: "" }), review: saved } } : prev);
      toast.success("Review saved");
      await refreshAll(selectedResultId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save review");
    } finally {
      setBusy(false);
    }
  }

  async function onCompare() {
    if (!selectedResultId || !compareBaseline) return;
    setBusy(true);
    try {
      const response = await compareEvalResults(selectedResultId, compareBaseline);
      const summary = response.comparison?.summary as Record<string, unknown> | undefined;
      toast.success(`Comparison saved${response.path ? `: ${response.path}` : ""}`);
      if (summary) console.info("eval_comparison_summary", summary);
      await refreshAll(selectedResultId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not compare eval results");
    } finally {
      setBusy(false);
    }
  }

  const coreAgentWorkflows = workflowCatalog
    .filter((workflow) => (workflow.tier || "core") === "core")
    .slice()
    .sort((a, b) => workflowSortKey(a).localeCompare(workflowSortKey(b)));
  const visibleProPackGroups = getVisibleProPackGroups().map((group) => ({
    ...group,
    packs: group.packs.filter((pack) => workflowCatalog.some((workflow) => workflow.workflow_id === pack.workflow_id)),
  })).filter((group) => group.packs.length > 0);
  const workflowById = new Map(workflowCatalog.map((workflow) => [workflow.workflow_id, workflow] as const));
  const agentFiles = (selectionOptions?.files || []).map((file) => toWorkflowFileItem(file)).filter((file): file is FileItem => !!file);
  const emptyAgentSelection = useMemo(() => summarizeWorkflowSelection({ file_ids: [], folder_paths: [], current_folder: "" }), []);
  const allResultRuns = result?.runs || [];
  const agentTraceRuns = allResultRuns.filter((run) => !!getAgentContext(run));
  const visibleRuns = allResultRuns;
  const activeRunKey = evalView === "agent" ? activeAgentRunKey : activeWorkflowRunKey;
  const selectedRun = visibleRuns.find((run) => (run.run_key || run.workflow_id) === activeRunKey) || null;
  const activeRun = selectedRun || (visibleRuns.length === 1 ? visibleRuns[0] : null);
  const sufficientAgentRuns = agentTraceRuns.filter((run) => getAgentContext(run)?.sufficient).length;
  const totalAgentTurns = agentTraceRuns.reduce((total, run) => total + (getAgentContext(run)?.retrieval_trace?.length || 0), 0);
  const totalAgentDecisions = agentTraceRuns.reduce((total, run) => total + (getAgentContext(run)?.decision_trace?.length || 0), 0);
  const manifestPaths = parseManifestPaths(launcher.manifest_paths);
  const manifestFolderPaths = folderPathsFromManifest(manifestPaths);
  const appSelectionSummary = summarizeAppSelection(launcher.app_file_ids, launcher.app_folder_paths);
  const jobIsActive = !!job && ["queued", "running"].includes(job.status);

  if (loading) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading internal eval console…</div>;
  }

  if (!frontendAdminAllowed || statusError) {
    return (
      <div className="grid h-full place-items-center bg-background p-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Internal eval console unavailable</CardTitle>
            <CardDescription>{statusError || "This route is disabled for the current build or account."}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!statusChecked) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading internal eval console…</div>;
  }

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
      <div className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-0">
        <aside className="min-h-0 min-w-0 border-r bg-muted/20 overflow-hidden">
          <ScrollArea className="h-full min-w-0 overflow-hidden [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:min-w-0 [&_[data-slot=scroll-area-viewport]>div]:w-full">
            <div className="w-full min-w-0 max-w-full space-y-4 p-4">
              <div className="min-w-0 space-y-3">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Internal evals</h1>
                  <p className="text-sm text-muted-foreground">Run, compare, and review agent turns and workflow outputs.</p>
                </div>
                <div className="grid min-w-0 grid-cols-2 rounded-lg border bg-background p-1 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setEvalView("agent");
                      setActiveAgentRunKey("");
                    }}
                    className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 transition ${evalView === "agent" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <Bot className="h-4 w-4" /> Agent
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEvalView("workflows");
                      setActiveAgentRunKey("");
                    }}
                    className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 transition ${evalView === "workflows" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <ListChecks className="h-4 w-4" /> Workflows
                  </button>
                </div>
              </div>

              <Card className="min-w-0 overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">New run</CardTitle>
                  <CardDescription>Use a saved case with local fixture paths or uploaded app documents.</CardDescription>
                </CardHeader>
                <CardContent className="min-w-0 space-y-3">
                  <input
                    ref={filePickerRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      addManifestFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                  <input
                    ref={folderPickerRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      addManifestFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />

                  <label className="block min-w-0 space-y-1 text-sm">
                    <span className="font-medium">Case</span>
                    <select
                      className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
                      value={launcher.case_path}
                      onChange={(event) => setLauncher((prev) => ({ ...prev, case_path: event.target.value }))}
                    >
                      <option value={launcher.case_path}>{launcher.case_path}</option>
                      {cases.map((item) => <option key={item.path} value={item.path}>{item.eval_id || item.path}</option>)}
                    </select>
                  </label>
                  <div className="grid min-w-0 grid-cols-2 gap-2">
                    <label className="block min-w-0 space-y-1 text-sm">
                      <span className="font-medium">Mode</span>
                      <Input value={launcher.mode} onChange={(event) => setLauncher((prev) => ({ ...prev, mode: event.target.value }))} />
                    </label>
                    <label className="block min-w-0 space-y-1 text-sm">
                      <span className="font-medium">Eval UID</span>
                      <Input placeholder="current user" value={launcher.uid} onChange={(event) => setLauncher((prev) => ({ ...prev, uid: event.target.value }))} />
                    </label>
                  </div>
                  <label className="block min-w-0 space-y-1 text-sm">
                    <span className="font-medium">Prompt version</span>
                    <Input placeholder="legal-negotiation-v4" value={launcher.prompt_version} onChange={(event) => setLauncher((prev) => ({ ...prev, prompt_version: event.target.value }))} />
                  </label>
                  <label className="block min-w-0 space-y-1 text-sm">
                    <span className="font-medium">Workflow version</span>
                    <Input placeholder="legal-workflows-v2" value={launcher.workflow_version} onChange={(event) => setLauncher((prev) => ({ ...prev, workflow_version: event.target.value }))} />
                  </label>
                  <label className="block min-w-0 space-y-1 text-sm">
                    <span className="font-medium">Compare to</span>
                    <select
                      className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
                      value={launcher.compare_to}
                      onChange={(event) => setLauncher((prev) => ({ ...prev, compare_to: event.target.value }))}
                    >
                      <option value="">No baseline</option>
                      {results.map((item) => <option key={item.id} value={item.id}>{item.eval_id} · {fmtDate(item.created_at)}</option>)}
                    </select>
                  </label>
                  {evalView === "agent" ? (
                    <div className="min-w-0 space-y-3 rounded-lg border bg-background p-3 text-sm">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">Workflow type</div>
                          <div className="text-xs text-muted-foreground">Choose the workflow, then select source files and instructions in the launcher.</div>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => refreshAppSelectionOptions()} disabled={selectionOptionsLoading}>
                          <RefreshCcw className="mr-1 h-3.5 w-3.5" /> Files
                        </Button>
                      </div>

                      <div className="grid min-w-0 grid-cols-2 rounded-lg border bg-muted/40 p-1 text-sm">
                        <button
                          type="button"
                          onClick={() => setAgentLibraryView("core")}
                          className={`rounded-md px-3 py-2 transition ${agentLibraryView === "core" ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/70"}`}
                        >
                          Core
                        </button>
                        <button
                          type="button"
                          onClick={() => setAgentLibraryView("pro")}
                          className={`rounded-md px-3 py-2 transition ${agentLibraryView === "pro" ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/70"}`}
                        >
                          Pro
                        </button>
                      </div>

                      {agentLibraryView === "core" ? (
                        <div className="max-h-72 space-y-1.5 overflow-auto rounded-md border p-2">
                          {coreAgentWorkflows.length ? coreAgentWorkflows.map((workflow) => (
                            <button
                              key={workflow.workflow_id}
                              type="button"
                              onClick={() => openAgentWorkflowLauncher(workflow)}
                              className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-primary/5"
                            >
                              <span className="block truncate font-medium">{workflow.title}</span>
                              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{workflow.description}</span>
                            </button>
                          )) : <div className="p-3 text-xs text-muted-foreground">No core workflows are available.</div>}
                        </div>
                      ) : (
                        <div className="max-h-72 space-y-3 overflow-auto rounded-md border p-2">
                          {visibleProPackGroups.length ? visibleProPackGroups.map((group) => (
                            <div key={group.id} className="space-y-1.5">
                              {visibleProPackGroups.length > 1 ? <div className="px-2 text-xs font-medium text-muted-foreground">{group.title}</div> : null}
                              {group.packs.map((pack) => {
                                const workflow = workflowById.get(pack.workflow_id);
                                return (
                                  <button
                                    key={pack.id}
                                    type="button"
                                    disabled={!workflow}
                                    onClick={() => workflow && openAgentWorkflowLauncher(workflow, buildProPackInputs(group, pack))}
                                    className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <span className="block truncate font-medium">{pack.title}</span>
                                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{pack.description}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )) : <div className="p-3 text-xs text-muted-foreground">No pro workflows are available.</div>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                  <div className="min-w-0 space-y-2 rounded-lg border bg-background p-3 text-sm">
                    <div>
                      <div className="font-medium">Document source</div>
                      <div className="mt-2 grid min-w-0 grid-cols-2 rounded-lg border bg-muted/40 p-1 text-sm">
                        <button
                          type="button"
                          onClick={() => setLauncher((prev) => ({ ...prev, document_source: "local" }))}
                          className={`rounded-md px-3 py-2 transition ${launcher.document_source === "local" ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/70"}`}
                        >
                          Local docs
                        </button>
                        <button
                          type="button"
                          onClick={() => setLauncher((prev) => ({ ...prev, document_source: "app" }))}
                          className={`rounded-md px-3 py-2 transition ${launcher.document_source === "app" ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/70"}`}
                        >
                          In-app docs
                        </button>
                      </div>
                    </div>
                  </div>

                  {launcher.document_source === "local" ? (
                    <div className="min-w-0 space-y-2 rounded-lg border bg-background p-3 text-sm">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">Document manifest</div>
                          <div className="text-xs text-muted-foreground">
                            {manifestPaths.length ? `${manifestPaths.length} selected path${manifestPaths.length === 1 ? "" : "s"}` : "Browse files or folders to fill paths; matching uploaded files or bundled eval fixtures will be used."}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => filePickerRef.current?.click()}>
                            <FileSearch className="h-3.5 w-3.5" /> Files
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => {
                              folderPickerRef.current?.setAttribute("webkitdirectory", "");
                              folderPickerRef.current?.setAttribute("directory", "");
                              folderPickerRef.current?.click();
                            }}
                          >
                            <FolderOpen className="h-3.5 w-3.5" /> Folder
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        className="min-w-0"
                        rows={5}
                        value={launcher.manifest_paths}
                        placeholder={"contracts/nda/example.txt\ncontracts/msa_saas/example.txt"}
                        onChange={(event) => setLauncher((prev) => ({ ...prev, manifest_paths: event.target.value }))}
                      />
                      <div className="min-w-0 space-y-2 text-xs text-muted-foreground">
                        {manifestFolderPaths.length ? <div className="break-words">Folders inferred for selection: {manifestFolderPaths.slice(0, 3).join(", ")}{manifestFolderPaths.length > 3 ? ` +${manifestFolderPaths.length - 3} more` : ""}</div> : null}
                        <label className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={launcher.apply_selection_to_workflows}
                            onChange={(event) => setLauncher((prev) => ({ ...prev, apply_selection_to_workflows: event.target.checked }))}
                          />
                          <span className="min-w-0 break-words">Apply this manifest to every workflow in the case</span>
                        </label>
                        <label className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={launcher.remember_manifest_paths}
                            onChange={(event) => setLauncher((prev) => ({ ...prev, remember_manifest_paths: event.target.checked }))}
                          />
                          <span className="min-w-0 break-words">Remember these paths in this browser</span>
                        </label>
                        {manifestPaths.length ? (
                          <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setLauncher((prev) => ({ ...prev, manifest_paths: "" }))}>
                            Clear manifest paths
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0 space-y-3 rounded-lg border bg-background p-3 text-sm">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">Uploaded documents</div>
                          <div className="text-xs text-muted-foreground">{appSelectionSummary}</div>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={refreshAppSelectionOptions} disabled={selectionOptionsLoading}>
                          <RefreshCcw className="h-3.5 w-3.5" /> Refresh
                        </Button>
                      </div>

                      {selectionOptionsLoading ? <div className="text-xs text-muted-foreground">Loading uploaded documents…</div> : null}

                      {selectionOptions?.folders?.length ? (
                        <div className="min-w-0 space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">Folders</div>
                          <div className="max-h-28 space-y-1 overflow-auto rounded-md border p-2">
                            {selectionOptions.folders.map((folder) => (
                              <label key={folder.path} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                                <input type="checkbox" className="shrink-0" checked={launcher.app_folder_paths.includes(folder.path)} onChange={() => toggleAppFolder(folder.path)} />
                                <span className="min-w-0 flex-1 truncate">{folder.path}</span>
                                <span className="text-xs text-muted-foreground">{folder.recursive_file_count || 0}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="min-w-0 space-y-2">
                        <div className="text-xs font-medium text-muted-foreground">Files</div>
                        <div className="max-h-44 space-y-1 overflow-auto rounded-md border p-2">
                          {selectionOptions?.files?.length ? selectionOptions.files.map((file) => {
                            const fileId = getFileField(file, "id");
                            if (!fileId) return null;
                            return (
                              <label key={fileId} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                                <input type="checkbox" className="shrink-0" checked={launcher.app_file_ids.includes(fileId)} onChange={() => toggleAppFile(fileId)} />
                                <span className="min-w-0 flex-1 truncate">{fileDisplayPath(file)}</span>
                              </label>
                            );
                          }) : <div className="p-2 text-xs text-muted-foreground">No uploaded documents found for this UID.</div>}
                        </div>
                      </div>

                      <label className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={launcher.apply_selection_to_workflows}
                          onChange={(event) => setLauncher((prev) => ({ ...prev, apply_selection_to_workflows: event.target.checked }))}
                        />
                        <span className="min-w-0 break-words">Apply this app document selection to every workflow in the case</span>
                      </label>
                      {launcher.app_file_ids.length || launcher.app_folder_paths.length ? (
                        <button type="button" className="text-xs text-primary underline-offset-4 hover:underline" onClick={() => setLauncher((prev) => ({ ...prev, app_file_ids: [], app_folder_paths: [] }))}>
                          Clear app document selection
                        </button>
                      ) : null}
                    </div>
                  )}
                    </>
                  )}
                  <label className="block min-w-0 space-y-1 text-sm">
                    <span className="font-medium">Notes</span>
                    <Textarea className="min-w-0" rows={3} value={launcher.notes} onChange={(event) => setLauncher((prev) => ({ ...prev, notes: event.target.value }))} />
                  </label>
                  {evalView === "workflows" ? (
                    <Button className="w-full gap-2" onClick={onRunEval} disabled={busy || jobIsActive || !launcher.case_path}>
                      <Play className="h-4 w-4" /> {jobIsActive ? "Eval running" : "Run eval"}
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                      Select a workflow type above to open the file and instruction launcher.
                    </div>
                  )}
                </CardContent>
              </Card>

              {job ? (
                <Card className="min-w-0 overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex min-w-0 items-center justify-between gap-3 text-base">
                      <span className="min-w-0 truncate">Current eval run</span>
                      <span className="shrink-0">{statusBadge(job.status)}</span>
                    </CardTitle>
                    <CardDescription className="break-all">{job.id}</CardDescription>
                  </CardHeader>
                  <CardContent className="min-w-0 space-y-4 text-sm">
                    <div className="space-y-2">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{jobCompletedCount(job)}/{job.total_runs || 0} workflow runs finished</span>
                        <span>{jobProgressPercent(job)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${jobProgressPercent(job)}%` }} />
                      </div>
                    </div>

                    <div className="grid min-w-0 grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg border bg-background p-2">
                        <div className="font-semibold text-emerald-600">{job.completed_runs || 0}</div>
                        <div className="text-muted-foreground">completed</div>
                      </div>
                      <div className="rounded-lg border bg-background p-2">
                        <div className="font-semibold text-destructive">{job.failed_runs || 0}</div>
                        <div className="text-muted-foreground">failed</div>
                      </div>
                      <div className="rounded-lg border bg-background p-2">
                        <div className="font-semibold">{job.skipped_runs || 0}</div>
                        <div className="text-muted-foreground">skipped</div>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-1 rounded-lg border bg-background p-3">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>Runtime {jobRuntime(job)}</span>
                        <span className="break-words">{job.validation_error_count || 0} validation errors · {job.validation_warning_count || 0} warnings</span>
                      </div>
                      {job.current_label ? (
                        <div className="mt-2 text-sm">
                          <span className="text-muted-foreground">Running now: </span>
                          <span className="font-medium break-words">{job.current_label}</span>
                        </div>
                      ) : null}
                      {job.last_message ? <div className="mt-2 break-words text-xs text-muted-foreground">{job.last_message}</div> : null}
                    </div>

                    {job.export_path ? (
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs font-medium">Export</div>
                        <div className="break-all rounded-md bg-muted p-2 text-xs text-muted-foreground">{job.export_path}</div>
                      </div>
                    ) : null}

                    {job.error ? <div className="break-words rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">{job.error}</div> : null}

                    {job.messages?.length ? (
                      <div className="min-w-0 space-y-2">
                        <div className="text-xs font-medium">Run messages</div>
                        <div className="max-h-56 space-y-2 overflow-auto pr-1">
                          {job.messages.slice().reverse().slice(0, 12).map((message, index) => (
                            <div key={`${message.at}-${index}`} className={`break-words rounded-md border p-2 text-xs ${jobMessageClass(message.level)}`}>
                              <div>{message.message}</div>
                              <div className="mt-1 opacity-70">{fmtDate(message.at)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              {jobs.length > 1 ? (
                <Card className="min-w-0 overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Recent jobs</CardTitle>
                    <CardDescription>Use this to reopen a running or recent eval job after refresh.</CardDescription>
                  </CardHeader>
                  <CardContent className="min-w-0 space-y-2">
                    {jobs.slice(0, 5).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setJob(item)}
                        className={`w-full min-w-0 overflow-hidden rounded-lg border p-2 text-left text-xs transition hover:bg-muted ${job?.id === item.id ? "border-primary bg-primary/5" : "bg-background"}`}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium">{item.id}</span>
                          <span className="shrink-0">{statusBadge(item.status)}</span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {jobCompletedCount(item)}/{item.total_runs || 0} runs · {fmtDate(item.created_at)}
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              <Card className="min-w-0 overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="flex min-w-0 items-center justify-between text-base">
                    <span>Results</span>
                    <Button variant="ghost" size="icon" onClick={() => refreshAll()}><RefreshCcw className="h-4 w-4" /></Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 space-y-2">
                  {results.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectResult(item.id)}
                      className={`w-full min-w-0 overflow-hidden rounded-lg border p-3 text-left transition hover:bg-muted ${selectedResultId === item.id ? "border-primary bg-primary/5" : "bg-background"}`}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 truncate font-medium">{item.eval_id}</div>
                        <span className="shrink-0">{item.failed_count ? <Badge variant="destructive">{item.failed_count} failed</Badge> : <Badge variant="outline">{item.completed_count}/{item.run_count}</Badge>}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{fmtDate(item.created_at)}</div>
                      <div className="mt-2 flex min-w-0 flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{item.validation_error_count} errors</span>
                        <span>{item.validation_warning_count} warnings</span>
                        {item.has_review ? <span>reviewed</span> : null}
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </aside>

        <main className="min-h-0 min-w-0 overflow-hidden">
          {!result ? (
            <div className="grid h-full min-w-0 place-items-center text-sm text-muted-foreground">Select or run an eval to review results.</div>
          ) : (
            <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
              <header className="min-w-0 border-b p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Activity className="h-5 w-5 text-primary" />
                      <h2 className="min-w-0 break-words text-xl font-semibold tracking-tight">{result.eval_id}</h2>
                    </div>
                    <p className="mt-1 break-words text-sm text-muted-foreground">{result.description || "No description provided."}</p>
                    <div className="mt-2 flex min-w-0 flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>Created {fmtDate(result.created_at)}</span>
                      <span>Mode {result.mode}</span>
                      <span>Commit {result.app_git_commit || "unknown"}</span>
                      <span className="truncate">Case {result.case_fingerprint?.slice(0, 12)}</span>
                      <span>{agentTraceRuns.length} agent traces</span>
                      <span>{sufficientAgentRuns}/{agentTraceRuns.length || 0} sufficient</span>
                      <span>{totalAgentTurns} agent turns</span>
                      <span>{totalAgentDecisions} decision steps</span>
                    </div>
                  </div>
                  <div className="flex min-w-0 shrink-0 flex-wrap justify-end gap-2">
                    <a href={evalResultDownloadUrl(selectedResultId)} target="_blank" rel="noreferrer">
                      <Button variant="outline" className="gap-2"><Download className="h-4 w-4" /> JSON</Button>
                    </a>
                    <select className="h-10 min-w-0 max-w-[280px] rounded-md border bg-background px-3 text-sm" value={compareBaseline} onChange={(event) => setCompareBaseline(event.target.value)}>
                      <option value="">Baseline</option>
                      {results.filter((item) => item.id !== selectedResultId).map((item) => <option key={item.id} value={item.id}>{item.eval_id} · {fmtDate(item.created_at)}</option>)}
                    </select>
                    <Button variant="outline" className="gap-2" onClick={onCompare} disabled={!compareBaseline || busy}><GitCompare className="h-4 w-4" /> Compare</Button>
                    <Button className="gap-2" onClick={onSaveReview} disabled={busy}><Save className="h-4 w-4" /> Save review</Button>
                  </div>
                </div>
              </header>

              <div className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,300px)_minmax(0,1fr)] overflow-hidden">
                <ScrollArea className="h-full min-h-0 min-w-0 overflow-hidden border-r [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:min-w-0 [&_[data-slot=scroll-area-viewport]>div]:w-full">
                  <div className="w-full min-w-0 max-w-full space-y-2 p-3">
                    {evalView === "agent" ? (
                      <div className="min-w-0 break-words rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                        {agentTraceRuns.length
                          ? "Select a run to inspect retrieval turns, context coverage, and grounding separately from workflow output review."
                          : "This result has workflow output but no agent trace metadata. Select the run to review the output and confirm why no trace was captured."}
                      </div>
                    ) : null}
                    {visibleRuns.length ? visibleRuns.map((run) => {
                      const key = run.run_key || run.workflow_id;
                      const agentContext = getAgentContext(run);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            if (evalView === "agent") setActiveAgentRunKey(key);
                            else setActiveWorkflowRunKey(key);
                          }}
                          className={`w-full min-w-0 overflow-hidden rounded-lg border p-3 text-left transition hover:bg-muted ${activeRunKey === key ? "border-primary bg-primary/5" : "bg-background"}`}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 truncate font-medium">{run.label || run.title || run.workflow_id}</div>
                            <span className="shrink-0">{evalView === "agent" ? agentContextBadge(agentContext) : statusBadge(run.status)}</span>
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{run.workflow_id}</div>
                          {evalView === "agent" ? (
                            <div className="mt-2 flex min-w-0 flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>{agentContext?.retrieval_trace?.length || 0} turns</span>
                              <span>{agentContext?.decision_trace?.length || 0} decisions</span>
                              <span>{agentContext?.selected_chunks || 0} chunks</span>
                              <span className="min-w-0 max-w-full truncate">{agentContext?.profile || "no profile"}</span>
                            </div>
                          ) : (
                            <div className="mt-2 text-xs">{validationSummary(run)}</div>
                          )}
                        </button>
                      );
                    }) : (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        {evalView === "agent" ? "No eval runs were captured for this result." : "No workflow runs were captured for this eval result."}
                      </div>
                    )}
                  </div>
                </ScrollArea>

                <ScrollArea className="h-full min-h-0 min-w-0 overflow-hidden [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:min-w-0 [&_[data-slot=scroll-area-viewport]>div]:w-full">
                  {activeRun ? (
                    <RunReviewPanel
                      run={activeRun}
                      view={evalView}
                      draft={reviewDraft[activeRun.run_key || activeRun.workflow_id] || { scores: {}, notes: {}, summary: "" }}
                      onDraftChange={(next) => setReviewDraft((prev) => ({ ...prev, [activeRun.run_key || activeRun.workflow_id]: next }))}
                      reviewNotes={reviewNotes}
                      setReviewNotes={setReviewNotes}
                    />
                  ) : (
                    <EvalViewerEmptyState view={evalView} hasRuns={visibleRuns.length > 0} />
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </main>
      </div>

      {isLegalWorkflow(agentWorkflow) ? (
        <LegalWorkflowLauncher
          open={agentLauncherOpen}
          workflow={agentWorkflow}
          selection={emptyAgentSelection}
          selectionMode="picker"
          availableFiles={agentFiles}
          filesLoading={selectionOptionsLoading}
          submitting={agentSubmitting || jobIsActive}
          initialInputs={agentInitialInputs}
          onOpenChange={(open) => {
            setAgentLauncherOpen(open);
            if (!open) {
              setAgentWorkflow(null);
              setAgentInitialInputs({});
            }
          }}
          onRun={onRunAgentWorkflow}
        />
      ) : (
        <WorkflowLauncher
          open={agentLauncherOpen}
          workflow={agentWorkflow}
          selection={emptyAgentSelection}
          selectionMode="picker"
          availableFiles={agentFiles}
          filesLoading={selectionOptionsLoading}
          submitting={agentSubmitting || jobIsActive}
          initialInputs={agentInitialInputs}
          onOpenChange={(open) => {
            setAgentLauncherOpen(open);
            if (!open) {
              setAgentWorkflow(null);
              setAgentInitialInputs({});
            }
          }}
          onRun={onRunAgentWorkflow}
        />
      )}
    </div>
  );
}


function EvalViewerEmptyState({ view, hasRuns }: { view: EvalView; hasRuns: boolean }) {
  if (view === "agent") {
    return (
      <div className="grid h-full min-w-0 min-h-[420px] place-items-center p-6">
        <Card className="max-w-lg border-dashed text-center">
          <CardHeader>
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
              <Bot className="h-5 w-5 text-muted-foreground" />
            </div>
            <CardTitle>Agent eval viewer</CardTitle>
            <CardDescription>
              {hasRuns
                ? "Select a run from the left. Runs without trace metadata can still be reviewed for workflow output."
                : "This eval result does not include runs yet."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid h-full min-w-0 min-h-[420px] place-items-center p-6">
      <Card className="max-w-lg border-dashed text-center">
        <CardHeader>
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
            <ListChecks className="h-5 w-5 text-muted-foreground" />
          </div>
          <CardTitle>Workflow eval viewer</CardTitle>
          <CardDescription>
            {hasRuns ? "Select a workflow run from the left to review output quality and validation issues." : "This eval result does not include workflow runs."}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function RunReviewPanel({
  run,
  view,
  draft,
  onDraftChange,
  reviewNotes,
  setReviewNotes,
}: {
  run: EvalRunRecord;
  view: EvalView;
  draft: { scores: Record<string, number | null>; notes: Record<string, string>; summary: string };
  onDraftChange: (next: { scores: Record<string, number | null>; notes: Record<string, string>; summary: string }) => void;
  reviewNotes: string;
  setReviewNotes: (value: string) => void;
}) {
  const issues = run.validation?.issues || [];
  if (view === "agent") {
    return (
      <AgentRunReviewPanel
        run={run}
        draft={draft}
        onDraftChange={onDraftChange}
        reviewNotes={reviewNotes}
        setReviewNotes={setReviewNotes}
      />
    );
  }
  return (
    <div className="w-full min-w-0 max-w-full space-y-4 overflow-hidden p-4">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <CardTitle className="min-w-0 break-words">{run.label || run.title || run.workflow_id}</CardTitle>
            {statusBadge(run.status)}
          </div>
          <CardDescription className="break-words">{run.workflow_id} · {fmtMs(run.duration_ms)} · {run.sources?.length || 0} sources</CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-3 text-sm md:grid-cols-2">
          <div><span className="font-medium">Prompt version:</span> {run.prompt_version || "not set"}</div>
          <div><span className="font-medium">Workflow version:</span> {run.workflow_version || "not set"}</div>
          <div className="truncate"><span className="font-medium">Output:</span> {run.output_fingerprint?.slice(0, 16) || "—"}</div>
          <div className="truncate"><span className="font-medium">Config:</span> {run.config_fingerprint?.slice(0, 16) || "—"}</div>
        </CardContent>
      </Card>

      {run.error ? (
        <Card className="min-w-0 overflow-hidden border-destructive/40">
          <CardHeader><CardTitle className="text-base text-destructive">Run error</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap break-words text-sm text-destructive">{run.error}</CardContent>
        </Card>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            {issues.some((issue) => issue.severity === "error") ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            Validation
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-2 text-sm">
          {!issues.length ? <div className="text-muted-foreground">No validation issues.</div> : issues.map((issue, index) => (
            <div key={`${issue.code}-${index}`} className="min-w-0 break-words rounded-md border p-2">
              <div className="font-medium">{issue.severity.toUpperCase()} · {issue.code}</div>
              <div className="text-muted-foreground">{issue.message}</div>
              {issue.path ? <div className="mt-1 text-xs text-muted-foreground">{issue.path}</div> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Rubric review</CardTitle>
          <CardDescription>Score criteria manually after reading the output.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3">
          {run.criterion_scores?.length ? run.criterion_scores.map((criterion) => (
            <div key={criterion.criterion_id} className="min-w-0 rounded-lg border p-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-0">
                  <div className="break-words font-medium">{criterion.label}</div>
                  <div className="text-xs text-muted-foreground">Weight {criterion.weight} · Max {criterion.max_score}</div>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={criterion.max_score}
                  step={0.5}
                  className="w-28"
                  value={draft.scores[criterion.criterion_id] ?? ""}
                  onChange={(event) => onDraftChange({
                    ...draft,
                    scores: { ...draft.scores, [criterion.criterion_id]: event.target.value === "" ? null : Number(event.target.value) },
                  })}
                />
              </div>
              <Textarea
                className="mt-3 min-w-0"
                rows={2}
                placeholder="Criterion notes"
                value={draft.notes[criterion.criterion_id] || ""}
                onChange={(event) => onDraftChange({ ...draft, notes: { ...draft.notes, [criterion.criterion_id]: event.target.value } })}
              />
            </div>
          )) : <div className="text-sm text-muted-foreground">No rubric attached to this run.</div>}
          <Textarea
            rows={3}
            placeholder="Run-level review summary"
            value={draft.summary}
            onChange={(event) => onDraftChange({ ...draft, summary: event.target.value })}
          />
          <Textarea
            rows={3}
            placeholder="Overall eval notes"
            value={reviewNotes}
            onChange={(event) => setReviewNotes(event.target.value)}
          />
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader><CardTitle className="text-base">Output</CardTitle></CardHeader>
        <CardContent className="prose prose-sm max-w-none overflow-x-auto break-words dark:prose-invert [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:break-words [&_th]:break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.output_markdown || "_No output._"}</ReactMarkdown>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader><CardTitle className="text-base">Sources</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {run.sources?.length ? run.sources.map((source, index) => (
            <div key={`${source.file_id || index}`} className="min-w-0 break-words rounded-md border p-2">
              <div className="font-medium">{String(source.name || source.file_id || `Source ${index + 1}`)}</div>
              <div className="break-all text-xs text-muted-foreground">{String(source.file_id || "")}</div>
            </div>
          )) : <div className="text-muted-foreground">No sources captured.</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function AgentRunReviewPanel({
  run,
  draft,
  onDraftChange,
  reviewNotes,
  setReviewNotes,
}: {
  run: EvalRunRecord;
  draft: { scores: Record<string, number | null>; notes: Record<string, string>; summary: string };
  onDraftChange: (next: { scores: Record<string, number | null>; notes: Record<string, string>; summary: string }) => void;
  reviewNotes: string;
  setReviewNotes: (value: string) => void;
}) {
  const context = getAgentContext(run);
  const trace = context?.retrieval_trace || [];
  const decisions = context?.decision_trace || [];
  const workflowStrategy = String(asRecord(run.structured_metadata)?.source_strategy || "");
  const supportedIssues = getSupportedIssues(run);
  const isSupportedIssue = (item: SupportedIssueRecord) => ["strong", "partial", "negative_scan_supported"].includes(item.support_status || "") || (!item.support_status && item.source_support.length > 0);
  const supportBadgeLabel = (status?: string, hasSupport?: boolean) => {
    if (status === "strong") return "Strong support";
    if (status === "partial") return "Partial support";
    if (status === "negative_scan_supported") return "Scan supported";
    if (status === "weak") return "Weak support";
    if (status === "unsupported") return "Needs review";
    return hasSupport ? "Supported" : "Needs review";
  };
  const supportedIssueCount = supportedIssues.filter(isSupportedIssue).length;
  const groupSupportSummary = (key: string) => {
    const group = asRecord(context?.source_support_summary?.[key]);
    if (!group) return null;
    return {
      total: Number(group.total || 0),
      supported: Number(group.supported || 0),
      strong: Number(group.strong || 0),
      partial: Number(group.partial || 0),
      weak: Number(group.weak || 0),
      unsupported: Number(group.unsupported || 0),
    };
  };
  const supportSummaryRows = [
    ["Risks", groupSupportSummary("risk_items")],
    ["Clauses", groupSupportSummary("clause_items")],
    ["Obligations", groupSupportSummary("obligation_items")],
    ["Fallbacks", groupSupportSummary("fallback_items")],
    ["Fields", groupSupportSummary("fields")],
  ].filter(([, value]) => value && (value as ReturnType<typeof groupSupportSummary>)!.total > 0) as [string, NonNullable<ReturnType<typeof groupSupportSummary>>][];
  const selectedClauseEntries = context?.selected_clause_map_entries || [];
  const clauseSelection = context?.clause_map_selection || {};
  const totalAddedChunks = trace.reduce((total, step) => total + Number(step.chunks_added || 0), 0);
  const targetedTurns = trace.filter((step) => step.type === "targeted_query").length;
  const neighborTurns = trace.filter((step) => step.type === "neighbor_expansion").length;

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 overflow-hidden p-4">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex min-w-0 items-center gap-2 break-words">
              <Bot className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 break-words">{run.label || run.title || run.workflow_id}</span>
            </CardTitle>
            <span className="shrink-0">{agentContextBadge(context)}</span>
          </div>
          <CardDescription className="break-words">{run.workflow_id} · {fmtMs(run.duration_ms)} · {trace.length} agent turn{trace.length === 1 ? "" : "s"} · {decisions.length} decision step{decisions.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-3 text-sm md:grid-cols-4">
          <div className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">Profile</div>
            <div className="mt-1 truncate font-semibold">{context?.profile || "—"}</div>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">Selected chunks</div>
            <div className="mt-1 font-semibold">{context?.selected_chunks || 0}</div>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">Returned sources</div>
            <div className="mt-1 font-semibold">{context?.returned_sources || 0}</div>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">Chunks added by turns</div>
            <div className="mt-1 font-semibold">{totalAddedChunks}</div>
          </div>
        </CardContent>
      </Card>

      {!context ? (
        <Card className="min-w-0 overflow-hidden border-amber-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> No agent trace captured
            </CardTitle>
            <CardDescription>This run did not include adaptive context metadata in the eval export.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            New eval exports will include the adaptive context trace when the workflow uses the context agent.
          </CardContent>
        </Card>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <FileSearch className="h-4 w-4" /> Clause map selection
          </CardTitle>
          <CardDescription>
            {selectedClauseEntries.length} selected clause-map entr{selectedClauseEntries.length === 1 ? "y" : "ies"}
            {typeof clauseSelection.method === "string" ? ` · ${clauseSelection.method}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3 text-sm">
          {selectedClauseEntries.length ? selectedClauseEntries.slice(0, 12).map((entry, index) => (
            <div key={`${entry.entry_id || entry.title || "entry"}-${index}`} className="min-w-0 overflow-hidden rounded-lg border p-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 basis-0">
                  <div className="break-words font-medium">{entry.title || entry.normalized_type || entry.entry_id || "Clause map entry"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{entry.normalized_type || entry.clause_family || entry.entry_kind || "clause"}</div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {entry.status ? <Badge variant="outline">{entry.status}</Badge> : null}
                  {entry.confidence ? <Badge variant="secondary">{entry.confidence}</Badge> : null}
                </div>
              </div>
              {entry.summary ? <div className="mt-2 break-words rounded-md bg-muted p-2 text-xs text-muted-foreground">{entry.summary}</div> : null}
              {entry.source_spans?.length ? (
                <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                  {entry.source_spans.slice(0, 6).map((span, spanIndex) => (
                    <Badge key={`${span.chunk_id || spanIndex}`} variant="secondary" className="max-w-full truncate">
                      {span.chunk_id || "chunk"}{typeof span.chunk_index === "number" ? ` · #${span.chunk_index}` : ""}
                    </Badge>
                  ))}
                </div>
              ) : <div className="mt-2 text-xs text-muted-foreground">No chunk/span anchors attached.</div>}
              {entry.cross_references?.length ? <div className="mt-2 break-words text-xs text-muted-foreground">Refs: {entry.cross_references.slice(0, 6).join(", ")}</div> : null}
            </div>
          )) : <div className="text-muted-foreground">No clause-map selection metadata was captured for this run.</div>}
        </CardContent>
      </Card>

      {supportSummaryRows.length ? (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base">
              <FileSearch className="h-4 w-4" /> Source support summary
            </CardTitle>
            <CardDescription>Internal eval coverage across structured output groups. Weak support is not counted as supported.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto text-sm">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Group</th>
                  <th className="px-2 py-1 font-medium">Supported</th>
                  <th className="px-2 py-1 font-medium">Strong</th>
                  <th className="px-2 py-1 font-medium">Partial</th>
                  <th className="px-2 py-1 font-medium">Weak</th>
                  <th className="px-2 py-1 font-medium">Unsupported</th>
                </tr>
              </thead>
              <tbody>
                {supportSummaryRows.map(([label, row]) => (
                  <tr key={label} className="border-t">
                    <td className="px-2 py-1 font-medium">{label}</td>
                    <td className="px-2 py-1">{row.supported}/{row.total}</td>
                    <td className="px-2 py-1">{row.strong}</td>
                    <td className="px-2 py-1">{row.partial}</td>
                    <td className="px-2 py-1">{row.weak}</td>
                    <td className="px-2 py-1">{row.unsupported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <FileSearch className="h-4 w-4" /> Source support by issue
          </CardTitle>
          <CardDescription>{supportedIssueCount} of {supportedIssues.length} risk item{supportedIssues.length === 1 ? "" : "s"} have matched source support.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3 text-sm">
          {supportedIssues.length ? supportedIssues.map((issue, index) => (
            <div key={`${issue.issue}-${index}`} className="min-w-0 overflow-hidden rounded-lg border p-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 basis-0">
                  <div className="break-words font-medium">{issue.issue}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{issue.clause_family || "general"}</div>
                </div>
                <Badge variant={isSupportedIssue(issue) ? "outline" : "secondary"}>{supportBadgeLabel(issue.support_status, issue.source_support.length > 0)}</Badge>
              </div>
              {issue.source_support.length ? (
                <div className="mt-2 space-y-2">
                  {issue.source_support.slice(0, 2).map((support, supportIndex) => (
                    <div key={`${support.source_name || "source"}-${support.chunk_id || supportIndex}`} className="min-w-0 rounded-md bg-muted p-2 text-xs">
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        <span className="break-words font-medium">{support.source_name || "Source"}</span>
                        {support.chunk_id ? <Badge variant="secondary">{support.chunk_id}</Badge> : null}
                      </div>
                      {support.excerpt ? <div className="mt-1 break-words text-muted-foreground">{support.excerpt}</div> : null}
                      {support.matched_terms?.length ? <div className="mt-1 break-words text-muted-foreground">Matched: {support.matched_terms.slice(0, 8).join(", ")}</div> : null}
                    </div>
                  ))}
                </div>
              ) : <div className="mt-2 text-xs text-muted-foreground">No direct source-support match was attached for this issue.</div>}
            </div>
          )) : <div className="text-muted-foreground">No structured risk items were available for source support review.</div>}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <Bot className="h-4 w-4" /> Decision rationale
          </CardTitle>
          <CardDescription>Observable decisions the context agent made while preparing evidence for the workflow output.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3 text-sm">
          {decisions.length ? decisions.map((decision, index) => {
            const metadataPreview = formatMetadataPreview(decision.metadata);
            return (
              <div key={`${decision.step || index}-${decision.stage || "decision"}`} className="min-w-0 overflow-hidden rounded-lg border p-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-0">
                    <div className="break-words font-medium">Decision {decision.step || index + 1}: {decision.decision || "Agent decision"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{agentStageLabel(decision.stage)}</div>
                  </div>
                  {decision.action ? <Badge variant="outline" className="max-w-full truncate">{decision.action}</Badge> : null}
                </div>
                {decision.rationale ? (
                  <div className="mt-2 break-words rounded-md bg-muted p-2 text-xs">
                    <span className="font-medium">Why: </span>{decision.rationale}
                  </div>
                ) : null}
                {decision.observation ? <div className="mt-2 break-words text-xs text-muted-foreground"><span className="font-medium">Observed: </span>{decision.observation}</div> : null}
                {decision.outcome ? <div className="mt-1 break-words text-xs text-muted-foreground"><span className="font-medium">Outcome: </span>{decision.outcome}</div> : null}
                {metadataPreview ? <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 text-[11px] text-muted-foreground">{metadataPreview}</pre> : null}
              </div>
            );
          }) : <div className="text-muted-foreground">No decision rationale was captured for this run.</div>}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <Route className="h-4 w-4" /> Agent turn trace
          </CardTitle>
          <CardDescription>
            {targetedTurns} targeted query turn{targetedTurns === 1 ? "" : "s"} · {neighborTurns} neighbor expansion turn{neighborTurns === 1 ? "" : "s"}
            {workflowStrategy ? ` · ${workflowStrategy}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3 text-sm">
          {trace.length ? trace.map((step, index) => (
            <div key={`${step.step || index}-${step.type || "turn"}`} className="min-w-0 overflow-hidden rounded-lg border p-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">Turn {step.step || index + 1}: {agentTurnLabel(step.type)}</span>
                </div>
                <Badge variant="outline" className="shrink-0">+{step.chunks_added || 0} chunks</Badge>
              </div>
              {step.query ? <div className="mt-2 break-words rounded-md bg-muted p-2 text-xs text-muted-foreground">{step.query}</div> : null}
              {step.reason ? <div className="mt-2 break-words text-xs text-muted-foreground">{step.reason}</div> : null}
              {step.chunk_ids?.length ? (
                <div className="mt-2 flex min-w-0 flex-wrap gap-1 overflow-hidden">
                  {step.chunk_ids.slice(0, 10).map((chunkId) => <Badge key={chunkId} variant="secondary" className="max-w-full truncate sm:max-w-[180px]">{chunkId}</Badge>)}
                  {step.chunk_ids.length > 10 ? <Badge variant="secondary">+{step.chunk_ids.length - 10} more</Badge> : null}
                </div>
              ) : null}
            </div>
          )) : <div className="text-muted-foreground">No retrieval turns captured for this run.</div>}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Coverage notes</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-2 text-sm">
          {context?.coverage_notes?.length ? context.coverage_notes.map((note, index) => (
            <div key={`${note}-${index}`} className="break-words rounded-md border bg-muted/30 p-2">{note}</div>
          )) : <div className="text-muted-foreground">No coverage notes captured.</div>}
          {context?.missing_context?.length ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-amber-600">Missing or incomplete context</div>
              {context.missing_context.map((note, index) => (
                <div key={`${note}-${index}`} className="break-words rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">{note}</div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Agent review</CardTitle>
          <CardDescription>Score the retrieval decisions and whether the final output was grounded in the gathered context.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3">
          {AGENT_REVIEW_CRITERIA.map((criterion) => (
            <div key={criterion.id} className="min-w-0 rounded-lg border p-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-0">
                  <div className="break-words font-medium">{criterion.label}</div>
                  <div className="break-words text-xs text-muted-foreground">{criterion.helper}</div>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={5}
                  step={0.5}
                  className="w-28"
                  value={draft.scores[criterion.id] ?? ""}
                  onChange={(event) => onDraftChange({
                    ...draft,
                    scores: { ...draft.scores, [criterion.id]: event.target.value === "" ? null : Number(event.target.value) },
                  })}
                />
              </div>
              <Textarea
                className="mt-3 min-w-0"
                rows={2}
                placeholder="Agent review notes"
                value={draft.notes[criterion.id] || ""}
                onChange={(event) => onDraftChange({ ...draft, notes: { ...draft.notes, [criterion.id]: event.target.value } })}
              />
            </div>
          ))}
          <Textarea
            rows={3}
            placeholder="Run-level agent review summary"
            value={draft.summary}
            onChange={(event) => onDraftChange({ ...draft, summary: event.target.value })}
          />
          <Textarea
            rows={3}
            placeholder="Overall eval notes"
            value={reviewNotes}
            onChange={(event) => setReviewNotes(event.target.value)}
          />
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader><CardTitle className="text-base">Eval output</CardTitle></CardHeader>
        <CardContent className="prose prose-sm max-w-none overflow-x-auto break-words dark:prose-invert [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:break-words [&_th]:break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.output_markdown || "_No output._"}</ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );
}
