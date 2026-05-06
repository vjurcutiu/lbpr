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
  saveEvalReview,
} from "./api";
import type { EvalCaseSummary, EvalJob, EvalResultDetail, EvalResultSummary, EvalRunRecord } from "./types";

const INTERNAL_UI_ENABLED = ["1", "true", "yes"].includes(String(import.meta.env.VITE_ENABLE_INTERNAL_EVAL_UI || "").toLowerCase());
const INTERNAL_ADMIN_EMAILS = String(import.meta.env.VITE_INTERNAL_EVAL_ADMIN_EMAILS || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

type ReviewDraft = Record<string, { scores: Record<string, number | null>; notes: Record<string, string>; summary: string }>;
type EvalView = "workflows" | "agent";

type AgentTraceStep = {
  step?: number;
  type?: string;
  query?: string | null;
  reason?: string | null;
  chunk_ids?: string[];
  chunks_added?: number;
};

type AgentContext = {
  profile?: string;
  sufficient?: boolean;
  selected_chunks?: number;
  returned_sources?: number;
  coverage_notes?: string[];
  missing_context?: string[];
  retrieval_trace?: AgentTraceStep[];
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

export default function InternalEvalsPage() {
  const { user, loading } = useAuthContext();
  const [statusChecked, setStatusChecked] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [cases, setCases] = useState<EvalCaseSummary[]>([]);
  const [results, setResults] = useState<EvalResultSummary[]>([]);
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
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const folderPickerRef = useRef<HTMLInputElement | null>(null);
  const [launcher, setLauncher] = useState({
    case_path: "internal/evals/cases/legal_pro_public_contracts_v2_regression.example.json",
    uid: "",
    mode: "smoke",
    compare_to: "",
    prompt_version: "",
    workflow_version: "",
    notes: "",
    markdown: true,
    manifest_paths: "",
    apply_selection_to_workflows: true,
    remember_manifest_paths: true,
  });

  const frontendAdminAllowed = useMemo(() => {
    if (!INTERNAL_UI_ENABLED) return false;
    if (!INTERNAL_ADMIN_EMAILS.length) return true;
    return !!user?.email && INTERNAL_ADMIN_EMAILS.includes(user.email.toLowerCase());
  }, [user?.email]);

  async function refreshAll(nextResultId = selectedResultId) {
    const [nextCases, nextResults, nextJobs] = await Promise.all([listEvalCases(), listEvalResults(75), listEvalJobs(25)]);
    setCases(nextCases);
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

  async function onRunEval() {
    const manifestPaths = parseManifestPaths(launcher.manifest_paths);
    const folderPaths = folderPathsFromManifest(manifestPaths);
    setBusy(true);
    try {
      const response = await createEvalRun({
        case_path: launcher.case_path,
        uid: launcher.uid.trim() || null,
        mode: launcher.mode.trim() || null,
        compare_to: launcher.compare_to.trim() || null,
        prompt_version: launcher.prompt_version.trim() || null,
        workflow_version: launcher.workflow_version.trim() || null,
        notes: launcher.notes,
        markdown: launcher.markdown,
        manifest_paths: manifestPaths,
        selection: manifestPaths.length
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

  const agentTraceRuns = result?.runs.filter((run) => !!getAgentContext(run)) || [];
  const visibleRuns = evalView === "agent" ? agentTraceRuns : (result?.runs || []);
  const activeRunKey = evalView === "agent" ? activeAgentRunKey : activeWorkflowRunKey;
  const activeRun = visibleRuns.find((run) => (run.run_key || run.workflow_id) === activeRunKey) || null;
  const sufficientAgentRuns = agentTraceRuns.filter((run) => getAgentContext(run)?.sufficient).length;
  const totalAgentTurns = agentTraceRuns.reduce((total, run) => total + (getAgentContext(run)?.retrieval_trace?.length || 0), 0);
  const manifestPaths = parseManifestPaths(launcher.manifest_paths);
  const manifestFolderPaths = folderPathsFromManifest(manifestPaths);
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
    <div className="h-full min-h-0 bg-background text-foreground overflow-hidden">
      <div className="grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)] gap-0">
        <aside className="min-h-0 border-r bg-muted/20 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-4">
              <div className="space-y-3">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Internal evals</h1>
                  <p className="text-sm text-muted-foreground">Run, compare, and review agent turns and workflow outputs.</p>
                </div>
                <div className="grid grid-cols-2 rounded-lg border bg-background p-1 text-sm">
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

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">New run</CardTitle>
                  <CardDescription>Use a saved case and optional version labels.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
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

                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Case</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={launcher.case_path}
                      onChange={(event) => setLauncher((prev) => ({ ...prev, case_path: event.target.value }))}
                    >
                      <option value={launcher.case_path}>{launcher.case_path}</option>
                      {cases.map((item) => <option key={item.path} value={item.path}>{item.eval_id || item.path}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1 text-sm">
                      <span className="font-medium">Mode</span>
                      <Input value={launcher.mode} onChange={(event) => setLauncher((prev) => ({ ...prev, mode: event.target.value }))} />
                    </label>
                    <label className="block space-y-1 text-sm">
                      <span className="font-medium">Eval UID</span>
                      <Input placeholder="current user" value={launcher.uid} onChange={(event) => setLauncher((prev) => ({ ...prev, uid: event.target.value }))} />
                    </label>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Prompt version</span>
                    <Input placeholder="legal-negotiation-v4" value={launcher.prompt_version} onChange={(event) => setLauncher((prev) => ({ ...prev, prompt_version: event.target.value }))} />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Workflow version</span>
                    <Input placeholder="legal-workflows-v2" value={launcher.workflow_version} onChange={(event) => setLauncher((prev) => ({ ...prev, workflow_version: event.target.value }))} />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Compare to</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={launcher.compare_to}
                      onChange={(event) => setLauncher((prev) => ({ ...prev, compare_to: event.target.value }))}
                    >
                      <option value="">No baseline</option>
                      {results.map((item) => <option key={item.id} value={item.id}>{item.eval_id} · {fmtDate(item.created_at)}</option>)}
                    </select>
                  </label>
                  <div className="space-y-2 rounded-lg border bg-background p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">Document manifest</div>
                        <div className="text-xs text-muted-foreground">
                          {manifestPaths.length ? `${manifestPaths.length} selected path${manifestPaths.length === 1 ? "" : "s"}` : "Browse files or folders to fill paths; matching uploaded files or bundled eval fixtures will be used."}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
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
                      rows={5}
                      value={launcher.manifest_paths}
                      placeholder={"contracts/nda/example.txt\ncontracts/msa_saas/example.txt"}
                      onChange={(event) => setLauncher((prev) => ({ ...prev, manifest_paths: event.target.value }))}
                    />
                    <div className="space-y-2 text-xs text-muted-foreground">
                      {manifestFolderPaths.length ? <div>Folders inferred for selection: {manifestFolderPaths.slice(0, 3).join(", ")}{manifestFolderPaths.length > 3 ? ` +${manifestFolderPaths.length - 3} more` : ""}</div> : null}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={launcher.apply_selection_to_workflows}
                          onChange={(event) => setLauncher((prev) => ({ ...prev, apply_selection_to_workflows: event.target.checked }))}
                        />
                        <span>Apply this manifest to every workflow in the case</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={launcher.remember_manifest_paths}
                          onChange={(event) => setLauncher((prev) => ({ ...prev, remember_manifest_paths: event.target.checked }))}
                        />
                        <span>Remember these paths in this browser</span>
                      </label>
                      {manifestPaths.length ? (
                        <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setLauncher((prev) => ({ ...prev, manifest_paths: "" }))}>
                          Clear manifest paths
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Notes</span>
                    <Textarea rows={3} value={launcher.notes} onChange={(event) => setLauncher((prev) => ({ ...prev, notes: event.target.value }))} />
                  </label>
                  <Button className="w-full gap-2" onClick={onRunEval} disabled={busy || jobIsActive || !launcher.case_path}>
                    <Play className="h-4 w-4" /> {jobIsActive ? "Eval running" : "Run eval"}
                  </Button>
                </CardContent>
              </Card>

              {job ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between gap-3 text-base">
                      <span>Current eval run</span>
                      {statusBadge(job.status)}
                    </CardTitle>
                    <CardDescription className="break-all">{job.id}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{jobCompletedCount(job)}/{job.total_runs || 0} workflow runs finished</span>
                        <span>{jobProgressPercent(job)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${jobProgressPercent(job)}%` }} />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
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

                    <div className="space-y-1 rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>Runtime {jobRuntime(job)}</span>
                        <span>{job.validation_error_count || 0} validation errors · {job.validation_warning_count || 0} warnings</span>
                      </div>
                      {job.current_label ? (
                        <div className="mt-2 text-sm">
                          <span className="text-muted-foreground">Running now: </span>
                          <span className="font-medium">{job.current_label}</span>
                        </div>
                      ) : null}
                      {job.last_message ? <div className="mt-2 text-xs text-muted-foreground">{job.last_message}</div> : null}
                    </div>

                    {job.export_path ? (
                      <div className="space-y-1">
                        <div className="text-xs font-medium">Export</div>
                        <div className="break-all rounded-md bg-muted p-2 text-xs text-muted-foreground">{job.export_path}</div>
                      </div>
                    ) : null}

                    {job.error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">{job.error}</div> : null}

                    {job.messages?.length ? (
                      <div className="space-y-2">
                        <div className="text-xs font-medium">Run messages</div>
                        <div className="max-h-56 space-y-2 overflow-auto pr-1">
                          {job.messages.slice().reverse().slice(0, 12).map((message, index) => (
                            <div key={`${message.at}-${index}`} className={`rounded-md border p-2 text-xs ${jobMessageClass(message.level)}`}>
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
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Recent jobs</CardTitle>
                    <CardDescription>Use this to reopen a running or recent eval job after refresh.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {jobs.slice(0, 5).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setJob(item)}
                        className={`w-full rounded-lg border p-2 text-left text-xs transition hover:bg-muted ${job?.id === item.id ? "border-primary bg-primary/5" : "bg-background"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{item.id}</span>
                          {statusBadge(item.status)}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {jobCompletedCount(item)}/{item.total_runs || 0} runs · {fmtDate(item.created_at)}
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>Results</span>
                    <Button variant="ghost" size="icon" onClick={() => refreshAll()}><RefreshCcw className="h-4 w-4" /></Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {results.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectResult(item.id)}
                      className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted ${selectedResultId === item.id ? "border-primary bg-primary/5" : "bg-background"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-medium">{item.eval_id}</div>
                        {item.failed_count ? <Badge variant="destructive">{item.failed_count} failed</Badge> : <Badge variant="outline">{item.completed_count}/{item.run_count}</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{fmtDate(item.created_at)}</div>
                      <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
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

        <main className="min-h-0 overflow-hidden">
          {!result ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">Select or run an eval to review results.</div>
          ) : (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <header className="border-b p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-primary" />
                      <h2 className="text-xl font-semibold tracking-tight">{result.eval_id}</h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{result.description || "No description provided."}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>Created {fmtDate(result.created_at)}</span>
                      <span>Mode {result.mode}</span>
                      <span>Commit {result.app_git_commit || "unknown"}</span>
                      <span className="truncate">Case {result.case_fingerprint?.slice(0, 12)}</span>
                      <span>{agentTraceRuns.length} agent traces</span>
                      <span>{sufficientAgentRuns}/{agentTraceRuns.length || 0} sufficient</span>
                      <span>{totalAgentTurns} agent turns</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={evalResultDownloadUrl(selectedResultId)} target="_blank" rel="noreferrer">
                      <Button variant="outline" className="gap-2"><Download className="h-4 w-4" /> JSON</Button>
                    </a>
                    <select className="h-10 rounded-md border bg-background px-3 text-sm" value={compareBaseline} onChange={(event) => setCompareBaseline(event.target.value)}>
                      <option value="">Baseline</option>
                      {results.filter((item) => item.id !== selectedResultId).map((item) => <option key={item.id} value={item.id}>{item.eval_id} · {fmtDate(item.created_at)}</option>)}
                    </select>
                    <Button variant="outline" className="gap-2" onClick={onCompare} disabled={!compareBaseline || busy}><GitCompare className="h-4 w-4" /> Compare</Button>
                    <Button className="gap-2" onClick={onSaveReview} disabled={busy}><Save className="h-4 w-4" /> Save review</Button>
                  </div>
                </div>
              </header>

              <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
                <ScrollArea className="h-full min-h-0 border-r">
                  <div className="space-y-2 p-3">
                    {evalView === "agent" ? (
                      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                        Select an agent trace to inspect retrieval turns, context coverage, and grounding separately from workflow output review.
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
                          className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted ${activeRunKey === key ? "border-primary bg-primary/5" : "bg-background"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate font-medium">{run.label || run.title || run.workflow_id}</div>
                            {evalView === "agent" ? agentContextBadge(agentContext) : statusBadge(run.status)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{run.workflow_id}</div>
                          {evalView === "agent" ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>{agentContext?.retrieval_trace?.length || 0} turns</span>
                              <span>{agentContext?.selected_chunks || 0} chunks</span>
                              <span>{agentContext?.profile || "no profile"}</span>
                            </div>
                          ) : (
                            <div className="mt-2 text-xs">{validationSummary(run)}</div>
                          )}
                        </button>
                      );
                    }) : (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        {evalView === "agent" ? "No agent traces were captured for this eval result." : "No workflow runs were captured for this eval result."}
                      </div>
                    )}
                  </div>
                </ScrollArea>

                <ScrollArea className="h-full min-h-0">
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
    </div>
  );
}


function EvalViewerEmptyState({ view, hasRuns }: { view: EvalView; hasRuns: boolean }) {
  if (view === "agent") {
    return (
      <div className="grid h-full min-h-[420px] place-items-center p-6">
        <Card className="max-w-lg border-dashed text-center">
          <CardHeader>
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
              <Bot className="h-5 w-5 text-muted-foreground" />
            </div>
            <CardTitle>Agent eval viewer</CardTitle>
            <CardDescription>
              {hasRuns
                ? "Select an agent trace from the left to review retrieval turns, context coverage, and grounding."
                : "This eval result does not include agent trace metadata yet."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[420px] place-items-center p-6">
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
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{run.label || run.title || run.workflow_id}</CardTitle>
            {statusBadge(run.status)}
          </div>
          <CardDescription>{run.workflow_id} · {fmtMs(run.duration_ms)} · {run.sources?.length || 0} sources</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div><span className="font-medium">Prompt version:</span> {run.prompt_version || "not set"}</div>
          <div><span className="font-medium">Workflow version:</span> {run.workflow_version || "not set"}</div>
          <div className="truncate"><span className="font-medium">Output:</span> {run.output_fingerprint?.slice(0, 16) || "—"}</div>
          <div className="truncate"><span className="font-medium">Config:</span> {run.config_fingerprint?.slice(0, 16) || "—"}</div>
        </CardContent>
      </Card>

      {run.error ? (
        <Card className="border-destructive/40">
          <CardHeader><CardTitle className="text-base text-destructive">Run error</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-destructive">{run.error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {issues.some((issue) => issue.severity === "error") ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            Validation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!issues.length ? <div className="text-muted-foreground">No validation issues.</div> : issues.map((issue, index) => (
            <div key={`${issue.code}-${index}`} className="rounded-md border p-2">
              <div className="font-medium">{issue.severity.toUpperCase()} · {issue.code}</div>
              <div className="text-muted-foreground">{issue.message}</div>
              {issue.path ? <div className="mt-1 text-xs text-muted-foreground">{issue.path}</div> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rubric review</CardTitle>
          <CardDescription>Score criteria manually after reading the output.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {run.criterion_scores?.length ? run.criterion_scores.map((criterion) => (
            <div key={criterion.criterion_id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{criterion.label}</div>
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
                className="mt-3"
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

      <Card>
        <CardHeader><CardTitle className="text-base">Output</CardTitle></CardHeader>
        <CardContent className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.output_markdown || "_No output._"}</ReactMarkdown>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Sources</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {run.sources?.length ? run.sources.map((source, index) => (
            <div key={`${source.file_id || index}`} className="rounded-md border p-2">
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
  const workflowStrategy = String(asRecord(run.structured_metadata)?.source_strategy || "");
  const totalAddedChunks = trace.reduce((total, step) => total + Number(step.chunks_added || 0), 0);
  const targetedTurns = trace.filter((step) => step.type === "targeted_query").length;
  const neighborTurns = trace.filter((step) => step.type === "neighbor_expansion").length;

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              {run.label || run.title || run.workflow_id}
            </CardTitle>
            {agentContextBadge(context)}
          </div>
          <CardDescription>{run.workflow_id} · {fmtMs(run.duration_ms)} · {trace.length} agent turn{trace.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-4">
          <div className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">Profile</div>
            <div className="mt-1 font-semibold">{context?.profile || "—"}</div>
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
        <Card className="border-amber-500/30">
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-4 w-4" /> Agent turn trace
          </CardTitle>
          <CardDescription>
            {targetedTurns} targeted query turn{targetedTurns === 1 ? "" : "s"} · {neighborTurns} neighbor expansion turn{neighborTurns === 1 ? "" : "s"}
            {workflowStrategy ? ` · ${workflowStrategy}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {trace.length ? trace.map((step, index) => (
            <div key={`${step.step || index}-${step.type || "turn"}`} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  Turn {step.step || index + 1}: {agentTurnLabel(step.type)}
                </div>
                <Badge variant="outline">+{step.chunks_added || 0} chunks</Badge>
              </div>
              {step.query ? <div className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">{step.query}</div> : null}
              {step.reason ? <div className="mt-2 text-xs text-muted-foreground">{step.reason}</div> : null}
              {step.chunk_ids?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {step.chunk_ids.slice(0, 10).map((chunkId) => <Badge key={chunkId} variant="secondary" className="max-w-[180px] truncate">{chunkId}</Badge>)}
                  {step.chunk_ids.length > 10 ? <Badge variant="secondary">+{step.chunk_ids.length - 10} more</Badge> : null}
                </div>
              ) : null}
            </div>
          )) : <div className="text-muted-foreground">No retrieval turns captured for this run.</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Coverage notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {context?.coverage_notes?.length ? context.coverage_notes.map((note, index) => (
            <div key={`${note}-${index}`} className="rounded-md border bg-muted/30 p-2">{note}</div>
          )) : <div className="text-muted-foreground">No coverage notes captured.</div>}
          {context?.missing_context?.length ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-amber-600">Missing or incomplete context</div>
              {context.missing_context.map((note, index) => (
                <div key={`${note}-${index}`} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">{note}</div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent review</CardTitle>
          <CardDescription>Score the retrieval decisions and whether the final output was grounded in the gathered context.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {AGENT_REVIEW_CRITERIA.map((criterion) => (
            <div key={criterion.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{criterion.label}</div>
                  <div className="text-xs text-muted-foreground">{criterion.helper}</div>
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
                className="mt-3"
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

      <Card>
        <CardHeader><CardTitle className="text-base">Eval output</CardTitle></CardHeader>
        <CardContent className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.output_markdown || "_No output._"}</ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );
}
