import { postJSON } from "@/shared/api";

/** Contracts aligned with components.toml */
export type ChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatRequest = {
  tenant_id: string;
  message: string;
  history?: ChatTurn[];
  max_context?: number; // default handled server-side
  stream?: boolean;     // default false
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

export async function sendChat(req: ChatRequest) {
  // Contract: POST /v1/chat -> ChatResponse
  return postJSON<ChatResponse>("/v1/chat", req);
}
