// src/features/chat/types.ts

export type ChatRole = "user" | "assistant" | "system";

export type Citation = {
  doc_id: string;
  title?: string;
  span?: string;
};

export type ChatTurn = {
  role: ChatRole;
  content: string;
  created_at?: string;
  citations?: Citation[];
  trace_id?: string | null;
  request_id?: string | null;
};

export type ConversationMeta = {
  id: string;
  title: string;
  tenant_id: string;
  created_at: string; // ISO
  updated_at: string; // ISO
};
