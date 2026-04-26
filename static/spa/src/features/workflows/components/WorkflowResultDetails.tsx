import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Circle, Copy, Download, Files, GitBranch, History, Save, SendHorizontal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { WorkflowArtifactFormat, WorkflowArtifactSummary, WorkflowResult, WorkflowRun, WorkflowRunVersion, WorkflowSelection, WorkflowSuggestedAction } from "../types";

type SourceFileMeta = {
  file_id?: string;
  name?: string;
  folder_path?: string | null;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatSourceLabel(source: SourceFileMeta) {
  const base = String(source.name || source.file_id || "Source file").replace(" — retrieved evidence", "").trim();
  return source.folder_path ? `${base} · ${source.folder_path}` : base;
}

function sourceIdentity(source: SourceFileMeta) {
  return String(source.file_id || source.name || "").trim();
}

function uniqueSourceFiles(sources: SourceFileMeta[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = sourceIdentity(source);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatVersionTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function versionKindLabel(version: WorkflowRunVersion) {
  if (version.kind === "original") return "Original";
  if (version.kind === "branch") return "Branch";
  return "Refined";
}

function versionLabel(version: WorkflowRunVersion) {
  return `V${version.version_number || 1}`;
}

function sortedVersions(versions: WorkflowRunVersion[]) {
  return [...(versions || [])].sort((a, b) => (a.version_number || 0) - (b.version_number || 0));
}

function versionDepth(version: WorkflowRunVersion, versions: WorkflowRunVersion[]) {
  const byId = new Map(versions.map((item) => [item.id, item]));
  let depth = 0;
  let cursor = version.parent_version_id || "";
  const seen = new Set<string>();
  while (cursor && byId.has(cursor) && !seen.has(cursor) && depth < 8) {
    seen.add(cursor);
    depth += 1;
    cursor = byId.get(cursor)?.parent_version_id || "";
  }
  return depth;
}

function stripSourcesUsedSection(markdown: string) {
  return String(markdown || "")
    .replace(/^\s*#{1,6}\s+(?:sources used|source used|sources|source material)\s*$[\s\S]*?(?=^\s*#{1,6}\s+|\s*$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fallbackMarkdown(result: WorkflowResult) {
  const lines: string[] = [];
  const summary = String(result.summary || "").trim();
  if (summary) lines.push(summary);

  const bullets = (result.bullets || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (bullets.length) {
    lines.push("", "## Summary", ...bullets.map((item) => `- ${item}`));
  }

  const actions = (result.next_actions || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (actions.length) {
    lines.push("", "## Next steps", ...actions.map((item) => `- ${item}`));
  }

  return lines.join("\n").trim() || "No workflow output is available yet.";
}

function documentMarkdown(result: WorkflowResult) {
  return stripSourcesUsedSection(result.preview_markdown || fallbackMarkdown(result));
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Files; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

type Props = {
  result: WorkflowResult;
  selection?: WorkflowSelection;
  sourceRun?: WorkflowRun;
  artifact?: WorkflowArtifactSummary | null;
  artifactBusy?: boolean;
  refineBusy?: boolean;
  versions?: WorkflowRunVersion[];
  activeVersionId?: string | null;
  versionBusyId?: string | null;
  onSaveArtifact?: () => void;
  onDownloadArtifact?: (format: WorkflowArtifactFormat) => void;
  onSelectVersion?: (version: WorkflowRunVersion) => void;
  onDownloadVersion?: (version: WorkflowRunVersion, format: WorkflowArtifactFormat) => void;
  onBranchVersion?: (version: WorkflowRunVersion) => void;
  onRefine?: (prompt: string) => void;
  onWorkflowAction?: (action: WorkflowSuggestedAction, selection: WorkflowSelection, sourceRun: WorkflowRun) => void;
};

const DOWNLOAD_FORMATS: Array<{ value: WorkflowArtifactFormat; label: string; helper: string }> = [
  { value: "markdown", label: "Markdown (.md)", helper: "Best for editing or reusing later." },
  { value: "txt", label: "Text (.txt)", helper: "Plain text for quick sharing." },
  { value: "docx", label: "Word (.docx)", helper: "Formatted document for Word or Google Docs." },
  { value: "pdf", label: "PDF (.pdf)", helper: "Polished file for sharing." },
];

type VersionHistoryPanelProps = {
  versions: WorkflowRunVersion[];
  activeVersionId?: string | null;
  versionBusyId?: string | null;
  onSelectVersion?: (version: WorkflowRunVersion) => void;
  onDownloadVersion?: (version: WorkflowRunVersion, format: WorkflowArtifactFormat) => void;
  onBranchVersion?: (version: WorkflowRunVersion) => void;
};

function VersionHistoryPanel({
  versions,
  activeVersionId,
  versionBusyId,
  onSelectVersion,
  onDownloadVersion,
  onBranchVersion,
}: VersionHistoryPanelProps) {
  const [treeOpen, setTreeOpen] = useState(false);
  const orderedVersions = useMemo(() => sortedVersions(versions), [versions]);
  const activeVersion = orderedVersions.find((version) => version.id === activeVersionId) || orderedVersions[orderedVersions.length - 1];
  const hasMultipleVersions = orderedVersions.length > 1;

  if (!hasMultipleVersions) return null;

  return (
    <>
      <div className="rounded-2xl border border-border/70 bg-muted/10 px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium leading-5 text-foreground">
              <History className="h-4 w-4 text-muted-foreground" />
              Versions
              {activeVersion ? (
                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">
                  Viewing {versionLabel(activeVersion)}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              Select an earlier output, download it, or branch from it with a new prompt.
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full rounded-full px-3 text-xs sm:w-auto"
            onClick={() => setTreeOpen(true)}
          >
            <GitBranch className="mr-1 h-4 w-4" />
            Tree view
          </Button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {orderedVersions.map((version) => {
            const active = version.id === activeVersion?.id;
            const busy = versionBusyId === version.id;
            return (
              <button
                key={version.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!active) onSelectVersion?.(version);
                }}
                className={cn(
                  "min-w-[150px] rounded-2xl border px-3 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-70",
                  active
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-border/70 bg-background hover:bg-muted/30"
                )}
              >
                <div className="flex items-center gap-2">
                  {active ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">{versionLabel(version)}</span>
                  <span className="text-[11px] text-muted-foreground">{versionKindLabel(version)}</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {version.prompt || formatVersionTime(version.updated_at)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={treeOpen} onOpenChange={setTreeOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden rounded-3xl border-border p-0 shadow-[0_32px_80px_rgba(15,23,42,0.18)]">
          <DialogHeader className="border-b border-border/70 px-6 pt-6 pb-4">
            <DialogTitle className="text-base font-semibold">Version tree</DialogTitle>
            <DialogDescription>
              Older versions stay available even after you refine or branch the output.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[62vh] overflow-y-auto px-4 py-4">
            <div className="space-y-2">
              {orderedVersions.map((version) => {
                const active = version.id === activeVersion?.id;
                const busy = versionBusyId === version.id;
                const depth = versionDepth(version, orderedVersions);
                return (
                  <div key={version.id} className="flex min-w-0 gap-2" style={{ paddingLeft: `${Math.min(depth, 5) * 22}px` }}>
                    {depth > 0 ? (
                      <div className="mt-5 h-px w-4 shrink-0 bg-border" />
                    ) : null}
                    <div
                      className={cn(
                        "min-w-0 flex-1 rounded-2xl border px-3 py-3",
                        active ? "border-primary/40 bg-primary/5" : "border-border/70 bg-background"
                      )}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={active ? "default" : "secondary"} className="rounded-full px-2 py-0 text-[10px] font-normal">
                              {versionLabel(version)}
                            </Badge>
                            <span className="text-sm font-medium text-foreground">{versionKindLabel(version)}</span>
                            <span className="text-xs text-muted-foreground">{formatVersionTime(version.updated_at)}</span>
                          </div>
                          {version.prompt ? (
                            <p className="mt-2 text-sm leading-6 text-foreground/85">{version.prompt}</p>
                          ) : (
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">First generated output.</p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            type="button"
                            variant={active ? "secondary" : "outline"}
                            size="sm"
                            className="h-8 rounded-full px-3 text-xs"
                            disabled={busy || active}
                            onClick={() => {
                              onSelectVersion?.(version);
                              setTreeOpen(false);
                            }}
                          >
                            {active ? "Viewing" : "Select"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full px-3 text-xs"
                            disabled={busy}
                            onClick={() => {
                              onBranchVersion?.(version);
                              setTreeOpen(false);
                            }}
                          >
                            <GitBranch className="mr-1 h-3.5 w-3.5" />
                            Branch
                          </Button>
                          {onDownloadVersion ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 rounded-full px-3 text-xs"
                                  disabled={busy}
                                >
                                  <Download className="mr-1 h-3.5 w-3.5" />
                                  Download
                                  <ChevronDown className="ml-1 h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-64 rounded-2xl">
                                <DropdownMenuLabel className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Download format</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {DOWNLOAD_FORMATS.map((item) => (
                                  <DropdownMenuItem
                                    key={item.value}
                                    className="items-start rounded-xl px-2 py-2"
                                    onSelect={() => onDownloadVersion(version, item.value)}
                                  >
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium leading-5 text-foreground">{item.label}</div>
                                      <div className="text-[11px] leading-4 text-muted-foreground">{item.helper}</div>
                                    </div>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkflowResultDetails({
  result,
  selection,
  sourceRun,
  artifact,
  artifactBusy = false,
  refineBusy = false,
  versions = [],
  activeVersionId,
  versionBusyId = null,
  onSaveArtifact,
  onDownloadArtifact,
  onSelectVersion,
  onDownloadVersion,
  onBranchVersion,
  onRefine,
  onWorkflowAction,
}: Props) {
  const rawSourceFiles = asArray<SourceFileMeta>(result.metadata?.source_files);
  const visibleSourceFiles = useMemo(() => uniqueSourceFiles(rawSourceFiles), [rawSourceFiles]);
  const markdown = useMemo(() => documentMarkdown(result), [result]);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const suggestedActions = useMemo(() => {
    return asArray<WorkflowSuggestedAction>(result.metadata?.suggested_actions)
      .map((action) => ({
        kind: String(action.kind || "workflow").trim(),
        label: String(action.label || "").trim(),
        workflow_id: String(action.workflow_id || "").trim(),
        focus: String(action.focus || "").trim(),
        description: String(action.description || "").trim(),
      }))
      .filter((action) => action.label && action.workflow_id);
  }, [result.metadata]);

  const submitRefinement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = refinePrompt.trim();
    if (!prompt || refineBusy) return;
    onRefine?.(prompt);
    setRefinePrompt("");
  };

  const copyOutput = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="space-y-5">
      <VersionHistoryPanel
        versions={versions}
        activeVersionId={activeVersionId}
        versionBusyId={versionBusyId}
        onSelectVersion={onSelectVersion}
        onDownloadVersion={onDownloadVersion}
        onBranchVersion={onBranchVersion}
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-5 text-foreground">Output</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {artifact
              ? `${artifact.file_name} • ${Math.max(1, Math.round((artifact.byte_size || 0) / 1024))} KB`
              : "Save, copy, or download this output when it is ready."}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={() => { void copyOutput(); }}>
            <Copy className="mr-1 h-4 w-4" />
            {copied ? "Copied" : "Copy"}
          </Button>
          {!artifact && onSaveArtifact ? (
            <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={onSaveArtifact} disabled={artifactBusy}>
              <Save className="mr-1 h-4 w-4" />
              Save
            </Button>
          ) : null}
          {onDownloadArtifact ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" disabled={artifactBusy}>
                  <Download className="mr-1 h-4 w-4" />
                  {artifact ? "Download" : "Save and download"}
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-2xl">
                <DropdownMenuLabel className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Download format</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {DOWNLOAD_FORMATS.map((item) => (
                  <DropdownMenuItem
                    key={item.value}
                    className="items-start rounded-xl px-2 py-2"
                    onSelect={() => onDownloadArtifact(item.value)}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium leading-5 text-foreground">{item.label}</div>
                      <div className="text-[11px] leading-4 text-muted-foreground">{item.helper}</div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <article className="rounded-[1.75rem] border border-border/70 bg-background px-5 py-6 shadow-sm md:px-8 md:py-8">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h1 className="mb-5 text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground">{children}</h1>,
            h2: ({ children }) => <h2 className="mb-3 mt-7 text-lg font-semibold leading-7 text-foreground first:mt-0">{children}</h2>,
            h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold leading-6 text-foreground">{children}</h3>,
            p: ({ children }) => <p className="my-3 text-[15px] leading-7 text-foreground/90">{children}</p>,
            ul: ({ children }) => <ul className="my-3 ml-5 list-disc space-y-2 text-[15px] leading-7 text-foreground/90">{children}</ul>,
            ol: ({ children }) => <ol className="my-3 ml-5 list-decimal space-y-2 text-[15px] leading-7 text-foreground/90">{children}</ol>,
            li: ({ children }) => <li className="pl-1">{children}</li>,
            blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-border pl-4 text-[15px] leading-7 text-muted-foreground">{children}</blockquote>,
            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
            table: ({ children }) => <div className="my-5 overflow-x-auto rounded-2xl border border-border/70"><table className="w-full min-w-[560px] border-collapse text-sm">{children}</table></div>,
            th: ({ children }) => <th className="border-b border-border/70 bg-muted/30 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</th>,
            td: ({ children }) => <td className="border-t border-border/70 px-3 py-2 align-top text-sm leading-6 text-foreground/90">{children}</td>,
            code: ({ children, className }) => (
              <code className={cn("rounded-md bg-muted px-1.5 py-0.5 text-[0.9em]", className)}>{children}</code>
            ),
            pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-2xl bg-muted px-4 py-3 text-sm leading-6">{children}</pre>,
          }}
        >
          {markdown}
        </ReactMarkdown>
      </article>

      {onRefine ? (
        <form onSubmit={submitRefinement} className="rounded-2xl border border-border/70 bg-background px-4 py-4 shadow-sm">
          <label htmlFor="workflow-refine-prompt" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
            Refine output
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              id="workflow-refine-prompt"
              value={refinePrompt}
              onChange={(event) => setRefinePrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask for a revision. The new output will be saved as another version."
              className="min-h-[88px] flex-1 rounded-2xl resize-none"
              disabled={refineBusy}
            />
            <Button type="submit" className="h-10 rounded-full px-4" disabled={refineBusy || !refinePrompt.trim()}>
              <SendHorizontal className="mr-2 h-4 w-4" />
              {refineBusy ? "Refining" : "Refine"}
            </Button>
          </div>
        </form>
      ) : null}

      {!!visibleSourceFiles.length && (
        <Section title="Sources used" icon={Files}>
          <div className="flex flex-wrap gap-1">
            {visibleSourceFiles.map((source, idx) => (
              <Badge
                key={`${source.file_id || source.name || "source"}-${idx}`}
                variant="secondary"
                className="max-w-full whitespace-normal rounded-full px-2 py-0.5 text-left text-[10px] font-normal"
              >
                {formatSourceLabel(source)}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {!!suggestedActions.length && selection && sourceRun && onWorkflowAction && (
        <Section title="Continue from this output">
          <div className="grid gap-3 lg:grid-cols-2">
            {suggestedActions.map((action) => (
              <Button
                key={`${action.workflow_id}-${action.label}`}
                variant="outline"
                className="h-auto min-h-[92px] w-full items-start justify-start whitespace-normal rounded-2xl px-4 py-4 text-left"
                onClick={() => onWorkflowAction(action, selection, sourceRun)}
              >
                <div className="min-w-0 space-y-2">
                  <div className="text-base font-medium leading-6 break-words text-foreground">{action.label}</div>
                  {action.description ? (
                    <div className="text-sm leading-6 break-words text-muted-foreground">{action.description}</div>
                  ) : null}
                </div>
              </Button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
