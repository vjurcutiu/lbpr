import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronRight, CornerDownRight, GitBranch, MoreVertical, Pencil, Search, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listFiles, type FileItem } from "@/features/files/api";
import { useMediaQuery } from "@/features/files/hooks/useMediaQuery";
import { parseErr } from "@/features/files/utils/formatters";
import { cn } from "@/lib/utils";

import {
  branchWorkflowRunVersion,
  createWorkflowRun,
  deleteWorkflowRun,
  downloadWorkflowArtifact,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflows,
  refineWorkflowRun,
  renameWorkflowRun,
  renameWorkflowRunVersion,
  resetWorkflowRunVersionLayout,
  saveWorkflowArtifact,
  saveWorkflowVersionArtifact,
  saveWorkflowVersionEdit,
  saveWorkflowVersionPartialEdit,
  selectWorkflowRunVersion,
  updateWorkflowRunVersionLayout,
} from "./api";
import { LegalWorkflowLauncher } from "./components/LegalWorkflowLauncher";
import { WorkflowLauncher } from "./components/WorkflowLauncher";
import { WorkflowResultDetails, type WorkflowOutputEditState } from "./components/WorkflowResultDetails";
import { WorkflowStatusBadge } from "./components/WorkflowStatusBadge";
import { WorkflowStatusIcon, workflowStatusAccentClass, workflowStatusLabel, type WorkflowVisualStatus } from "./components/WorkflowStatusIcon";
import { buildProPackInputs, getVisibleProPackGroups, PRO_PACK_LIBRARY_VIEW, type ProPackGroup, type ProPackItem } from "./proPacks";
import type {
  WorkflowAiPartialEditRequest,
  WorkflowAiPartialEditResponse,
  WorkflowCapability,
  WorkflowArtifactFormat,
  WorkflowEditSaveMode,
  WorkflowEditSaveOptions,
  WorkflowManifest,
  WorkflowRun,
  WorkflowRunVersion,
  WorkflowSelection,
  WorkflowChainSource,
  WorkflowSuggestedAction,
  WorkflowStatus,
} from "./types";
import { summarizeWorkflowSelection } from "./utils/selection";
import { workflowDocumentMarkdown } from "./utils/workflowMarkdown";


function isCoreWorkflow(workflow: WorkflowManifest) {
  return (workflow.tier || "core") === "core";
}

function isLegalWorkflow(workflow: WorkflowManifest | null | undefined) {
  return !!workflow && (workflow.pack_id === "legal" || workflow.workflow_id.startsWith("legal_"));
}

function availableProPackCount(catalog: WorkflowManifest[], groups: ProPackGroup[]) {
  const workflowIds = new Set(catalog.map((workflow) => workflow.workflow_id));
  return groups.reduce(
    (total, group) => total + group.packs.filter((pack) => workflowIds.has(pack.workflow_id)).length,
    0
  );
}

