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

function extractMessage(text: string): string {
  // try to parse common backend error envelopes
  try {
    const data = JSON.parse(text);
    const msg = data?.detail || data?.message || data?.error || data?.msg;
    if (typeof msg === "string" && msg.trim()) return msg;
  } catch {}
  // strip noisy html if any
  const trimmed = text.replace(/<[^>]*>/g, "").trim();
  return trimmed || "Unexpected server error";
}

export async function deleteFile(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/v1/files/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(extractMessage(await res.text()));
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
  if (!res.ok) throw new Error(extractMessage(await res.text()));
  return res.json();
}

export async function uploadFiles(files: File[]): Promise<{ jobs: string[] }> {
  if (files.length === 0) return { jobs: [] };
  // Try the batch endpoint first for efficiency
  const form = new FormData();
  for (const f of files) form.append("files", f);
  try {
    const res = await fetch(`${API_BASE}/v1/files/batch`, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    if (res.ok) return res.json();
    // If server doesn't support batch, fall back to single uploads
    console.warn("[files] batch upload not available, falling back to single uploads", res.status);
  } catch (e) {
    console.warn("[files] batch upload failed, falling back to single uploads", e);
  }
  const jobs: string[] = [];
  for (const f of files) {
    const { job_id } = await uploadFile(f);
    jobs.push(job_id);
  }
  return { jobs };
}

export function fileDownloadUrl(id: string) {
  const url = `${API_BASE}/v1/files/${encodeURIComponent(id)}/download`;
  console.debug("[files] fileDownloadUrl", { id, url });
  return url;
}

/** Fetch file content for preview. */
export async function getFileContent(id: string): Promise<{
  kind: "text" | "image" | "pdf" | "other";
  text?: string;
  url?: string;          // blob URL for image/pdf/other
  contentType?: string;
}> {
  const url = `${API_BASE}/v1/files/${encodeURIComponent(id)}`;
  console.debug("[files] getFileContent ->", { id, url });
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "*/*" },
  });
  console.debug("[files] getFileContent status", res.status, res.statusText);
  if (!res.ok) {
    const txt = await res.text();
    console.error("[files] getFileContent error", txt);
    try {
      const data = JSON.parse(txt);
      const msg = data?.detail || data?.message || data?.error || data?.msg || txt;
      throw new Error(typeof msg === "string" ? msg : "Failed to load file");
    } catch {
      throw new Error(txt || "Failed to load file");
    }
  }
  const ct = res.headers.get("content-type") || "";
  console.debug("[files] getFileContent content-type", ct);
  if (ct.startsWith("text/") || ct.includes("json") || ct.includes("xml") || ct.includes("markdown")) {
    const text = await res.text();
    return { kind: "text", text, contentType: ct };
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  if (ct.includes("pdf")) return { kind: "pdf", url: blobUrl, contentType: ct };
  if (ct.startsWith("image/")) return { kind: "image", url: blobUrl, contentType: ct };
  return { kind: "other", url: blobUrl, contentType: ct };
}
