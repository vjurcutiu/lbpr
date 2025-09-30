/**
 * Chat API client with per-request trace IDs for backend correlation.
 */
export type ChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatRequest = {
  tenant_id: string;
  message: string;
  history?: ChatTurn[];
  max_context?: number;
  stream?: boolean;
};

export type Citation = {
  doc_id: string;
  title?: string;
  span?: string;
};

export type ChatResponse = {
  answer: string;
  citations: Citation[];
  usage: Record<string, any>;
};

export async function sendChat(req: ChatRequest, traceId?: string) {
  const tid = traceId || cryptoRandomId();
  const res = await fetch("/api/v1/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-trace-id": tid,
      "x-tenant-id": req.tenant_id,
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Chat failed (${res.status}). trace=${tid} ${text}`);
  }
  const data = (await res.json()) as ChatResponse;
  (data as any).__trace_id = tid;
  return data;
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return Array.from(buf).map(n => n.toString(36)).join("");
  }
  return Math.random().toString(36).slice(2);
}
