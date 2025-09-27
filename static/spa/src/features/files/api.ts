import { API_BASE, getJSON } from "@/shared/api";

export type FileItem = {
  id: string;
  name: string;
  size: number;
  created_at?: string;
  content_type?: string;
};

export async function listFiles(): Promise<FileItem[]> {
  return getJSON<FileItem[]>("/files");
}

export async function deleteFile(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return { ok: true };
}

export async function uploadFile(file: File): Promise<FileItem> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/files`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function fileDownloadUrl(id: string) {
  return `${API_BASE}/files/${encodeURIComponent(id)}/download`;
}
