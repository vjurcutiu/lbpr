import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Files, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { WorkflowResult, WorkflowSelection, WorkflowSuggestedAction } from "../types";

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

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Files; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-6 first:border-t-0 first:pt-0">
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
  onWorkflowAction?: (action: WorkflowSuggestedAction, selection: WorkflowSelection) => void;
};

export function WorkflowResultDetails({ result, selection, onWorkflowAction }: Props) {
  const sourceFiles = asArray<SourceFileMeta>(result.metadata?.source_files);
  const warnings = asArray<string>(result.metadata?.warnings).filter(Boolean);
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
            source_name: String(evidence.source_name || "Source").trim(),
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
  const preview = (result.preview_markdown || "").trim();

  useEffect(() => {
    setActiveLayer(defaultLayer);
  }, [defaultLayer, result]);

  const copyPreview = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      toast.success("Output copied");
    } catch {
      toast.error("Could not copy the output");
    }
  };

  return (
    <div className="space-y-6">
      {!!warnings.length && (
        <div className="border border-amber-500/20 bg-amber-500/8 px-4 py-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-200">
            <TriangleAlert className="h-3 w-3" />
            Notes
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {warnings.map((warning) => (
              <Badge
                key={warning}
                variant="outline"
                className="whitespace-normal rounded-none px-1.5 py-0 text-left text-[10px] font-normal text-amber-900 dark:text-amber-100"
              >
                {warning}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {!!summaryLayers.length && (
        <Section title="Layered briefing">
          <div className="space-y-4 border border-border/70 px-4 py-4 md:px-5">
            <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {summaryProfile.audience ? <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">Audience: {String(summaryProfile.audience).replace(/_/g, " ")}</Badge> : null}
              {summaryProfile.depth ? <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">Default: {String(summaryProfile.depth).replace(/_/g, " ")}</Badge> : null}
            </div>
            <Tabs value={activeLayer} onValueChange={setActiveLayer}>
              <TabsList className="h-auto w-full justify-start rounded-none bg-muted/40 p-1">
                {summaryLayers.map((layer) => (
                  <TabsTrigger key={layer.key} value={layer.key} className="h-7 rounded-none px-2 text-xs">
                    {layer.label || layer.key}
                  </TabsTrigger>
                ))}
              </TabsList>
              {summaryLayers.map((layer) => (
                <TabsContent key={layer.key} value={layer.key} className="mt-3">
                  <div className="text-[15px] leading-7 whitespace-pre-wrap">{layer.text}</div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </Section>
      )}

      {!!evidenceHighlights.length && (
        <Section title="Evidence-backed takeaways">
          <div className="grid gap-2">
            {evidenceHighlights.map((item, idx) => (
              <div key={`${item.claim}-${idx}`} className="border border-border/70 px-4 py-4">
                <div className="text-[15px] font-medium leading-7 text-foreground">{item.claim}</div>
                {!!item.sources?.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.sources.map((source) => (
                      <Badge key={`${item.claim}-${source}`} variant="secondary" className="rounded-none px-1.5 py-0 text-[10px] font-normal">
                        {source}
                      </Badge>
                    ))}
                  </div>
                )}
                {!!item.evidence?.length && (
                  <div className="mt-3 grid gap-2">
                    {item.evidence.map((evidence, evidenceIdx) => (
                      <div key={`${item.claim}-${evidence.source_name}-${evidenceIdx}`} className="border-l-2 border-border/70 pl-4 text-[15px] leading-7 text-muted-foreground">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">{evidence.source_name}</div>
                        <div className="mt-1">{evidence.excerpt}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!suggestedActions.length && selection && onWorkflowAction && (
        <Section title="Continue with">
          <div className="grid gap-2 md:grid-cols-3">
            {suggestedActions.map((action) => (
              <Button
                key={`${action.workflow_id}-${action.label}`}
                variant="outline"
                className="h-auto rounded-none px-4 py-4 text-left"
                onClick={() => onWorkflowAction(action, selection)}
              >
                <div>
                  <div className="text-sm font-medium leading-5">{action.label}</div>
                  {action.description ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</div> : null}
                </div>
              </Button>
            ))}
          </div>
        </Section>
      )}

      {!!sourceFiles.length && (
        <Section title="Source material used" icon={Files}>
          <div className="flex flex-wrap gap-1">
            {sourceFiles.map((source, idx) => (
              <Badge
                key={`${source.file_id || source.name || "source"}-${idx}`}
                variant="secondary"
                className="max-w-full whitespace-normal rounded-none px-1.5 py-0 text-left text-[10px] font-normal"
              >
                {formatSourceLabel(source)}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {!!fields.length && (
        <Section title="Structured output">
          <div className="grid gap-0 border border-border/70 sm:grid-cols-2 sm:divide-x sm:divide-border/70">
            {fields.map((field, idx) => (
              <div key={`${field.field || "field"}-${idx}`} className="border-t border-border/70 px-4 py-4 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{field.field || "Field"}</div>
                <div className="mt-1.5 text-[15px] leading-7 text-foreground">{field.value || "—"}</div>
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
          <div className="border border-border/70">
            {differences.map((difference, idx) => (
              <div key={`${difference.topic || "difference"}-${idx}`} className="border-t border-border/70 px-4 py-4 first:border-t-0">
                <div className="text-[15px] font-medium leading-7 text-foreground">{difference.topic || "Difference"}</div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">File A</div>
                    <div className="mt-1.5 text-[15px] leading-7">{difference.file_a || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">File B</div>
                    <div className="mt-1.5 text-[15px] leading-7">{difference.file_b || "—"}</div>
                  </div>
                </div>
                {difference.impact ? <div className="mt-3 text-[15px] leading-7 text-muted-foreground">{difference.impact}</div> : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!planItems.length && (
        <Section title="Execution plan">
          <div className="border border-border/70">
            {planItems.map((item, idx) => (
              <div key={`${item.action || "plan-item"}-${idx}`} className="border-t border-border/70 px-4 py-4 first:border-t-0">
                <div className="text-[15px] font-medium leading-7 text-foreground">{item.action || "Action item"}</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {item.priority ? <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">{item.priority}</Badge> : null}
                  {item.owner ? <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">Owner: {item.owner}</Badge> : null}
                  {item.timeline ? <Badge variant="outline" className="rounded-none px-1.5 py-0 text-[10px] font-normal">{item.timeline}</Badge> : null}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {preview ? (
        <Section title="Output preview">
          <div className="mb-2 flex items-center justify-end">
            <Button variant="outline" size="sm" className="h-8 rounded-none px-3 text-xs" onClick={copyPreview}>
              <Copy className="mr-1 h-4 w-4" />
              Copy
            </Button>
          </div>
          <div className="border border-border/70 px-4 py-4 text-[15px] leading-7 md:px-5">
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mb-3 prose-headings:mt-4 prose-p:my-3 prose-li:my-1 prose-ul:my-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview}</ReactMarkdown>
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
