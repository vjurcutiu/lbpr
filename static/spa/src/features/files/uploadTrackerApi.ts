
import { API_BASE, getJSON } from "@/shared/api";

export type UploadJob = {
  job_id: string;
  uid: string;
  filename: string;
  dataset: string;
  total_bytes: number;
  bytes: number;
  phase: "receive" | "upload" | "ocr" | "extract" | "embed" | "upsert" | "complete" | "error";
  pct: number;
  status: "running" | "done" | "error";
  error?: string | null;
  created_at: number;
  updated_at: number;
};

export async function listUploadJobs(): Promise<UploadJob[]> {
  const resp = await getJSON<{ items: UploadJob[] }>("/v1/upload-tracker/jobs");
  return resp.items;
}

export async function getUploadJob(id: string): Promise<UploadJob> {
  return getJSON<UploadJob>(`/v1/upload-tracker/jobs/${encodeURIComponent(id)}`);
}
