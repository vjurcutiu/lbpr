import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Download, Files, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import type { WorkflowArtifactFormat, WorkflowArtifactSummary, WorkflowResult, WorkflowRun, WorkflowSelection, WorkflowSuggestedAction } from "../types";

type SourceFileMeta = {
  file_id?: string;
  name?: string;
  folder_path?: string | null;
  content_type?: string | null;
  excerpt_chars?: number;
  full_text_chars?: number;
  truncated?: boolean;
};

type FieldMeta = {
  field?: string;
  value?: string;
  confidence?: string;
};

type DifferenceMeta = {
  topic?: string;
  file_a?: string;
  file_b?: string;
  impact?: string;
};

type PlanItemMeta = {
  action?: string;
  priority?: string;
  owner?: string;
  timeline?: string;
};

type SummaryLayerMeta = {
  key?: string;
  label?: string;
  text?: string;
};

type EvidenceMeta = {
  claim?: string;
  importance?: string;
  sources?: string[];
  evidence?: Array<{
    source_name?: string;
    excerpt?: string;
  }>;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatSourceLabel(source: SourceFileMeta) {
  const base = source.name || source.file_id || "Source file";
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

function isSingleSourceResult(result: WorkflowResult, sourceFiles: SourceFileMeta[]) {
  if (result.metadata?.single_source_workflow === true) return true;
  const explicitCount = Number(result.metadata?.source_file_count || 0);
  if (explicitCount === 1) return true;
  return uniqueSourceFiles(sourceFiles).length === 1;
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
  onSaveArtifact?: () => void;
  onDownloadArtifact?: (format: WorkflowArtifactFormat) => void;
  onWorkflowAction?: (action: WorkflowSuggestedAction, selection: WorkflowSelection, sourceRun: WorkflowRun) => void;
};

const DOWNLOAD_FORMATS: Array<{ value: WorkflowArtifactFormat; label: string; helper: string }> = [
  { value: "markdown", label: "Markdown (.md)", helper: "Best for editing or reusing later." },
  { value: "txt", label: "Text (.txt)", helper: "Plain text for quick sharing." },
  { value: "docx", label: "Word (.docx)", helper: "Formatted document for Word or Google Docs." },
  { value: "pdf", label: "PDF (.pdf)", helper: "Polished file for sharing." },
];

export function WorkflowResultDetails({ result, selection, sourceRun, artifact, artifactBusy = false, onSaveArtifact, onDownloadArtifact, onWorkflowAction }: Props) {
  const rawSourceFiles = asArray<SourceFileMeta>(result.metadata?.source_files);
  const sourceFiles = useMemo(() => uniqueSourceFiles(rawSourceFiles), [result.metadata]);
  const hideSourceLabels = isSingleSourceResult(result, sourceFiles);
  const visibleSourceFiles = hideSourceLabels ? [] : sourceFiles;
  const fields = asArray<FieldMeta>(result.metadata?.fields);
  const differences = asArray<DifferenceMeta>(result.metadata?.differences);
  const planItems = asArray<PlanItemMeta>(result.metadata?.plan_items);
  const summaryLayers = useMemo(() => {
    return asArray<SummaryLayerMeta>(result.metadata?.summary_layers)
      .map((layer) => ({
        key: String(layer.key || "").trim(),
        label: String(layer.label || "").trim(),
        text: String(layer.text || "").trim(),
      }))
      .filter((layer) => layer.key && layer.text);
  }, [result.metadata]);
  const summaryProfile = (result.metadata?.summary_profile || {}) as Record<string, unknown>;
  const defaultLayer = String(summaryProfile.default_layer || summaryLayers[0]?.key || "snapshot");
  const [activeLayer, setActiveLayer] = useState(defaultLayer);
  const evidenceHighlights = useMemo(() => {
    return asArray<EvidenceMeta>(result.metadata?.evidence_highlights)
      .map((item) => ({
        claim: String(item.claim || "").trim(),
        importance: String(item.importance || "medium").trim(),
        sources: asArray<string>(item.sources).map((source) => String(source || "").trim()).filter(Boolean),
        evidence: asArray<{ source_name?: string; excerpt?: string }>(item.evidence)
          .map((evidence) => ({
            source_name: String(evidence.source_name || "").trim(),
            excerpt: String(evidence.excerpt || "").trim(),
          }))
          .filter((evidence) => evidence.excerpt),
      }))
      .filter((item) => item.claim);
  }, [result.metadata]);
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

  useEffect(() => {
    setActiveLayer(defaultLayer);
  }, [defaultLayer, result]);



  return (
    <div className="space-y-5">
      {(onSaveArtifact || onDownloadArtifact) && (
        <Section title="Export">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium leading-5 text-foreground">
                {artifact ? "Saved output ready" : "Save this result"}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {artifact
                  ? `${artifact.file_name} • ${Math.max(1, Math.round((artifact.byte_size || 0) / 1024))} KB`
                  : "Save this result so it can be downloaded as Markdown, text, Word, or PDF."}
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              {artifact ? (
                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">
                  Saved
                </Badge>
              ) : null}
              {!artifact && onSaveArtifact ? (
                <Button variant="outline" size="sm" className="h-8 w-full rounded-full px-3 text-xs sm:w-auto" onClick={onSaveArtifact} disabled={artifactBusy}>
                  <Save className="mr-1 h-4 w-4" />
                  Save output
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
        </Section>
      )}


      {!!summaryLayers.length && (
        <Section title="Briefing">
          <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/10 px-4 py-4">
            <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {summaryProfile.audience ? <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">Audience: {String(summaryProfile.audience).replace(/_/g, " ")}</Badge> : null}
              {summaryProfile.depth ? <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">Default: {String(summaryProfile.depth).replace(/_/g, " ")}</Badge> : null}
            </div>
            <Tabs value={activeLayer} onValueChange={setActiveLayer}>
              <TabsList className="h-auto w-full max-w-full justify-start overflow-x-auto rounded-2xl bg-muted/40 p-1 sm:rounded-full">
                {summaryLayers.map((layer) => (
                  <TabsTrigger key={layer.key} value={layer.key} className="h-7 shrink-0 rounded-full px-2 text-xs">
                    {layer.label || layer.key}
                  </TabsTrigger>
                ))}
              </TabsList>
              {summaryLayers.map((layer) => (
                <TabsContent key={layer.key} value={layer.key} className="mt-3">
                  <div className="text-sm leading-6 whitespace-pre-wrap">{layer.text}</div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </Section>
      )}

      {!!evidenceHighlights.length && (
        <Section title="Supported takeaways">
          <div className="grid gap-2">
            {evidenceHighlights.map((item, idx) => (
              <div key={`${item.claim}-${idx}`} className="rounded-2xl border border-border/70 bg-background px-4 py-4">
                <div className="text-sm font-medium leading-5 text-foreground">{item.claim}</div>
                {!hideSourceLabels && !!item.sources?.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.sources.map((source) => (
                      <Badge key={`${item.claim}-${source}`} variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">
                        {source}
                      </Badge>
                    ))}
                  </div>
                )}
                {!!item.evidence?.length && (
                  <div className="mt-3 grid gap-2">
                    {item.evidence.map((evidence, evidenceIdx) => (
                      <div key={`${item.claim}-${evidence.source_name || "evidence"}-${evidenceIdx}`} className="border-l-2 border-border/70 pl-3 text-sm leading-6 text-muted-foreground">
                        {!hideSourceLabels && evidence.source_name ? (
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">{evidence.source_name}</div>
                        ) : null}
                        <div className={!hideSourceLabels && evidence.source_name ? "mt-1" : ""}>{evidence.excerpt}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!suggestedActions.length && selection && sourceRun && onWorkflowAction && (
        <Section title="Next workflow">
          <div className="grid gap-3 lg:grid-cols-2">
            {suggestedActions.map((action) => (
              <Button
                key={`${action.workflow_id}-${action.label}`}
                variant="outline"
                className="h-auto min-h-[104px] w-full items-start justify-start whitespace-normal rounded-2xl px-4 py-4 text-left"
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

      {!!visibleSourceFiles.length && (
        <Section title="Sources" icon={Files}>
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

      {!!fields.length && (
        <Section title="Structured output">
          <div className="grid gap-0 overflow-hidden rounded-2xl border border-border/70 sm:grid-cols-2 sm:divide-x sm:divide-border/70">
            {fields.map((field, idx) => (
              <div key={`${field.field || "field"}-${idx}`} className="border-t border-border/70 px-3 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{field.field || "Field"}</div>
                <div className="mt-1 text-sm leading-5 text-foreground">{field.value || "—"}</div>
                {field.confidence ? (
                  <div className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{field.confidence} confidence</div>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!differences.length && (
        <Section title="Difference summary">
          <div className="overflow-hidden rounded-2xl border border-border/70">
            {differences.map((difference, idx) => (
              <div key={`${difference.topic || "difference"}-${idx}`} className="border-t border-border/70 px-3 py-3 first:border-t-0">
                <div className="text-sm font-medium leading-5 text-foreground">{difference.topic || "Difference"}</div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">File A</div>
                    <div className="mt-1 text-sm leading-5">{difference.file_a || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">File B</div>
                    <div className="mt-1 text-sm leading-5">{difference.file_b || "—"}</div>
                  </div>
                </div>
                {difference.impact ? <div className="mt-2 text-sm leading-5 text-muted-foreground">{difference.impact}</div> : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!planItems.length && (
        <Section title="Execution plan">
          <div className="overflow-hidden rounded-2xl border border-border/70">
            {planItems.map((item, idx) => (
              <div key={`${item.action || "plan-item"}-${idx}`} className="border-t border-border/70 px-3 py-3 first:border-t-0">
                <div className="text-sm font-medium leading-5 text-foreground">{item.action || "Action item"}</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {item.priority ? <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">{item.priority}</Badge> : null}
                  {item.owner ? <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">Owner: {item.owner}</Badge> : null}
                  {item.timeline ? <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] font-normal">{item.timeline}</Badge> : null}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

    </div>
  );
}
