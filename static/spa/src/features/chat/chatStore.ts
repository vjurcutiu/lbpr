// src/features/chat/chatStore.ts
/**
 * Tiny chat store backed by localStorage.
 * Namespaced by `ns` so multiple tenants/spaces can coexist.
 *
 * Schema (per namespace key):
 * {
 *   conversations: ConversationMeta[],
 *   messages: Record<conversationId, ChatTurn[]>
 * }
 */
import { v4 as uuidv4 } from "uuid";
import type { ChatTurn, ConversationMeta } from "./types";

type StoredShape = {
  conversations: ConversationMeta[];
  messages: Record<string, ChatTurn[]>;
};

const LISTENERS: Record<string, Set<(id: string, msgs: ChatTurn[]) => void>> = {};

function key(ns: string) {
  return `lbp_chat_${ns}`;
}

function nowIso() {
  return new Date().toISOString();
}

function read(ns: string): StoredShape {
  try {
    const raw = localStorage.getItem(key(ns));
    if (!raw) return { conversations: [], messages: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { conversations: [], messages: {} };
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages: parsed.messages && typeof parsed.messages === "object" ? parsed.messages : {},
    };
  } catch {
    return { conversations: [], messages: {} };
  }
}

function write(ns: string, data: StoredShape) {
  localStorage.setItem(key(ns), JSON.stringify(data));
}

function emit(ns: string, id: string) {
  const store = read(ns);
  const listeners = LISTENERS[ns];
  if (!listeners) return;
  const msgs = store.messages[id] || [];
  for (const cb of listeners) cb(id, msgs);
}

export async function createConversation(ns: string, title: string, tenantId: string): Promise<string> {
  const store = read(ns);
  const id = uuidv4();
  const ts = nowIso();
  const meta: ConversationMeta = {
    id,
    title: title?.trim() || "New chat",
    tenant_id: tenantId,
    created_at: ts,
    updated_at: ts,
  };
  store.conversations.unshift(meta);
  store.messages[id] = [];
  write(ns, store);
  emit(ns, id);
  return id;
}

export async function ensureConversation(ns: string, maybeId: string | null): Promise<string> {
  if (maybeId) return maybeId;
  // Create default conversation when not specified
  return await createConversation(ns, "New chat", "tenant_demo");
}

export async function appendMessage(ns: string, id: string, msg: ChatTurn): Promise<void> {
  const store = read(ns);
  store.messages[id] = store.messages[id] || [];
  store.messages[id].push({ ...msg, created_at: msg.created_at || nowIso() });
  // bump conversation updated_at
  const conv = store.conversations.find(c => c.id === id);
  if (conv) conv.updated_at = nowIso();
  write(ns, store);
  emit(ns, id);
}

export async function listConversations(ns: string): Promise<ConversationMeta[]> {
  const store = read(ns);
  // newest first
  return [...store.conversations].sort((a, b) => (b.updated_at.localeCompare(a.updated_at)));
}

export async function renameConversation(ns: string, id: string, title: string): Promise<void> {
  const store = read(ns);
  const conv = store.conversations.find(c => c.id === id);
  if (conv) {
    conv.title = title?.trim() || conv.title;
    conv.updated_at = nowIso();
    write(ns, store);
  }
}

export async function deleteConversation(ns: string, id: string): Promise<void> {
  const store = read(ns);
  store.conversations = store.conversations.filter(c => c.id !== id);
  delete store.messages[id];
  write(ns, store);
  emit(ns, id);
}

/**
 * Subscribe to message changes for a conversation.
 * Immediately calls back with current messages.
 */
export function subscribeMessages(
  ns: string,
  id: string,
  cb: (msgs: ChatTurn[]) => void
): () => void {
  const set = (LISTENERS[ns] = LISTENERS[ns] || new Set());
  const wrapper = (_id: string, msgs: ChatTurn[]) => {
    if (_id === id) cb(msgs);
  };
  set.add(wrapper);
  // fire immediately
  const store = read(ns);
  cb(store.messages[id] || []);

  return () => {
    set.delete(wrapper);
  };
}
