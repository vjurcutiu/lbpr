import { API_BASE } from "@/shared/api";

export type TranscribeResponse = {
  job_id: string;
  text: string;
  segments: string[];
  detected_languages: string[];
  billed_seconds: number;
  model: string;
  location: string;
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

export async function transcribeAudio(
  file: File,
  opts?: {
    languages?: string[];
    model?: string;
    diarization?: boolean;
    min_speakers?: number;
    max_speakers?: number;
  }
): Promise<TranscribeResponse> {
  const form = new FormData();
  form.append("file", file);

  const params = new URLSearchParams();
  for (const lc of opts?.languages || []) {
    const v = (lc || "").trim();
    if (v) params.append("languages", v);
  }
  if (opts?.model) params.set("model", opts.model);
  if (opts?.diarization != null) params.set("diarization", String(!!opts.diarization));
  if (opts?.min_speakers != null) params.set("min_speakers", String(opts.min_speakers));
  if (opts?.max_speakers != null) params.set("max_speakers", String(opts.max_speakers));

  const qs = params.toString();
  const res = await fetch(`${API_BASE}/v1/transcribe${qs ? `?${qs}` : ""}`,
    {
      method: "POST",
      body: form,
      credentials: "include",
    }
  );

  if (!res.ok) throw new Error(extractMessage(await res.text()));
  return (await res.json()) as TranscribeResponse;
}
