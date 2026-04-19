import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Files, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import type { WorkflowResult } from "../types";

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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatSourceLabel(source: SourceFileMeta) {
  const base = source.name || source.file_id || "Source file";
  return source.folder_path ? `${base} · ${source.folder_path}` : base;
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Files; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {title}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function WorkflowResultDetails({ result }: { result: WorkflowResult }) {
  const sourceFiles = asArray<SourceFileMeta>(result.metadata?.source_files);
  const warnings = asArray<string>(result.metadata?.warnings).filter(Boolean);
  const fields = asArray<FieldMeta>(result.metadata?.fields);
  const differences = asArray<DifferenceMeta>(result.metadata?.differences);
  const planItems = asArray<PlanItemMeta>(result.metadata?.plan_items);
  const preview = (result.preview_markdown || "").trim();

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
    <div className="space-y-3">
      {!!warnings.length && (
        <div className="border border-amber-500/20 bg-amber-500/8 px-3 py-3">
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
          <div className="border border-border/70">
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
          <div className="border border-border/70">
            {planItems.map((item, idx) => (
              <div key={`${item.action || "plan-item"}-${idx}`} className="border-t border-border/70 px-3 py-3 first:border-t-0">
                <div className="text-sm font-medium leading-5 text-foreground">{item.action || "Action item"}</div>
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
          <div className="border border-border/70 px-3 py-3 text-sm leading-6">
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mb-2 prose-headings:mt-3 prose-p:my-2 prose-li:my-0.5 prose-ul:my-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview}</ReactMarkdown>
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
