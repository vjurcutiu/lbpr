// src/features/chat/types.ts

export type ChatRole = "user" | "assistant" | "system";

export type CitationFile = {
  file_id: string;
  filename?: string;
  display_name?: string;
  folder_path?: string;
  content_type?: string;
  checksum?: string;
};

export type Citation = {
  index: number;
  doc_id: string;
  chunk_id?: string | null;
  score?: number | null;
  snippet?: string;
  span_start?: number | null;
  span_end?: number | null;
  file?: CitationFile | null;
  used_in_answer?: boolean;

  // Backwards-compatible fields
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
