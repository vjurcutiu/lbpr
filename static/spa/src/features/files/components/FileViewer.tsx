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

/** Build highlighted HTML for a raw text + query and mark the active match */
function highlightHtml(raw: string, q: string, selectedIndex: number) {
  const safe = (v: string) => escapeHtml(v);
  const trimmed = (q ?? "").trim();
  if (!trimmed) return `<pre class="whitespace-pre-wrap leading-5 md:leading-6">${safe(raw)}</pre>`;
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
        `<mark data-idx="${matchIdx}" class="rounded px-0.5 ${isActive ? "ring-2 ring-primary bg-primary/20" : ""}">${safe(part)}</mark>`
      );
    } else {
      out.push(safe(part));
    }
  }
  return `<pre class="whitespace-pre-wrap leading-5 md:leading-6">${out.join("")}</pre>`;
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
    // Scroll to the selected highlighted match
    const el = containerRef.current.querySelector(`mark[data-idx="${selectedIndex}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [searchTerm, selectedIndex]);

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
    const html = highlightHtml(raw, searchTerm ?? "", selectedIndex);
    return (
      <div ref={containerRef} className="w-full">
        <div className="font-mono text-[13px] md:text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  if (payload.kind === "image" && payload.url) {
    return (
      <div className="w-full grid place-items-center" ref={containerRef}>
        <img
          src={payload.url}
          alt={file.name}
          className="max-w-full max-h-[70vh] md:max-h-full object-contain"
        />
      </div>
    );
  }

  if (payload.kind === "pdf" && payload.url) {
    // On mobile, give the iframe an explicit height; h-full often collapses.
    return (
      <iframe
        src={payload.url}
        title={file.name}
        className="w-full h-[70vh] md:h-full border rounded"
      />
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
