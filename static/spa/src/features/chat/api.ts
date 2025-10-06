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
  // diagnostic props (not part of API)
  __trace_id?: string;
  __request_id?: string | null;
  __status?: number;
  __dur_ms?: number;
};

export async function sendChat(req: ChatRequest, traceId?: string) {
  const tid = traceId || cryptoRandomId();
  const t0 = performance.now();
  console.debug("[chat.api] fetch_start", { traceId: tid, len: req.message?.length ?? 0, history: req.history?.length ?? 0 });
  const res = await fetch("/api/v1/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-trace-id": tid,
      "x-tenant-id": req.tenant_id,
    },
    body: JSON.stringify(req),
  });
  const dur = Math.round(performance.now() - t0);
  const rid = res.headers.get("x-request-id");
  const rtid = res.headers.get("x-trace-id"); // added by backend middleware
  console.debug("[chat.api] fetch_end", { status: res.status, traceId: rtid || tid, requestId: rid, dur_ms: dur });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Chat failed (${res.status}). trace=${rtid || tid} ${text}`);
  }
  const data = (await res.json()) as ChatResponse;
  (data as any).__trace_id = rtid || tid;
  (data as any).__request_id = rid;
  (data as any).__status = res.status;
  (data as any).__dur_ms = dur;
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