import { Loader2 } from "lucide-react";
import type { FileItem } from "../api";
import { fileDownloadUrl, getFileContent } from "../api";

export function FileViewer({
  payload,
  file,
}: {
  payload: Awaited<ReturnType<typeof getFileContent>> | undefined;
  file: FileItem | null;
}) {
  if (!file) return null;
  if (!payload) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (payload.kind === "text") {
    const text = payload.text ?? "";
    return <pre className="whitespace-pre-wrap leading-6">{text}</pre>;
  }

  if (payload.kind === "image" && payload.url) {
    return (
      <div className="w-full h-full grid place-items-center">
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