function compactCopy(text: string, max = 320) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max).trimEnd()}…` : normalized;
}

function workflowTitleForId(catalog: WorkflowManifest[], workflowId?: string, fallback = "Workflow") {
  if (!workflowId) return fallback;
  return catalog.find((item) => item.workflow_id === workflowId)?.title || fallback;
}

function summarizeWorkflowSelectionLabel(selection: WorkflowSelection) {
  const files = selection.file_ids.length;
  const folders = selection.folder_paths.length;
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  return parts.join(" • ") || "the current selection";
}

function workflowQueuedDescription(selection: WorkflowSelection, chained: boolean) {
  const target = summarizeWorkflowSelectionLabel(selection);
  return chained
    ? `Started for ${target}. This follow-up run will stay linked to the original result.`
    : `Started for ${target}. The result will appear in Runs when it is ready.`;
}

function workflowCompletedDescription(run: WorkflowRun) {
  const artifactName = String(run.artifact?.file_name || "").trim();
  return artifactName ? `${artifactName} is ready to review.` : "The output is ready to review.";
}

function versionLabel(version: WorkflowRunVersion) {
  return `V${version.version_number || 1}`;
}

function attachArtifactToVersion(run: WorkflowRun, versionId: string, artifact: WorkflowRun["artifact"]): WorkflowRun {
  if (!artifact) return run;
  const active = run.active_version_id === versionId;
  return {
    ...run,
    artifact: active ? artifact : run.artifact,
    versions: (run.versions || []).map((version) =>
      version.id === versionId ? { ...version, artifact } : version
    ),
  };
}

function cleanLauncherInputs(inputs: Record<string, unknown> | undefined | null) {
  const next = { ...(inputs || {}) };
  delete next.workflow_chain;
  return next;
}

function chainSourceFromRun(run: WorkflowRun | null | undefined, catalog: WorkflowManifest[]): WorkflowChainSource | null {
  const raw = run?.inputs?.workflow_chain;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const parentRunId = String(value.parent_run_id || "").trim();
  const parentWorkflowId = String(value.parent_workflow_id || "").trim();
  if (!parentRunId || !parentWorkflowId) return null;
  const parentWorkflowTitle = String(value.parent_workflow_title || workflowTitleForId(catalog, parentWorkflowId, "Workflow")).trim();
  return {
    parent_run_id: parentRunId,
    parent_workflow_id: parentWorkflowId,
    parent_workflow_title: parentWorkflowTitle || "Workflow",
    parent_title: String(value.parent_title || parentWorkflowTitle || "Previous run").trim(),
    action_label: String(value.action_label || "").trim() || undefined,
    summary: String(value.summary || "").trim() || undefined,
    selection_label: String(value.selection_label || "").trim() || undefined,
    source_file_count: Number(value.source_file_count || 0) || undefined,
    source_folder_count: Number(value.source_folder_count || 0) || undefined,
    parent_updated_at: String(value.parent_updated_at || "").trim() || undefined,
  };
}

function chainSourceForAction(run: WorkflowRun, action: WorkflowSuggestedAction, catalog: WorkflowManifest[]): WorkflowChainSource {
  return {
    parent_run_id: run.id,
    parent_workflow_id: run.workflow_id,
    parent_workflow_title: workflowTitleForId(catalog, run.workflow_id, run.title),
    parent_title: run.title,
    action_label: action.label,
    summary: compactCopy(run.result?.summary || ""),
    selection_label: formatSelection(run),
    source_file_count: run.selection.file_ids.length,
    source_folder_count: run.selection.folder_paths.length,
    parent_updated_at: run.updated_at,
  };
}

type LauncherOptions = {
  selection?: WorkflowSelection;
  initialInputs?: Record<string, unknown>;
  chainSource?: WorkflowChainSource | null;
};

type WorkflowOutputEditDraft = WorkflowOutputEditState & {
  runId: string;
  versionId: string;
  updatedAt: string;
};

const WORKFLOW_OUTPUT_EDIT_DRAFTS_STORAGE_KEY = "lbp.workflow.outputEditDrafts.v1";
const WORKFLOW_OUTPUT_EDIT_DRAFTS_EVENT = "lbp:workflow-output-edit-drafts";

function activeWorkflowVersionId(run: WorkflowRun) {
  return run.active_version_id || run.versions?.[run.versions.length - 1]?.id || "";
}

function workflowOutputEditKey(run: WorkflowRun) {
  const versionId = activeWorkflowVersionId(run);
  return versionId ? `${run.id}:${versionId}` : "";
}

function loadWorkflowOutputEditDrafts(): Record<string, WorkflowOutputEditDraft> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.sessionStorage.getItem(WORKFLOW_OUTPUT_EDIT_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WorkflowOutputEditDraft>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(([, draft]) =>
        !!draft &&
        typeof draft === "object" &&
        typeof draft.runId === "string" &&
        typeof draft.versionId === "string" &&
        typeof draft.draftMarkdown === "string" &&
        typeof draft.baseMarkdown === "string"
      )
    );
  } catch {
    return {};
  }
}

function persistWorkflowOutputEditDrafts(drafts: Record<string, WorkflowOutputEditDraft>) {
  if (typeof window === "undefined") return;

  try {
    if (Object.keys(drafts).length) {
      window.sessionStorage.setItem(WORKFLOW_OUTPUT_EDIT_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
    } else {
      window.sessionStorage.removeItem(WORKFLOW_OUTPUT_EDIT_DRAFTS_STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent(WORKFLOW_OUTPUT_EDIT_DRAFTS_EVENT, { detail: drafts }));
  } catch {
    // Session storage can be unavailable in private or locked-down browsing contexts.
  }
}

function isAbortError(error: unknown) {
  return (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError");
}

function formatCapability(capability: WorkflowCapability) {
  switch (capability) {
    case "summarize":
      return "Summary";
    case "compare":
      return "Comparison";
    case "extract":
      return "Extraction";
    case "draft":
      return "Drafting";
    case "report":
      return "Reporting";
    case "plan":
      return "Action plan";
    default:
      return "Workflow";
  }
}

function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "just now";

  const diffMs = date.getTime() - Date.now();
  const minutes = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  return rtf.format(days, "day");
}

function formatSelection(run: WorkflowRun) {
  const files = run.selection.file_ids.length;
  const folders = run.selection.folder_paths.length;
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  return parts.join(" • ") || "No source selection";
}

function workflowDisplayStatus(run: WorkflowRun, refiningRunId: string | null): WorkflowStatus {
  return refiningRunId === run.id ? "running" : run.status;
}

function workflowVisualStatus(
  status: WorkflowStatus,
  editDraft?: { hasDraft?: boolean; busy?: boolean } | null
): WorkflowVisualStatus {
  if (editDraft?.busy) return "running";
  if (editDraft?.hasDraft) return "editing";
  return status;
}

function renderStatusCopy(run: WorkflowRun, status: WorkflowStatus = run.status) {
  if (status === "completed") {
    return "The output is ready to review.";
  }
  if (status === "failed") {
    return run.error || "This workflow did not complete. Check the message below or try again with a different selection.";
  }
  if (status === "running") {
    return "Processing now. The result will appear here automatically when it finishes.";
  }
  return "Waiting to start. No action is needed.";
}

function sameLocalDay(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function matchesSearch(run: WorkflowRun, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    run.title,
    run.workflow_id,
    run.result?.summary,
    run.error,
    run.selection.current_folder,
    formatCapability(run.capability),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function PaneScroller({
  mobile,
  className,
  children,
}: {
  mobile: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (mobile) return <div className={className}>{children}</div>;
  return <ScrollArea className={cn("h-full", className)}>{children}</ScrollArea>;
}

function RunListItem({
  run,
  active,
  status,
  onSelect,
  onRename,
  onDelete,
  hasEditDraft = false,
  editDraftBusy = false,
}: {
  run: WorkflowRun;
  active: boolean;
  status?: WorkflowStatus;
  hasEditDraft?: boolean;
  editDraftBusy?: boolean;
  onSelect: (runId: string) => void;
  onRename: (run: WorkflowRun) => void;
  onDelete: (run: WorkflowRun) => void;
}) {
  const displayStatus = status || run.status;
  const visualStatus = workflowVisualStatus(displayStatus, { hasDraft: hasEditDraft, busy: editDraftBusy });
  const statusLabel = workflowStatusLabel(visualStatus);

  return (
    <div
      className={cn(
        "group w-full min-w-0 max-w-full overflow-hidden border-l-2 px-3 py-3 text-left transition-colors",
        active ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-muted/30"
      )}
    >
      <div className="flex w-full min-w-0 max-w-full items-start gap-2 overflow-hidden">
        <button
          type="button"
          onClick={() => onSelect(run.id)}
          className="block min-w-0 flex-1 basis-0 overflow-hidden text-left"
          title={run.title || "Untitled workflow"}
        >
          <div className="flex w-full min-w-0 items-start gap-2 overflow-hidden">
            <div
              className={cn(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors",
                workflowStatusAccentClass(visualStatus)
              )}
              aria-label={`Workflow status: ${statusLabel}`}
              title={statusLabel}
            >
              <WorkflowStatusIcon status={visualStatus} className="h-4 w-4" />
            </div>

            <div className="w-0 min-w-0 flex-1 overflow-hidden">
              <div className="min-w-0 overflow-hidden">
                <div className="truncate text-sm font-medium leading-5 text-foreground">{run.title || "Untitled workflow"}</div>
                <div className="mt-0.5 flex w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
                  <span className="min-w-0 flex-1 basis-0 truncate">{formatCapability(run.capability)}</span>
                  <span className="h-1 w-1 shrink-0 rounded-full bg-border" />
                  <span className="shrink-0 truncate">{formatRelativeTime(run.updated_at)}</span>
                </div>
              </div>

              <div className="mt-1.5 flex w-full min-w-0 items-center gap-x-2 gap-y-1 overflow-hidden text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 basis-0 truncate">{formatSelection(run)}</span>
                {run.selection.current_folder ? (
                  <>
                    <span className="h-1 w-1 shrink-0 rounded-full bg-border" />
                    <span className="min-w-0 flex-1 basis-0 truncate">{run.selection.current_folder}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </button>

        <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground opacity-100 transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Workflow actions"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="min-w-[170px] rounded-2xl border-border p-1.5 shadow-[0_20px_50px_rgba(15,23,42,0.16)]">
              <DropdownMenuItem
                className="cursor-pointer rounded-xl px-2.5 py-2"
                onSelect={(event) => {
                  event.preventDefault();
                  onRename(run);
                }}
              >
                <Pencil className="h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 bg-border/70" />
              <DropdownMenuItem
                variant="destructive"
                className="cursor-pointer rounded-xl px-2.5 py-2"
                onSelect={(event) => {
                  event.preventDefault();
                  onDelete(run);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}


function WorkflowCatalogItem({
  workflow,
  active = false,
  onLaunch,
  disabled = false,
}: {
  workflow: WorkflowManifest;
  active?: boolean;
  onLaunch: (workflow: WorkflowManifest) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onLaunch(workflow)}
      disabled={disabled}
      className={cn(
        "flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60",
        active ? "bg-primary/10" : ""
      )}
    >
      <span className="min-w-0">
        <span className={cn("block truncate text-sm font-medium", active ? "text-primary" : "text-foreground")}>{workflow.title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{workflow.description}</span>
      </span>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}


function ProPackAccordion({
  catalog,
  groups,
  activePackId,
  disabled = false,
  onLaunch,
}: {
  catalog: WorkflowManifest[];
  groups: ProPackGroup[];
  activePackId: string | null;
  disabled?: boolean;
  onLaunch: (group: ProPackGroup, pack: ProPackItem, workflow: WorkflowManifest) => void;
}) {
  const workflowById = useMemo(() => new Map(catalog.map((workflow) => [workflow.workflow_id, workflow])), [catalog]);

  const renderPackButton = (group: ProPackGroup, pack: ProPackItem) => {
    const workflow = workflowById.get(pack.workflow_id);
    const isActive = activePackId === pack.id;

    return (
      <button
        key={pack.id}
        type="button"
        disabled={disabled || !workflow}
        onClick={() => workflow && onLaunch(group, pack, workflow)}
        className={cn(
          "flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60",
          isActive ? "bg-primary/10" : ""
        )}
      >
        <span className="min-w-0">
          <span className={cn("block truncate text-sm font-medium", isActive ? "text-primary" : "text-foreground")}>{pack.title}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{pack.description}</span>
        </span>
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    );
  };

  if (!PRO_PACK_LIBRARY_VIEW.showGroupLabels && groups.length === 1) {
    const [group] = groups;
    return (
      <div className="border-t border-border/70 px-3 py-3">
        <div className="space-y-1.5">{group.packs.map((pack) => renderPackButton(group, pack))}</div>
      </div>
    );
  }

  return (
    <Accordion type="multiple" defaultValue={groups.map((group) => group.id)} className="divide-y divide-border/70 border-t border-border/70">
      {groups.map((group) => (
        <AccordionItem key={group.id} value={group.id} className="border-0">
          <AccordionTrigger className="px-3 py-3 text-sm font-medium text-foreground hover:no-underline">
            {group.title}
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <div className="space-y-1.5">{group.packs.map((pack) => renderPackButton(group, pack))}</div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

type MobilePanel = "inbox" | "details" | "flows";
type WorkflowLibraryView = "core" | "pro";

const WORKFLOW_SIDE_PANE_MIN_WIDTH = 240;
const WORKFLOW_SIDE_PANE_MAX_WIDTH = 560;
const WORKFLOW_DETAIL_MIN_WIDTH = 420;
const WORKFLOW_RESIZE_HANDLE_ALLOWANCE = 8;

function clampWorkflowSidePaneWidth(value: number, maxAvailable: number) {
  const maxPane = Math.min(
    WORKFLOW_SIDE_PANE_MAX_WIDTH,
    Math.max(WORKFLOW_SIDE_PANE_MIN_WIDTH, maxAvailable)
  );
  return Math.min(maxPane, Math.max(WORKFLOW_SIDE_PANE_MIN_WIDTH, value));
}

export default function WorkflowsPage() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isCompactDesktop = useMediaQuery("(min-width: 768px) and (max-width: 1279px)");
  const isResizableDesktop = useMediaQuery("(min-width: 1280px)");
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedRunId = searchParams.get("run")?.trim() || null;
  const linkedRunIdRef = useRef<string | null>(linkedRunId);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("inbox");
  const workflowPanelsRef = useRef<HTMLDivElement>(null);
  const [runsPaneWidth, setRunsPaneWidth] = useState(310);
  const [flowsPaneWidth, setFlowsPaneWidth] = useState(300);
  const [resizingPane, setResizingPane] = useState<"runs" | "flows" | null>(null);
  const [catalog, setCatalog] = useState<WorkflowManifest[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [workflowLauncherOpen, setWorkflowLauncherOpen] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowManifest | null>(null);
  const [workflowLibraryView, setWorkflowLibraryView] = useState<WorkflowLibraryView>("core");
  const [activeCoreWorkflowId, setActiveCoreWorkflowId] = useState<string | null>(null);
  const [activeProPackId, setActiveProPackId] = useState<string | null>(null);
  const [launcherFiles, setLauncherFiles] = useState<FileItem[]>([]);
  const [launcherFilesLoading, setLauncherFilesLoading] = useState(false);
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const [artifactBusyRunId, setArtifactBusyRunId] = useState<string | null>(null);
  const [versionBusyId, setVersionBusyId] = useState<string | null>(null);
  const [refiningRunId, setRefiningRunId] = useState<string | null>(null);
  const [branchingRunId, setBranchingRunId] = useState<string | null>(null);
  const [branchingVersion, setBranchingVersion] = useState<WorkflowRunVersion | null>(null);
  const [branchPrompt, setBranchPrompt] = useState("");
  const [branchSaving, setBranchSaving] = useState(false);
  const [renamingRunId, setRenamingRunId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [outputEditDrafts, setOutputEditDrafts] = useState<Record<string, WorkflowOutputEditDraft>>(() => loadWorkflowOutputEditDrafts());
  const outputEditDraftsRef = useRef<Record<string, WorkflowOutputEditDraft>>(outputEditDrafts);
  const aiEditAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const prevRunStatusRef = useRef<Map<string, WorkflowStatus>>(new Map());
  const hasHydratedRunStatusesRef = useRef(false);
  const linkedRunFetchesRef = useRef<Set<string>>(new Set());

  const emptyLauncherSelection = useMemo(
    () => summarizeWorkflowSelection({ file_ids: [], folder_paths: [], current_folder: "" }),
    []
  );
  const [launcherSelection, setLauncherSelection] = useState(emptyLauncherSelection);
  const [launcherInitialInputs, setLauncherInitialInputs] = useState<Record<string, unknown>>({});
  const [launcherChainSource, setLauncherChainSource] = useState<WorkflowChainSource | null>(null);

  const updateOutputEditDrafts = useCallback((
    updater: (current: Record<string, WorkflowOutputEditDraft>) => Record<string, WorkflowOutputEditDraft>
  ) => {
    const next = updater(outputEditDraftsRef.current);
    outputEditDraftsRef.current = next;
    persistWorkflowOutputEditDrafts(next);
    setOutputEditDrafts(next);
  }, []);

  const removeOutputEditDraft = useCallback((key: string) => {
    if (!key) return;
    const controller = aiEditAbortControllersRef.current.get(key);
    controller?.abort(new DOMException("AI edit cancelled", "AbortError"));
    aiEditAbortControllersRef.current.delete(key);
    updateOutputEditDrafts((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [updateOutputEditDrafts]);

  useEffect(() => {
    linkedRunIdRef.current = linkedRunId;
  }, [linkedRunId]);

  useEffect(() => {
    const onDraftStorageChange = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, WorkflowOutputEditDraft>>).detail;
      const next = detail && typeof detail === "object" ? detail : loadWorkflowOutputEditDrafts();
      outputEditDraftsRef.current = next;
      setOutputEditDrafts(next);
    };

    window.addEventListener(WORKFLOW_OUTPUT_EDIT_DRAFTS_EVENT, onDraftStorageChange);
    return () => window.removeEventListener(WORKFLOW_OUTPUT_EDIT_DRAFTS_EVENT, onDraftStorageChange);
  }, []);

  const selectRun = useCallback(
    (runId: string | null) => {
      setSelectedRunId(runId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (runId) next.set("run", runId);
        else next.delete("run");
        return next;
      }, { replace: true });
      if (runId && isMobile) setMobilePanel("details");
    },
    [isMobile, setSearchParams]
  );

  const loadPage = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const [catalogRes, runsRes] = await Promise.all([listWorkflows(), listWorkflowRuns(24)]);
      setCatalog(catalogRes || []);
      setRuns((prev) => {
        const incoming = runsRes.items || [];
        const currentLinkedRunId = linkedRunIdRef.current;
        if (!currentLinkedRunId || incoming.some((run) => run.id === currentLinkedRunId)) return incoming;
        const linkedRun = prev.find((run) => run.id === currentLinkedRunId);
        return linkedRun ? [linkedRun, ...incoming.filter((run) => run.id !== linkedRun.id)].slice(0, 24) : incoming;
      });
    } catch (err) {
      console.error("[workflows] load error", err);
      toast.error("Failed to load workflows", { description: parseErr(err) });
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  const ensureLauncherFilesLoaded = useCallback(async () => {
    if (launcherFiles.length || launcherFilesLoading) return;
    setLauncherFilesLoading(true);
    try {
      const files = await listFiles();
      setLauncherFiles(files || []);
    } catch (err) {
      console.error("[workflows] file picker load error", err);
      toast.error("Failed to load files", { description: parseErr(err) });
    } finally {
      setLauncherFilesLoading(false);
    }
  }, [launcherFiles.length, launcherFilesLoading]);

  const openWorkflowLauncher = useCallback(
    (workflow: WorkflowManifest, options?: LauncherOptions) => {
      setActiveWorkflow(workflow);
      setLauncherSelection(summarizeWorkflowSelection(options?.selection || { file_ids: [], folder_paths: [], current_folder: "" }));
      setLauncherInitialInputs(cleanLauncherInputs(options?.initialInputs));
      setLauncherChainSource(options?.chainSource || null);
      setWorkflowLauncherOpen(true);
      void ensureLauncherFilesLoaded();
    },
    [ensureLauncherFilesLoaded]
  );

  const handleCoreWorkflowLaunch = useCallback(
    (workflow: WorkflowManifest) => {
      setActiveCoreWorkflowId(workflow.workflow_id);
      setActiveProPackId(null);
      openWorkflowLauncher(workflow);
    },
    [openWorkflowLauncher]
  );

  const handleProPackLaunch = useCallback(
    (group: ProPackGroup, pack: ProPackItem, workflow: WorkflowManifest) => {
      setActiveCoreWorkflowId(null);
      setActiveProPackId(pack.id);
      openWorkflowLauncher(workflow, {
        initialInputs: buildProPackInputs(group, pack),
      });
    },
    [openWorkflowLauncher]
  );

  const handleRunWorkflow = useCallback(
    async (workflow: WorkflowManifest, inputs: Record<string, unknown>, selection: WorkflowSelection) => {
      setWorkflowSubmitting(true);
      try {
        const run = await createWorkflowRun({
          workflow_id: workflow.workflow_id,
          selection,
          inputs: {
            ...inputs,
            ...(launcherChainSource ? { workflow_chain: launcherChainSource } : {}),
          },
        });
        setRuns((prev) => [run, ...prev.filter((item) => item.id !== run.id)].slice(0, 24));
        selectRun(run.id);
        setWorkflowLauncherOpen(false);
        setActiveWorkflow(null);
        setLauncherSelection(emptyLauncherSelection);
        setLauncherInitialInputs({});
        setLauncherChainSource(null);
        toast.message(`${workflow.title} queued`, {
          description: workflowQueuedDescription(selection, !!launcherChainSource),
        });
      } catch (err) {
        console.error("[workflows] run error", err);
        toast.error(`Failed to run ${workflow.title}`, { description: parseErr(err) });
      } finally {
        setWorkflowSubmitting(false);
      }
    },
    [emptyLauncherSelection, launcherChainSource, selectRun]
  );

  const handleWorkflowAction = useCallback(
    (action: WorkflowSuggestedAction, selection: WorkflowSelection, sourceRun: WorkflowRun) => {
      const workflow = catalog.find((item) => item.workflow_id === action.workflow_id);
      if (!workflow) {
        toast.error("That follow-up flow is not available right now.");
        return;
      }
      openWorkflowLauncher(workflow, {
        selection,
        initialInputs: {
          ...(action.focus ? { focus: action.focus } : {}),
        },
        chainSource: chainSourceForAction(sourceRun, action, catalog),
      });
    },
    [catalog, openWorkflowLauncher]
  );

  const handleSaveArtifact = useCallback(async (run: WorkflowRun) => {
    if (!run.result || run.status !== "completed") return;
    setArtifactBusyRunId(run.id);
    try {
      const artifact = await saveWorkflowArtifact(run.id);
      setRuns((prev) => prev.map((item) => (
        item.id === run.id && item.active_version_id
          ? attachArtifactToVersion(item, item.active_version_id, artifact)
          : item.id === run.id
            ? { ...item, artifact }
            : item
      )));
      toast.success("Output saved", {
        description: `${artifact.file_name} is saved with this result.`,
      });
      return artifact;
    } catch (err) {
      console.error("[workflows] save artifact error", err);
      toast.error("Failed to save output", { description: parseErr(err) });
      return null;
    } finally {
      setArtifactBusyRunId((current) => (current === run.id ? null : current));
    }
  }, []);

  const handleDownloadArtifact = useCallback(async (run: WorkflowRun, format: WorkflowArtifactFormat = "markdown") => {
    if (!run.result || run.status !== "completed") return;
    setArtifactBusyRunId(run.id);
    try {
      let artifact = run.artifact || null;
      if (!artifact) {
        artifact = await saveWorkflowArtifact(run.id);
        setRuns((prev) => prev.map((item) => (
          item.id === run.id && item.active_version_id
            ? attachArtifactToVersion(item, item.active_version_id, artifact)
            : item.id === run.id
              ? { ...item, artifact }
              : item
        )));
      }
      await downloadWorkflowArtifact(artifact.id, format);
      toast.success("Download started", { description: `${artifact.title} • ${format.toUpperCase()}` });
    } catch (err) {
      console.error("[workflows] download artifact error", err);
      toast.error("Failed to download output", { description: parseErr(err) });
    } finally {
      setArtifactBusyRunId((current) => (current === run.id ? null : current));
    }
  }, []);

  const handleSaveEditedOutput = useCallback(async (run: WorkflowRun, content: string, mode: WorkflowEditSaveMode, options: WorkflowEditSaveOptions = {}) => {
    if (!run.result || run.status !== "completed") return;
    const baseVersionId = run.active_version_id || run.versions?.[run.versions.length - 1]?.id || "";
    if (!baseVersionId) {
      const error = new Error("Could not find a version to edit.");
      toast.error(error.message);
      throw error;
    }

    setArtifactBusyRunId(run.id);
    setVersionBusyId(baseVersionId);
    try {
      const updated = await saveWorkflowVersionEdit(run.id, baseVersionId, content, mode, options);
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      selectRun(updated.id);
      removeOutputEditDraft(`${run.id}:${baseVersionId}`);
      toast.success("Changes saved", {
        description: mode === "overwrite"
          ? "This version was overwritten."
          : "A new version was added to this workflow.",
      });
    } catch (err) {
      console.error("[workflows] save edited output error", err);
      toast.error("Failed to save changes", { description: parseErr(err) });
      throw err;
    } finally {
      setArtifactBusyRunId((current) => (current === run.id ? null : current));
      setVersionBusyId((current) => (current === baseVersionId ? null : current));
    }
  }, [removeOutputEditDraft, selectRun]);

  const handleAiPartialEdit = useCallback(async (run: WorkflowRun, payload: WorkflowAiPartialEditRequest): Promise<WorkflowAiPartialEditResponse> => {
    if (!run.result || run.status !== "completed") {
      throw new Error("Only completed workflow outputs can be edited.");
    }
    const baseVersionId = activeWorkflowVersionId(run);
    if (!baseVersionId) {
      const error = new Error("Could not find a version to edit.");
      toast.error(error.message);
      throw error;
    }

    const key = `${run.id}:${baseVersionId}`;
    const baseMarkdown = workflowDocumentMarkdown(run.result);
    const controller = new AbortController();
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    aiEditAbortControllersRef.current.get(key)?.abort(new DOMException("AI edit replaced", "AbortError"));
    aiEditAbortControllersRef.current.set(key, controller);
    updateOutputEditDrafts((current) => ({
      ...current,
      [key]: {
        runId: run.id,
        versionId: baseVersionId,
        baseMarkdown: current[key]?.baseMarkdown || baseMarkdown,
        draftMarkdown: current[key]?.draftMarkdown || baseMarkdown,
        aiEditDraftPrompt: current[key]?.aiEditDraftPrompt || "",
        aiEditBusy: true,
        aiEditPrompt: payload.prompt,
        aiEditRequestId: requestId,
        updatedAt: new Date().toISOString(),
      },
    }));
    setVersionBusyId(baseVersionId);
    toast.message("Editing selected text", {
      description: "The draft will update when the AI edit is ready.",
    });

    try {
      const preview = await saveWorkflowVersionPartialEdit(run.id, baseVersionId, payload, { signal: controller.signal });
      const latestStoredDraft = loadWorkflowOutputEditDrafts()[key];
      if (
        controller.signal.aborted ||
        aiEditAbortControllersRef.current.get(key) !== controller ||
        latestStoredDraft?.aiEditRequestId !== requestId
      ) {
        return preview;
      }

      updateOutputEditDrafts((current) => ({
        ...current,
        [key]: {
          runId: run.id,
          versionId: baseVersionId,
          baseMarkdown: current[key]?.baseMarkdown || baseMarkdown,
          draftMarkdown: preview.content,
          aiEditDraftPrompt: payload.prompt,
          aiEditBusy: false,
          aiEditPrompt: undefined,
          aiEditRequestId: undefined,
          updatedAt: new Date().toISOString(),
        },
      }));
      toast.success("AI edit ready", { description: "Review the draft, then overwrite or save it as a new version." });
      return preview;
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        updateOutputEditDrafts((current) => {
          const draft = current[key];
          if (!draft) return current;
          return {
            ...current,
            [key]: {
              ...draft,
              aiEditBusy: false,
              aiEditPrompt: undefined,
              aiEditRequestId: undefined,
              updatedAt: new Date().toISOString(),
            },
          };
        });
        throw err;
      }

      updateOutputEditDrafts((current) => {
        const draft = current[key];
        if (!draft) return current;
        return {
          ...current,
          [key]: {
            ...draft,
            aiEditBusy: false,
            aiEditPrompt: undefined,
            aiEditRequestId: undefined,
            updatedAt: new Date().toISOString(),
          },
        };
      });
      console.error("[workflows] ai partial edit error", err);
      toast.error("Failed to edit selected text", { description: parseErr(err) });
      throw err;
    } finally {
      if (aiEditAbortControllersRef.current.get(key) === controller) {
        aiEditAbortControllersRef.current.delete(key);
      }
      setVersionBusyId((current) => (current === baseVersionId ? null : current));
    }
  }, [updateOutputEditDrafts]);

  const handleSelectVersion = useCallback(async (run: WorkflowRun, version: WorkflowRunVersion) => {
    if (run.active_version_id === version.id) return;
    setVersionBusyId(version.id);
    try {
      const updated = await selectWorkflowRunVersion(run.id, version.id);
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      selectRun(updated.id);
      toast.message(`Viewing ${versionLabel(version)}`, {
        description: "You can download it, refine it, or branch from it.",
      });
    } catch (err) {
      console.error("[workflows] select version error", err);
      toast.error("Failed to open version", { description: parseErr(err) });
    } finally {
      setVersionBusyId((current) => (current === version.id ? null : current));
    }
  }, [selectRun]);

  const handleRenameVersion = useCallback(async (run: WorkflowRun, version: WorkflowRunVersion, label: string) => {
    const nextLabel = label.trim();
    if (!nextLabel) {
      toast.error("Add a version name before saving.");
      return;
    }

    setVersionBusyId(version.id);
    try {
      const updated = await renameWorkflowRunVersion(run.id, version.id, nextLabel);
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      selectRun(updated.id);
      toast.success("Version renamed", { description: nextLabel });
    } catch (err) {
      console.error("[workflows] rename version error", err);
      toast.error("Failed to rename version", { description: parseErr(err) });
      throw err;
    } finally {
      setVersionBusyId((current) => (current === version.id ? null : current));
    }
  }, [selectRun]);

  const handleMoveVersion = useCallback(async (run: WorkflowRun, version: WorkflowRunVersion, position: { x: number; y: number }) => {
    try {
      const updated = await updateWorkflowRunVersionLayout(run.id, version.id, position);
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      selectRun(updated.id);
    } catch (err) {
      console.error("[workflows] move version node error", err);
      toast.error("Failed to save map position", { description: parseErr(err) });
      throw err;
    }
  }, [selectRun]);

  const handleResetVersionLayout = useCallback(async (run: WorkflowRun) => {
    try {
      const updated = await resetWorkflowRunVersionLayout(run.id);
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      selectRun(updated.id);
      toast.success("Version map reset");
    } catch (err) {
      console.error("[workflows] reset version map error", err);
      toast.error("Failed to reset version map", { description: parseErr(err) });
      throw err;
    }
  }, [selectRun]);

  const handleDownloadVersion = useCallback(async (run: WorkflowRun, version: WorkflowRunVersion, format: WorkflowArtifactFormat = "markdown") => {
    setVersionBusyId(version.id);
    try {
      let artifact = version.artifact || null;
      if (!artifact) {
        artifact = await saveWorkflowVersionArtifact(run.id, version.id);
        const savedArtifact = artifact;
        setRuns((prev) => prev.map((item) => (item.id === run.id ? attachArtifactToVersion(item, version.id, savedArtifact) : item)));
      }
      await downloadWorkflowArtifact(artifact.id, format);
      toast.success("Download started", { description: `${versionLabel(version)} • ${format.toUpperCase()}` });
    } catch (err) {
      console.error("[workflows] download version error", err);
      toast.error("Failed to download version", { description: parseErr(err) });
    } finally {
      setVersionBusyId((current) => (current === version.id ? null : current));
    }
  }, []);

  const beginOutputEdit = useCallback((run: WorkflowRun, baseMarkdown: string) => {
    const versionId = activeWorkflowVersionId(run);
    const key = versionId ? `${run.id}:${versionId}` : "";
    if (!key) {
      toast.error("Could not find a version to edit.");
      return;
    }

    updateOutputEditDrafts((current) => {
      if (current[key]) return current;
      return {
        ...current,
        [key]: {
          runId: run.id,
          versionId,
          baseMarkdown,
          draftMarkdown: baseMarkdown,
          aiEditDraftPrompt: "",
          aiEditBusy: false,
          aiEditPrompt: undefined,
          aiEditRequestId: undefined,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, [updateOutputEditDrafts]);

  const updateOutputEditDraft = useCallback((run: WorkflowRun, content: string) => {
    const versionId = activeWorkflowVersionId(run);
    const key = versionId ? `${run.id}:${versionId}` : "";
    const result = run.result;
    if (!key || !result) return;

    updateOutputEditDrafts((current) => {
      const existing = current[key];
      const baseMarkdown = existing?.baseMarkdown || workflowDocumentMarkdown(result);
      return {
        ...current,
        [key]: {
          runId: run.id,
          versionId,
          baseMarkdown,
          draftMarkdown: content,
          aiEditDraftPrompt: existing?.aiEditDraftPrompt || "",
          aiEditBusy: existing?.aiEditBusy || false,
          aiEditPrompt: existing?.aiEditPrompt,
          aiEditRequestId: existing?.aiEditRequestId,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, [updateOutputEditDrafts]);

  const cancelOutputEdit = useCallback((run: WorkflowRun) => {
    const key = workflowOutputEditKey(run);
    removeOutputEditDraft(key);
  }, [removeOutputEditDraft]);

  const cancelAiEdit = useCallback((run: WorkflowRun) => {
    const key = workflowOutputEditKey(run);
    if (!key) return;
    aiEditAbortControllersRef.current.get(key)?.abort(new DOMException("AI edit cancelled", "AbortError"));
    aiEditAbortControllersRef.current.delete(key);
    updateOutputEditDrafts((current) => {
      const draft = current[key];
      if (!draft) return current;
      return {
        ...current,
        [key]: {
          ...draft,
          aiEditBusy: false,
          aiEditPrompt: undefined,
          aiEditRequestId: undefined,
          updatedAt: new Date().toISOString(),
        },
      };
    });
    toast.message("AI edit cancelled");
  }, [updateOutputEditDrafts]);

  const openBranchDialog = useCallback((run: WorkflowRun, version: WorkflowRunVersion) => {
    setBranchingRunId(run.id);
    setBranchingVersion(version);
    setBranchPrompt("");
  }, []);

  const closeBranchDialog = useCallback(() => {
    if (branchSaving) return;
    setBranchingRunId(null);
    setBranchingVersion(null);
    setBranchPrompt("");
  }, [branchSaving]);

  const submitBranchVersion = useCallback(async () => {
    const prompt = branchPrompt.trim();
    if (!branchingRunId || !branchingVersion || !prompt) {
      toast.error("Add a prompt before branching.");
      return;
    }

    setBranchSaving(true);
    setVersionBusyId(branchingVersion.id);
    try {
      const updated = await branchWorkflowRunVersion(branchingRunId, branchingVersion.id, prompt);
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      selectRun(updated.id);
      setBranchingRunId(null);
      setBranchingVersion(null);
      setBranchPrompt("");
      toast.success("Branch created", {
        description: "The new version is ready to review.",
      });
    } catch (err) {
      console.error("[workflows] branch version error", err);
      toast.error("Failed to create branch", { description: parseErr(err) });
    } finally {
      setBranchSaving(false);
      setVersionBusyId((current) => (current === branchingVersion?.id ? null : current));
    }
  }, [branchPrompt, branchingRunId, branchingVersion, selectRun]);

  const handleRefineRun = useCallback(async (run: WorkflowRun, prompt: string) => {
    if (!run.result || run.status !== "completed") return;
    setRefiningRunId(run.id);
    toast.message("Refining workflow", {
      description: "The output is updating now. This run will stay active until the revised version is ready.",
    });
    try {
      const refined = await refineWorkflowRun(run.id, prompt);
      setRuns((prev) => prev.map((item) => (item.id === refined.id ? refined : item)));
      selectRun(refined.id);
      toast.success("Output refined", { description: "The revised version is ready to review." });
    } catch (err) {
      console.error("[workflows] refine error", err);
      toast.error("Failed to refine output", { description: parseErr(err) });
    } finally {
      setRefiningRunId((current) => (current === run.id ? null : current));
    }
  }, [selectRun]);

  useEffect(() => {
    const nextMap = new Map<string, WorkflowStatus>();
    for (const run of runs) nextMap.set(run.id, run.status);

    if (!hasHydratedRunStatusesRef.current) {
      prevRunStatusRef.current = nextMap;
      hasHydratedRunStatusesRef.current = true;
      return;
    }

    const prev = prevRunStatusRef.current;
    const completed = runs.filter((run) => {
      const before = prev.get(run.id);
      return (before === "queued" || before === "running") && run.status === "completed";
    });
    const failed = runs.filter((run) => {
      const before = prev.get(run.id);
      return (before === "queued" || before === "running") && run.status === "failed";
    });

    prevRunStatusRef.current = nextMap;

    if (completed.length === 1) {
      toast.success(`${completed[0].title} finished`, {
        description: workflowCompletedDescription(completed[0]),
      });
    } else if (completed.length > 1) {
      toast.success(`${completed.length} workflows finished`, {
        description: "Open Runs to review the outputs.",
      });
    }

    if (failed.length === 1) {
      toast.error(`${failed[0].title} failed`, {
        description: failed[0].error?.trim() || "Open Runs to review the error.",
      });
    } else if (failed.length > 1) {
      toast.error(`${failed.length} workflows failed`, {
        description: "Open Runs to review the errors.",
      });
    }
  }, [runs]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    const id = window.setInterval(() => {
      loadPage({ silent: true });
    }, 15000);
    return () => window.clearInterval(id);
  }, [loadPage]);

  useEffect(() => {
    if (!isMobile) setMobilePanel("inbox");
  }, [isMobile]);

  useEffect(() => {
    if (!isResizableDesktop) setResizingPane(null);
  }, [isResizableDesktop]);

  useEffect(() => {
    if (!isResizableDesktop) return;

    const panels = workflowPanelsRef.current;
    if (!panels || typeof ResizeObserver === "undefined") return;

    const clampCurrentWidths = () => {
      const rect = panels.getBoundingClientRect();
      const availableForSidePanes = rect.width - WORKFLOW_DETAIL_MIN_WIDTH - WORKFLOW_RESIZE_HANDLE_ALLOWANCE;
      const sidePaneBudget = Math.max(WORKFLOW_SIDE_PANE_MIN_WIDTH * 2, availableForSidePanes);

      setRunsPaneWidth((currentRunsWidth) => {
        const maxAvailable = sidePaneBudget - flowsPaneWidth;
        return clampWorkflowSidePaneWidth(currentRunsWidth, maxAvailable);
      });
      setFlowsPaneWidth((currentFlowsWidth) => {
        const maxAvailable = sidePaneBudget - runsPaneWidth;
        return clampWorkflowSidePaneWidth(currentFlowsWidth, maxAvailable);
      });
    };

    clampCurrentWidths();
    const observer = new ResizeObserver(clampCurrentWidths);
    observer.observe(panels);
    return () => observer.disconnect();
  }, [flowsPaneWidth, isResizableDesktop, runsPaneWidth]);

  useEffect(() => {
    if (!isResizableDesktop || !resizingPane) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (event: MouseEvent) => {
      const rect = workflowPanelsRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (resizingPane === "runs") {
        const maxAvailable = rect.width - flowsPaneWidth - WORKFLOW_DETAIL_MIN_WIDTH - WORKFLOW_RESIZE_HANDLE_ALLOWANCE;
        setRunsPaneWidth(clampWorkflowSidePaneWidth(event.clientX - rect.left, maxAvailable));
        return;
      }

      const maxAvailable = rect.width - runsPaneWidth - WORKFLOW_DETAIL_MIN_WIDTH - WORKFLOW_RESIZE_HANDLE_ALLOWANCE;
      setFlowsPaneWidth(clampWorkflowSidePaneWidth(rect.right - event.clientX, maxAvailable));
    };

    const onUp = () => setResizingPane(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [flowsPaneWidth, isResizableDesktop, resizingPane, runsPaneWidth]);

  const stats = useMemo(() => {
    const completed = runs.filter((run) => workflowDisplayStatus(run, refiningRunId) === "completed");
    const failed = runs.filter((run) => workflowDisplayStatus(run, refiningRunId) === "failed");
    const inFlight = runs.filter((run) => {
      const status = workflowDisplayStatus(run, refiningRunId);
      return status === "queued" || status === "running";
    });
    const completedToday = completed.filter((run) => sameLocalDay(run.updated_at)).length;
    const terminalCount = completed.length + failed.length;
    const successRate = terminalCount ? Math.round((completed.length / terminalCount) * 100) : 0;

    return {
      completed: completed.length,
      failed: failed.length,
      inFlight: inFlight.length,
      completedToday,
      successRate,
    };
  }, [refiningRunId, runs]);



  const visibleRuns = useMemo(() => {
    return runs.filter((run) => matchesSearch(run, search));
  }, [runs, search]);

  const coreCatalog = useMemo(() => catalog.filter(isCoreWorkflow), [catalog]);
  const visibleProPackGroups = useMemo(() => getVisibleProPackGroups(), []);
  const proPackCount = useMemo(() => availableProPackCount(catalog, visibleProPackGroups), [catalog, visibleProPackGroups]);
  const launcherIsLegal = isLegalWorkflow(activeWorkflow);

  useEffect(() => {
    if (!linkedRunId || runs.some((run) => run.id === linkedRunId)) return;
    if (linkedRunFetchesRef.current.has(linkedRunId)) return;

    let cancelled = false;
    linkedRunFetchesRef.current.add(linkedRunId);
    void getWorkflowRun(linkedRunId)
      .then((run) => {
        if (cancelled) return;
        setRuns((prev) => [run, ...prev.filter((item) => item.id !== run.id)].slice(0, 24));
        setSelectedRunId(run.id);
        if (isMobile) setMobilePanel("details");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[workflows] linked run load error", err);
        toast.error("Could not open that workflow", { description: parseErr(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [isMobile, linkedRunId, runs]);

  useEffect(() => {
    if (linkedRunId && runs.some((run) => run.id === linkedRunId)) {
      if (selectedRunId !== linkedRunId) {
        setSelectedRunId(linkedRunId);
        if (isMobile) setMobilePanel("details");
      }
      return;
    }

    if (!visibleRuns.length) {
      setSelectedRunId(null);
      return;
    }

    if (!selectedRunId || !visibleRuns.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(visibleRuns[0]?.id ?? null);
    }
  }, [isMobile, linkedRunId, runs, selectedRunId, visibleRuns]);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) || null, [runs, selectedRunId]);
  const selectedRunDisplayStatus = selectedRun ? workflowDisplayStatus(selectedRun, refiningRunId) : null;
  const renamingRun = useMemo(() => runs.find((run) => run.id === renamingRunId) || null, [renamingRunId, runs]);
  const deletingRun = useMemo(() => runs.find((run) => run.id === deletingRunId) || null, [deletingRunId, runs]);
  const selectedRunChainSource = useMemo(() => chainSourceFromRun(selectedRun, catalog), [catalog, selectedRun]);
  const selectedRunEditKey = selectedRun ? workflowOutputEditKey(selectedRun) : "";
  const selectedRunEditDraft = selectedRunEditKey ? outputEditDrafts[selectedRunEditKey] || null : null;
  const draftRunState = useMemo(() => {
    const byRun = new Map<string, { hasDraft: boolean; busy: boolean }>();
    for (const draft of Object.values(outputEditDrafts)) {
      const current = byRun.get(draft.runId);
      byRun.set(draft.runId, {
        hasDraft: true,
        busy: !!draft.aiEditBusy || !!current?.busy,
      });
    }
    return byRun;
  }, [outputEditDrafts]);
  const selectedRunVisualStatus = selectedRun && selectedRunDisplayStatus
    ? workflowVisualStatus(selectedRunDisplayStatus, {
      hasDraft: !!selectedRunEditDraft,
      busy: !!selectedRunEditDraft?.aiEditBusy,
    })
    : null;
  const handleSelectRun = useCallback((runId: string) => {
    selectRun(runId);
  }, [selectRun]);

  const startRenamingRun = useCallback((run: WorkflowRun) => {
    setRenamingRunId(run.id);
    setRenameTitle(run.title || "");
  }, []);

  const cancelRenamingRun = useCallback(() => {
    if (renameSaving) return;
    setRenamingRunId(null);
    setRenameTitle("");
  }, [renameSaving]);

  const submitRunRename = useCallback(async (run: WorkflowRun) => {
    const title = renameTitle.replace(/\s+/g, " ").trim();
    if (!title) {
      toast.error("Add a title before saving.");
      return;
    }
    if (title === run.title) {
      setRenamingRunId(null);
      setRenameTitle("");
      return;
    }

    setRenameSaving(true);
    try {
      const updated = await renameWorkflowRun(run.id, title);
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setRenamingRunId(null);
      setRenameTitle("");
      toast.success("Workflow renamed");
    } catch (err) {
      console.error("[workflows] rename error", err);
      toast.error("Failed to rename workflow", { description: parseErr(err) });
    } finally {
      setRenameSaving(false);
    }
  }, [renameTitle]);

  const startDeletingRun = useCallback((run: WorkflowRun) => {
    setDeletingRunId(run.id);
  }, []);

  const cancelDeletingRun = useCallback(() => {
    if (deleteSaving) return;
    setDeletingRunId(null);
  }, [deleteSaving]);

  const submitRunDelete = useCallback(async () => {
    if (!deletingRun) return;

    setDeleteSaving(true);
    try {
      await deleteWorkflowRun(deletingRun.id);
      for (const [key, controller] of aiEditAbortControllersRef.current.entries()) {
        if (key.startsWith(`${deletingRun.id}:`)) {
          controller.abort(new DOMException("AI edit cancelled", "AbortError"));
          aiEditAbortControllersRef.current.delete(key);
        }
      }
      updateOutputEditDrafts((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([, draft]) => draft.runId !== deletingRun.id));
        return next as Record<string, WorkflowOutputEditDraft>;
      });
      setRuns((prev) => prev.filter((item) => item.id !== deletingRun.id));
      if (selectedRunId === deletingRun.id) {
        selectRun(null);
      }
      if (renamingRunId === deletingRun.id) {
        setRenamingRunId(null);
        setRenameTitle("");
      }
      setDeletingRunId(null);
      toast.success("Workflow deleted");
    } catch (err) {
      console.error("[workflows] delete error", err);
      toast.error("Failed to delete workflow", { description: parseErr(err) });
    } finally {
      setDeleteSaving(false);
    }
  }, [deletingRun, renamingRunId, selectedRunId, selectRun, updateOutputEditDrafts]);


  const showInbox = !isMobile || mobilePanel === "inbox";
  const showDetails = !isMobile || mobilePanel === "details";
  const showFlows = !isMobile || mobilePanel === "flows";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {isMobile ? (
        <div className="sticky top-0 z-20 shrink-0 border border-border/70 border-b-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="border-b border-border/70 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">Workflows</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {stats.inFlight ? `${stats.inFlight} active run${stats.inFlight === 1 ? "" : "s"}` : "Run document workflows and review finished outputs."}
                </div>
              </div>
            </div>
          </div>
          <div className="px-4 py-3">
            <Tabs value={mobilePanel} onValueChange={(value) => setMobilePanel(value as MobilePanel)}>
              <TabsList className="grid h-auto w-full grid-cols-3 rounded-full bg-muted/40 p-1">
                <TabsTrigger value="inbox" className="h-8 rounded-full px-2 text-xs">Runs {runs.length}</TabsTrigger>
                <TabsTrigger value="details" className="h-8 rounded-full px-2 text-xs">Details</TabsTrigger>
                <TabsTrigger value="flows" className="h-8 rounded-full px-2 text-xs">Workflows {coreCatalog.length + proPackCount}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      ) : null}

      <div className={cn("min-h-0 flex-1", isMobile ? "overflow-y-auto overscroll-contain" : "overflow-hidden")}>
        <div
          ref={workflowPanelsRef}
          className={cn(
            "border border-border/70 bg-background shadow-sm",
            isMobile
              ? "border-t-0"
              : isCompactDesktop
                ? "grid h-full min-h-0 grid-cols-[minmax(260px,32vw)_minmax(0,1fr)] grid-rows-[minmax(180px,42%)_minmax(180px,58%)] overflow-hidden"
                : "flex h-full min-h-0 flex-row overflow-hidden"
          )}
        >
        <section
          className={cn(
            "flex min-h-[220px] min-w-0 flex-col overflow-hidden border-border/70",
            isMobile && "border-b",
            isCompactDesktop && "min-h-0 border-r border-b [grid-column:1] [grid-row:1]",
            !isMobile && !isCompactDesktop && "min-h-0",
            !showInbox && "hidden"
          )}
          style={isResizableDesktop ? { flex: `0 0 ${runsPaneWidth}px`, width: runsPaneWidth } : undefined}
        >
          <div className="shrink-0 border-b border-border/70 px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search runs"
                className="h-8 rounded-full border-border/80 bg-background pl-8 text-sm shadow-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {loading ? (
              <div className="p-3 text-sm text-muted-foreground">Loading workflow runs…</div>
            ) : visibleRuns.length ? (
              <PaneScroller mobile={isMobile} className={isMobile ? undefined : "h-full w-full min-w-0 max-w-full overflow-hidden"}>
                <div className="w-full min-w-0 max-w-full overflow-hidden divide-y divide-border/70">
                  {visibleRuns.map((run) => (
                    <RunListItem
                      key={run.id}
                      run={run}
                      active={run.id === selectedRunId}
                      status={workflowDisplayStatus(run, refiningRunId)}
                      hasEditDraft={!!draftRunState.get(run.id)?.hasDraft}
                      editDraftBusy={!!draftRunState.get(run.id)?.busy}
                      onSelect={handleSelectRun}
                      onRename={startRenamingRun}
                      onDelete={startDeletingRun}
                    />
                  ))}
                </div>
              </PaneScroller>
            ) : (
              <div className="p-3 text-sm leading-5 text-muted-foreground">
                {search.trim() ? "No workflow runs match this search yet." : "No workflow runs yet. Start one from the workflow list."}
              </div>
            )}
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize workflow runs panel"
          onMouseDown={(event) => {
            event.preventDefault();
            setResizingPane("runs");
          }}
          className={cn(
            "hidden w-1 shrink-0 cursor-col-resize bg-border/70 transition-colors hover:bg-primary/20 xl:block",
            resizingPane === "runs" && "bg-primary/30"
          )}
          title="Drag to resize"
        />

        <section
          className={cn(
            "flex min-h-[320px] min-w-0 flex-col border-border/70",
            isMobile && "border-b",
            isCompactDesktop && "min-h-0 [grid-column:2] [grid-row:1_/_span_2]",
            !isMobile && !isCompactDesktop && "min-h-0",
            !showDetails && "hidden"
          )}
          style={isResizableDesktop ? { flex: "1 1 0", minWidth: 0 } : undefined}
        >

          {selectedRun ? (
            <div className={cn("min-h-0 flex-1 bg-muted/15", !isMobile && "overflow-hidden")}>
              <PaneScroller mobile={isMobile} className={isMobile ? undefined : "h-full"}>
                <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5 px-3 py-4 sm:px-4 md:px-6 lg:px-8 xl:px-12">
                  <div className="min-w-0 rounded-2xl border border-border/70 bg-background px-4 py-5 shadow-sm sm:px-5 md:px-6 md:py-7 xl:px-8">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <div className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background", workflowStatusAccentClass(selectedRunVisualStatus || selectedRunDisplayStatus || selectedRun.status))}>
                            <WorkflowStatusIcon status={selectedRunVisualStatus || selectedRunDisplayStatus || selectedRun.status} className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            {selectedRunChainSource ? (
                              <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">
                                  <CornerDownRight className="mr-1 h-3 w-3" />
                                  Follow-up
                                </Badge>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-left transition-colors hover:text-foreground"
                                  onClick={() => {
                                    if (runs.some((item) => item.id === selectedRunChainSource.parent_run_id)) {
                                      selectRun(selectedRunChainSource.parent_run_id);
                                    }
                                  }}
                                  disabled={!runs.some((item) => item.id === selectedRunChainSource.parent_run_id)}
                                >
                                  <span>{selectedRunChainSource.parent_workflow_title}</span>
                                  <ChevronRight className="h-3 w-3" />
                                  <span>{selectedRun.title}</span>
                                </button>
                              </div>
                            ) : null}
                            <div className="flex max-w-3xl min-w-0 items-start gap-2">
                              <div className="min-w-0 flex-1 break-words text-lg font-semibold leading-7 text-foreground md:text-[1.35rem]">{selectedRun.title}</div>
                              <button
                                type="button"
                                className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition-colors hover:text-foreground"
                                onClick={() => startRenamingRun(selectedRun)}
                                aria-label="Rename workflow"
                                title="Rename"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground [&>span]:min-w-0 [&>span]:break-words">
                              <WorkflowStatusBadge status={selectedRunDisplayStatus || selectedRun.status} className="px-1.5 py-0 text-[10px]" />
                              {selectedRun.artifact ? (
                                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">
                                  Output saved
                                </Badge>
                              ) : null}
                              <span>{formatCapability(selectedRun.capability)}</span>
                              <span className="h-1 w-1 rounded-full bg-border" />
                              <span>{formatSelection(selectedRun)}</span>
                              {selectedRun.selection.current_folder ? (
                                <>
                                  <span className="h-1 w-1 rounded-full bg-border" />
                                  <span>{selectedRun.selection.current_folder}</span>
                                </>
                              ) : null}
                            </div>
                            <p className="mt-4 max-w-3xl text-[15px] leading-7 text-foreground/90">{renderStatusCopy(selectedRun, selectedRunDisplayStatus || selectedRun.status)}</p>
                            {selectedRunChainSource ? (
                              <div className="mt-4 max-w-3xl border border-border/70 bg-muted/15 px-3 py-3">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">Built from previous result</div>
                                <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                  <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">{selectedRunChainSource.parent_title}</Badge>
                                  {selectedRunChainSource.selection_label ? <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">{selectedRunChainSource.selection_label}</Badge> : null}
                                  {selectedRunChainSource.action_label ? <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">{selectedRunChainSource.action_label}</Badge> : null}
                                </div>
                                {selectedRunChainSource.summary ? (
                                  <p className="mt-2 text-sm leading-6 text-foreground/85">{selectedRunChainSource.summary}</p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

                  <div className="min-w-0 rounded-2xl border border-border/70 bg-background px-4 py-5 shadow-sm sm:px-5 md:px-6 md:py-7 xl:px-8">
                    {selectedRun.result ? (
                      <WorkflowResultDetails
                        result={selectedRun.result}
                        selection={selectedRun.selection}
                        sourceRun={selectedRun}
                        artifact={selectedRun.artifact || null}
                        artifactBusy={artifactBusyRunId === selectedRun.id}
                        refineBusy={refiningRunId === selectedRun.id || branchSaving}
                        aiEditBusy={!!selectedRunEditDraft?.aiEditBusy}
                        editState={selectedRunEditDraft}
                        versions={selectedRun.versions || []}
                        activeVersionId={selectedRun.active_version_id || null}
                        versionBusyId={versionBusyId}
                        onSaveArtifact={() => { void handleSaveArtifact(selectedRun); }}
                        onBeginOutputEdit={(baseMarkdown) => beginOutputEdit(selectedRun, baseMarkdown)}
                        onDraftOutputChange={(content) => updateOutputEditDraft(selectedRun, content)}
                        onCancelOutputEdit={() => cancelOutputEdit(selectedRun)}
                        onCancelAiEdit={() => cancelAiEdit(selectedRun)}
                        onSaveEditedOutput={(content, mode, options) => handleSaveEditedOutput(selectedRun, content, mode, options)}
                        onAiEditSelectedOutput={(payload) => handleAiPartialEdit(selectedRun, payload)}
                        onDownloadArtifact={(format) => { void handleDownloadArtifact(selectedRun, format); }}
                        onSelectVersion={(version) => { void handleSelectVersion(selectedRun, version); }}
                        onRenameVersion={(version, label) => handleRenameVersion(selectedRun, version, label)}
                        onMoveVersion={(version, position) => handleMoveVersion(selectedRun, version, position)}
                        onResetVersionLayout={() => handleResetVersionLayout(selectedRun)}
                        onDownloadVersion={(version, format) => { void handleDownloadVersion(selectedRun, version, format); }}
                        onBranchVersion={(version) => openBranchDialog(selectedRun, version)}
                        onRefine={(prompt) => { void handleRefineRun(selectedRun, prompt); }}
                        onWorkflowAction={handleWorkflowAction}
                      />
                    ) : selectedRun.status === "failed" ? (
                      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-4 text-[15px] leading-7 text-destructive">
                        {selectedRun.error || "This workflow failed before returning an output."}
                      </div>
                    ) : (
                      <div className="text-[15px] leading-7 text-muted-foreground">
                        This workflow is still processing. Refresh to check for the latest result.
                      </div>
                    )}
                  </div>
                </div>
              </PaneScroller>
            </div>
          ) : (
            <div className="p-5 text-sm leading-6 text-muted-foreground md:px-8 md:py-6">
              {isMobile
                ? "Choose a run to review it, or open the Workflows tab to start a new one."
                : "Start a workflow from the right panel, or choose a run to review its result."}
            </div>
          )}
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize workflow list panel"
          onMouseDown={(event) => {
            event.preventDefault();
            setResizingPane("flows");
          }}
          className={cn(
            "hidden w-1 shrink-0 cursor-col-resize bg-border/70 transition-colors hover:bg-primary/20 xl:block",
            resizingPane === "flows" && "bg-primary/30"
          )}
          title="Drag to resize"
        />

        <section
          className={cn(
            "flex min-h-[220px] min-w-0 flex-col",
            isCompactDesktop && "min-h-0 border-r border-border/70 [grid-column:1] [grid-row:2]",
            !isMobile && !isCompactDesktop && "min-h-0",
            !showFlows && "hidden"
          )}
          style={isResizableDesktop ? { flex: `0 0 ${flowsPaneWidth}px`, width: flowsPaneWidth } : undefined}
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            {catalog.length ? (
              <PaneScroller mobile={isMobile} className={isMobile ? undefined : "h-full"}>
                <div className="min-w-0">
                  <div className="border-b border-border/70 px-3 py-3">
                    <Tabs value={workflowLibraryView} onValueChange={(value) => setWorkflowLibraryView(value as WorkflowLibraryView)}>
                      <TabsList className="grid h-auto w-full grid-cols-2 rounded-full bg-muted/40 p-1">
                        <TabsTrigger value="core" className="h-8 rounded-full px-2 text-xs">Core</TabsTrigger>
                        <TabsTrigger value="pro" className="h-8 rounded-full px-2 text-xs">Pro</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {workflowLibraryView === "core" ? (
                    <div className="border-t border-border/70 px-3 py-3">
                      <div className="space-y-1.5">
                        {coreCatalog.map((workflow) => (
                          <WorkflowCatalogItem
                            key={workflow.workflow_id}
                            workflow={workflow}
                            active={activeCoreWorkflowId === workflow.workflow_id}
                            onLaunch={handleCoreWorkflowLaunch}
                            disabled={workflowSubmitting}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <ProPackAccordion
                      catalog={catalog}
                      groups={visibleProPackGroups}
                      activePackId={activeProPackId}
                      disabled={workflowSubmitting}
                      onLaunch={handleProPackLaunch}
                    />
                  )}
                </div>
              </PaneScroller>
            ) : (
              <div className="p-3 text-sm leading-5 text-muted-foreground">
                Workflows will appear here once the catalog loads.
              </div>
            )}
          </div>
        </section>
        </div>
      </div>

      <Dialog open={!!renamingRunId} onOpenChange={(open) => {
        if (!open) cancelRenamingRun();
      }}>
        <DialogContent className="max-w-md rounded-3xl border-border p-0 shadow-[0_32px_80px_rgba(15,23,42,0.18)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (renamingRun) void submitRunRename(renamingRun);
            }}
          >
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="text-base font-semibold">Rename workflow</DialogTitle>
              <DialogDescription>Give this run a clearer name so it is easier to find later.</DialogDescription>
            </DialogHeader>
            <div className="px-6 py-2">
              <Input
                autoFocus
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelRenamingRun();
                }}
                className="h-10 rounded-2xl"
                maxLength={120}
                disabled={renameSaving}
                placeholder="Workflow title"
              />
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button type="button" variant="outline" onClick={cancelRenamingRun} disabled={renameSaving}>Cancel</Button>
              <Button type="submit" disabled={renameSaving || !renameTitle.trim()}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingRunId} onOpenChange={(open) => {
        if (!open) cancelDeletingRun();
      }}>
        <DialogContent className="max-w-md rounded-3xl border-border p-0 shadow-[0_32px_80px_rgba(15,23,42,0.18)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitRunDelete();
            }}
          >
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="text-base font-semibold">Delete workflow</DialogTitle>
              <DialogDescription>This removes the selected workflow run from your history.</DialogDescription>
            </DialogHeader>
            <div className="px-6 py-2 text-sm leading-6 text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">“{deletingRun?.title || "Untitled workflow"}”</span>
              ? This action cannot be undone.
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button type="button" variant="outline" onClick={cancelDeletingRun} disabled={deleteSaving}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={deleteSaving}>Delete</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!branchingVersion} onOpenChange={(open) => {
        if (!open) closeBranchDialog();
      }}>
        <DialogContent className="max-w-lg rounded-3xl border-border p-0 shadow-[0_32px_80px_rgba(15,23,42,0.18)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitBranchVersion();
            }}
          >
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <GitBranch className="h-4 w-4" />
                Branch from {branchingVersion ? versionLabel(branchingVersion) : "version"}
              </DialogTitle>
              <DialogDescription>
                Create a new version from this output without replacing any existing versions.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 py-3">
              {branchingVersion?.prompt ? (
                <div className="mb-3 rounded-2xl border border-border/70 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  Starting from: {branchingVersion.prompt}
                </div>
              ) : null}
              <Textarea
                autoFocus
                value={branchPrompt}
                onChange={(event) => setBranchPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeBranchDialog();
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                className="min-h-[120px] resize-none rounded-2xl"
                disabled={branchSaving}
                placeholder="Describe the new direction for this branch."
              />
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button type="button" variant="outline" onClick={closeBranchDialog} disabled={branchSaving}>Cancel</Button>
              <Button type="submit" disabled={branchSaving || !branchPrompt.trim()}>
                {branchSaving ? "Branching" : "Create branch"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {launcherIsLegal ? (
        <LegalWorkflowLauncher
          open={workflowLauncherOpen}
          workflow={activeWorkflow}
          selection={launcherSelection}
          selectionMode="picker"
          availableFiles={launcherFiles}
          filesLoading={launcherFilesLoading}
          submitting={workflowSubmitting}
          initialInputs={launcherInitialInputs}
          chainSource={launcherChainSource}
          onOpenChange={(open) => {
            setWorkflowLauncherOpen(open);
            if (!open) {
              setActiveWorkflow(null);
              setLauncherSelection(emptyLauncherSelection);
              setLauncherInitialInputs({});
              setLauncherChainSource(null);
            }
          }}
          onRun={handleRunWorkflow}
        />
      ) : (
        <WorkflowLauncher
          open={workflowLauncherOpen}
          workflow={activeWorkflow}
          selection={launcherSelection}
          selectionMode="picker"
          availableFiles={launcherFiles}
          filesLoading={launcherFilesLoading}
          submitting={workflowSubmitting}
          initialInputs={launcherInitialInputs}
          chainSource={launcherChainSource}
          onOpenChange={(open) => {
            setWorkflowLauncherOpen(open);
            if (!open) {
              setActiveWorkflow(null);
              setLauncherSelection(emptyLauncherSelection);
              setLauncherInitialInputs({});
              setLauncherChainSource(null);
            }
          }}
          onRun={handleRunWorkflow}
        />
      )}
    </div>
  );
}
