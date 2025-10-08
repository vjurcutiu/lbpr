import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { FileItem } from "../api";
import { fileDownloadUrl, getFileContent } from "../api";

/** Escape HTML to safely inject highlights */
function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Build highlighted HTML for a raw text + query, no hooks needed */
function highlightHtml(raw: string, q: string) {
  const safe = (v: string) => escapeHtml(v);
  const trimmed = (q ?? "").trim();
  if (!trimmed) return `<pre class="whitespace-pre-wrap leading-6">${safe(raw)}</pre>`;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${escaped})`, "gi");
  const parts = raw.split(pattern).map((part) => {
    if (pattern.test(part)) return `<mark class="rounded px-0.5">${safe(part)}</mark>`;
    return safe(part);
  });
  return `<pre class="whitespace-pre-wrap leading-6">${parts.join("")}</pre>`;
}

export function FileViewer({
  payload,
  file,
  searchTerm,
}: {
  payload: Awaited<ReturnType<typeof getFileContent>> | undefined;
  file: FileItem | null;
  searchTerm?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Scroll to the first highlighted match when searchTerm changes
    const first = containerRef.current.querySelector("mark");
    if (first && first instanceof HTMLElement) {
      first.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [searchTerm]);

  if (!file) return null;
  if (!payload) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (payload.kind === "text") {
    const raw = payload.text ?? "";
    const html = highlightHtml(raw, searchTerm ?? "");
    return (
      <div ref={containerRef} className="w-full h-full">
        <div
          className="font-mono text-sm"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  if (payload.kind === "image" && payload.url) {
    return (
      <div className="w-full h-full grid place-items-center" ref={containerRef}>
        <img
          src={payload.url}
          alt={file.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  }

  if (payload.kind === "pdf" && payload.url) {
    return (
      <iframe src={payload.url} title={file.name} className="w-full h-full border rounded" />
    );
  }

  return (
    <div className="text-sm">
      Preview not available.{" "}
      <a
        className="underline"
        href={fileDownloadUrl(file.id)}
        onClick={() => console.debug("[files] viewer download", { id: file.id })}
      >
        Download
      </a>
    </div>
  );
}
