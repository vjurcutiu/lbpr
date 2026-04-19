import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Files, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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
    <div className="space-y-4">
      {!!warnings.length && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-800 dark:text-amber-200">
            <TriangleAlert className="h-3.5 w-3.5" />
            Notes
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {warnings.map((warning) => (
              <Badge key={warning} variant="outline" className="whitespace-normal text-left text-[11px] text-amber-900 dark:text-amber-100">
                {warning}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {!!sourceFiles.length && (
        <div className="space-y-2 rounded-2xl border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Files className="h-3.5 w-3.5" />
            Source material used
          </div>
          <div className="flex flex-wrap gap-2">
            {sourceFiles.map((source, idx) => (
              <Badge key={`${source.file_id || source.name || "source"}-${idx}`} variant="secondary" className="max-w-full whitespace-normal rounded-full text-left">
                {formatSourceLabel(source)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {!!fields.length && (
        <div className="space-y-3 rounded-2xl border bg-muted/20 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Structured output</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((field, idx) => (
              <div key={`${field.field || "field"}-${idx}`} className="rounded-2xl border bg-background p-3">
                <div className="text-xs font-medium text-muted-foreground">{field.field || "Field"}</div>
                <div className="mt-1 text-sm leading-6">{field.value || "—"}</div>
                {field.confidence ? <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{field.confidence} confidence</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {!!differences.length && (
        <div className="space-y-3 rounded-2xl border bg-muted/20 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Difference summary</div>
          <div className="space-y-2">
            {differences.map((difference, idx) => (
              <div key={`${difference.topic || "difference"}-${idx}`} className="rounded-2xl border bg-background p-3">
                <div className="text-sm font-medium">{difference.topic || "Difference"}</div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">File A</div>
                    <div className="text-sm leading-6">{difference.file_a || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">File B</div>
                    <div className="text-sm leading-6">{difference.file_b || "—"}</div>
                  </div>
                </div>
                {difference.impact ? <div className="mt-2 text-sm leading-6 text-muted-foreground">{difference.impact}</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {!!planItems.length && (
        <div className="space-y-3 rounded-2xl border bg-muted/20 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Execution plan</div>
          <div className="space-y-2">
            {planItems.map((item, idx) => (
              <div key={`${item.action || "plan-item"}-${idx}`} className="rounded-2xl border bg-background p-3">
                <div className="text-sm font-medium">{item.action || "Action item"}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {item.priority ? <Badge variant="outline">{item.priority}</Badge> : null}
                  {item.owner ? <Badge variant="outline">Owner: {item.owner}</Badge> : null}
                  {item.timeline ? <Badge variant="outline">{item.timeline}</Badge> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview ? (
        <>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Output preview</div>
            <Button variant="outline" size="sm" onClick={copyPreview}>
              <Copy className="mr-1.5 h-4 w-4" />
              Copy output
            </Button>
          </div>
          <div className="max-h-[420px] overflow-auto rounded-2xl border bg-background px-4 py-3 text-sm shadow-sm">
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview}</ReactMarkdown>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
