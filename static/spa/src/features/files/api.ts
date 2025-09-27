import { API_BASE, getJSON } from "@/shared/api";

export type FileItem = {
  id: string;
  name: string;
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

/**
 * Uploads a single file.
 * Contract: POST /v1/files returns { job_id: string } with 202 Accepted.
 * We don't return a FileItem; caller should refresh the list.
 */
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
