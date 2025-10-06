// src/features/chat/types.ts
export type ChatRole = "user" | "assistant" | "system";

export type ChatTurn = {
  role: ChatRole;
  content: string;
  citations?: Array<{ doc_id: string; title?: string; span?: string }>;
  created_at?: string; // ISO if present
  trace_id?: string | null;
  request_id?: string | null;
};

export type ConversationMeta = {
  id: string;
  title: string;
  namespace: string;
  tenant_id?: string;
  created_at: string; // ISO
  updated_at: string; // ISO
};