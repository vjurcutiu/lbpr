import { API_BASE, getJSON } from "@/shared/api";

export type FileItem = {
  id: string;
  name: string;          // may include path-like slashes e.g. "folder/sub/file.txt"
  size: number;
  created_at?: string;
  content_type?: string;
};

export async function listFiles(): Promise<FileItem[]> {
  // GET /v1/files -> [FileItem]
  return getJSON<FileItem[]>("/v1/files");
}

export async function deleteFile(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/v1/files/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return { ok: true };
}

export async function uploadFile(file: File): Promise<{ job_id: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/v1/files`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function fileDownloadUrl(id: string) {
  return `${API_BASE}/v1/files/${encodeURIComponent(id)}/download`;
}

/** Optional: if/when backend supports it:
 * export async function getFileTree(): Promise<FolderNode> { return getJSON("/v1/files/tree"); }
 */

/** Fetch file content for preview.
 * Tries text first; falls back to blob URL for binary (image/pdf).
 * Endpoint options:
 *   - If you already have /v1/files/:id/raw or ?raw=1, switch the URL accordingly.
 */
export async function getFileContent(id: string): Promise<{
  kind: "text" | "image" | "pdf" | "other";
  text?: string;
  url?: string;          // blob URL for image/pdf/other
  contentType?: string;
}> {
  const res = await fetch(`${API_BASE}/v1/files/${encodeURIComponent(id)}`, {
    credentials: "include",
    headers: { Accept: "*/*" },
  });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get("content-type") || "";
  if (ct.startsWith("text/") || ct.includes("json") || ct.includes("xml") || ct.includes("markdown")) {
    const text = await res.text();
    return { kind: "text", text, contentType: ct };
  }
  // treat common binaries
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (ct.includes("pdf")) return { kind: "pdf", url, contentType: ct };
  if (ct.startsWith("image/")) return { kind: "image", url, contentType: ct };
  return { kind: "other", url, contentType: ct };
}
