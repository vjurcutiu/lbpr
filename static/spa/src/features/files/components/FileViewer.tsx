import { useEffect, useRef } from "react";
import { Download, Image as ImageIcon, Loader2, Search, Text, FileType2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { FileItem } from "../api";
import { fileDownloadUrl, getFileContent } from "../api";
import { FileIconByName } from "./FileIconByName";

/** Escape HTML to safely inject highlights */
function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Build highlighted HTML for a raw text + query and mark the active match */
function highlightHtml(raw: string, q: string, selectedIndex: number) {
  const safe = (v: string) => escapeHtml(v);
  const trimmed = (q ?? "").trim();
  if (!trimmed) return `<pre class="whitespace-pre-wrap break-words leading-6 text-foreground">${safe(raw)}</pre>`;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${escaped})`, "gi");
  const parts = raw.split(pattern);
  let matchIdx = -1;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      matchIdx += 1;
      const isActive = matchIdx === selectedIndex;
      out.push(
        `<mark data-idx="${matchIdx}" class="rounded-md px-1 py-0.5 ${isActive ? "bg-primary/18 ring-2 ring-primary/55 shadow-sm" : "bg-primary/10"}">${safe(part)}</mark>`
      );
    } else {
      out.push(safe(part));
    }
  }
  return `<pre class="whitespace-pre-wrap break-words leading-6 text-foreground">${out.join("")}</pre>`;
}

function UnsupportedPreview({ file }: { file: FileItem }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-[24px] border bg-background px-6 py-12 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-muted/60 text-muted-foreground">
        <FileType2 className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold">Preview not available</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        This file type can still be downloaded and opened locally. The Files viewer currently supports text, images, and PDFs.
      </p>
      <a
        className="mt-5"
        href={fileDownloadUrl(file.id)}
        onClick={() => console.debug("[files] viewer download", { id: file.id })}
      >
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Download file
        </Button>
      </a>
    </div>
  );
}

export function FileViewer({
  payload,
  file,
  searchTerm,
  selectedIndex = -1,
}: {
  payload: Awaited<ReturnType<typeof getFileContent>> | undefined;
  file: FileItem | null;
  searchTerm?: string;
  /** index of the active in-file search match (0-based). -1 disables focus */
  selectedIndex?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (selectedIndex == null || selectedIndex < 0) return;
    const el = containerRef.current.querySelector(`mark[data-idx="${selectedIndex}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [searchTerm, selectedIndex]);

  if (!file) return null;
  if (!payload) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-[24px] border border-dashed bg-background/70 px-6 py-12 text-center shadow-sm">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <h3 className="text-base font-semibold">Preparing preview</h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Loading the latest file contents so the viewer stays in sync with the Files workspace.
        </p>
      </div>
    );
  }

  if (payload.kind === "text") {
    const raw = payload.text ?? "";
    const html = highlightHtml(raw, searchTerm ?? "", selectedIndex);
    return (
      <div ref={containerRef} className="mx-auto w-full max-w-[1100px]">
        <div className="overflow-hidden rounded-[24px] border bg-background shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/35 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 font-medium text-foreground/80">
              <Text className="h-3.5 w-3.5" />
              Text preview
            </span>
            <span>{raw.split(/\r?\n/).length.toLocaleString()} lines</span>
            <span>•</span>
            <span>{raw.length.toLocaleString()} characters</span>
            {searchTerm?.trim() ? (
              <>
                <span>•</span>
                <span className="inline-flex items-center gap-1">
                  <Search className="h-3.5 w-3.5" />
                  Searching for “{searchTerm.trim()}”
                </span>
              </>
            ) : null}
          </div>
          <div className="overflow-x-auto px-4 py-4 sm:px-5 sm:py-5">
            <div className="font-mono text-[13px] md:text-sm" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    );
  }

  if (payload.kind === "image" && payload.url) {
    return (
      <div ref={containerRef} className="mx-auto flex w-full max-w-[1200px] items-center justify-center">
        <div className="w-full overflow-hidden rounded-[24px] border bg-background shadow-sm">
          <div className="flex items-center gap-2 border-b bg-muted/35 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 font-medium text-foreground/80">
              <ImageIcon className="h-3.5 w-3.5" />
              Image preview
            </span>
          </div>
          <div className="grid min-h-[55vh] place-items-center bg-[radial-gradient(circle_at_top,_hsl(var(--muted))_0%,_transparent_65%)] p-4 sm:p-6">
            <img
              src={payload.url}
              alt={file.name}
              className="max-h-[72vh] max-w-full rounded-xl border bg-background object-contain shadow-sm"
            />
          </div>
        </div>
      </div>
    );
  }

  if (payload.kind === "pdf" && payload.url) {
    return (
      <div className="mx-auto w-full max-w-[1200px]">
        <div className="overflow-hidden rounded-[24px] border bg-background shadow-sm">
          <div className="flex items-center gap-2 border-b bg-muted/35 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 font-medium text-foreground/80">
              <FileIconByName name={file.name} className="h-3.5 w-3.5" />
              PDF preview
            </span>
          </div>
          <div className="bg-muted/25 p-2 sm:p-3">
            <iframe
              src={payload.url}
              title={file.name}
              className="min-h-[72vh] w-full rounded-[18px] border bg-background"
            />
          </div>
        </div>
      </div>
    );
  }

  return <UnsupportedPreview file={file} />;
}
