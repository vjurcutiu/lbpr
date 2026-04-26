import { API_BASE } from "@/shared/api";

export type UploadJob = {
  job_id: string;
  uid: string;
  filename: string;
  dataset: string;
  total_bytes: number;
  bytes: number;
  phase: "receive" | "queued" | "upload" | "transcribe" | "ocr" | "extract" | "embed" | "upsert" | "complete" | "error";
  pct: number;
  status: "running" | "done" | "error";
  error?: string | null;
  created_at: number;
  updated_at: number;
};

function extractMessage(text: string): string {
  try {
    const data = JSON.parse(text);
    const msg = (data as any)?.detail || (data as any)?.message || (data as any)?.error || (data as any)?.msg;
    if (typeof msg === "string" && msg.trim()) return msg;
  } catch {}
  const trimmed = text.replace(/<[^>]*>/g, "").trim();
  return trimmed || "Unexpected server error";
}

export async function listUploadJobs(): Promise<UploadJob[]> {
  const res = await fetch(`${API_BASE}/v1/upload-tracker/jobs`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(extractMessage(await res.text()));
  const payload = await res.json() as { items: UploadJob[] };
  return payload.items;
}

export async function getUploadJob(id: string): Promise<UploadJob> {
  const res = await fetch(`${API_BASE}/v1/upload-tracker/jobs/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(extractMessage(await res.text()));
  return res.json() as Promise<UploadJob>;
}

export async function clearUploadJobs(scope: "done" | "all" = "done"): Promise<{ removed: number }> {
  const res = await fetch(`${API_BASE}/v1/upload-tracker/jobs?scope=${scope}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(extractMessage(await res.text()));
  return res.json() as Promise<{ removed: number }>;
}
