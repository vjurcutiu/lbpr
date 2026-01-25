import { API_BASE } from "@/shared/api";

export type OcrMode = "document" | "text";

export type OcrResponse = {
  job_id: string;
  text: string;
  mode: OcrMode;
  language_hints?: string[];
  images_charged?: number;
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

export async function runOcr(
  file: File,
  opts?: {
    languages?: string[];
    mode?: OcrMode;
  }
): Promise<OcrResponse> {
  const form = new FormData();
  form.append("file", file);

  const params = new URLSearchParams();
  for (const lc of opts?.languages || []) {
    const v = (lc || "").trim();
    if (v) params.append("languages", v);
  }
  if (opts?.mode) params.set("mode", opts.mode);

  const qs = params.toString();
  const res = await fetch(`${API_BASE}/v1/ocr${qs ? `?${qs}` : ""}`,
    {
      method: "POST",
      body: form,
      credentials: "include",
    }
  );

  if (!res.ok) throw new Error(extractMessage(await res.text()));
  return (await res.json()) as OcrResponse;
}
