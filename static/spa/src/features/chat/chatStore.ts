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

type MessageListener = (id: string, msgs: ChatTurn[]) => void;
type ConversationListener = (conversations: ConversationMeta[]) => void;

const MESSAGE_LISTENERS: Record<string, Set<MessageListener>> = {};
const CONVERSATION_LISTENERS: Record<string, Set<ConversationListener>> = {};
const STORE_EVENT = "lbp-chat-store-change";

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
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: { ns } }));
  }
}

function sortedConversations(conversations: ConversationMeta[]) {
  return [...conversations].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function emitMessages(ns: string, id: string) {
  const store = read(ns);
  const listeners = MESSAGE_LISTENERS[ns];
  if (!listeners) return;
  const msgs = store.messages[id] || [];
  for (const cb of listeners) cb(id, msgs);
}

function emitConversations(ns: string) {
  const store = read(ns);
  const listeners = CONVERSATION_LISTENERS[ns];
  if (!listeners) return;
  const conversations = sortedConversations(store.conversations);
  for (const cb of listeners) cb(conversations);
}

function emitAll(ns: string, conversationId?: string) {
  emitConversations(ns);
  if (conversationId) emitMessages(ns, conversationId);
}

export async function createConversation(ns: string, title: string, tenantId = "tenant_demo"): Promise<string> {
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
  emitAll(ns, id);
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
  emitAll(ns, id);
}

export async function listConversations(ns: string): Promise<ConversationMeta[]> {
  const store = read(ns);
  return sortedConversations(store.conversations);
}

export async function renameConversation(ns: string, id: string, title: string): Promise<void> {
  const store = read(ns);
  const conv = store.conversations.find(c => c.id === id);
  if (conv) {
    conv.title = title?.trim() || conv.title;
    conv.updated_at = nowIso();
    write(ns, store);
    emitConversations(ns);
  }
}

export async function deleteConversation(ns: string, id: string): Promise<void> {
  const store = read(ns);
  store.conversations = store.conversations.filter(c => c.id !== id);
  delete store.messages[id];
  write(ns, store);
  emitAll(ns, id);
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
  const set = (MESSAGE_LISTENERS[ns] = MESSAGE_LISTENERS[ns] || new Set());
  const wrapper = (_id: string, msgs: ChatTurn[]) => {
    if (_id === id) cb(msgs);
  };

  const syncFromStorage = () => {
    const store = read(ns);
    cb(store.messages[id] || []);
  };
  const handleStoreEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ ns?: string }>).detail;
    if (!detail?.ns || detail.ns === ns) syncFromStorage();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === key(ns)) syncFromStorage();
  };

  set.add(wrapper);
  cb(read(ns).messages[id] || []);

  if (typeof window !== "undefined") {
    window.addEventListener(STORE_EVENT, handleStoreEvent as EventListener);
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    set.delete(wrapper);
    if (typeof window !== "undefined") {
      window.removeEventListener(STORE_EVENT, handleStoreEvent as EventListener);
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function subscribeConversations(
  ns: string,
  cb: (conversations: ConversationMeta[]) => void
): () => void {
  const set = (CONVERSATION_LISTENERS[ns] = CONVERSATION_LISTENERS[ns] || new Set());

  const syncFromStorage = () => {
    cb(sortedConversations(read(ns).conversations));
  };
  const handleStoreEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ ns?: string }>).detail;
    if (!detail?.ns || detail.ns === ns) syncFromStorage();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === key(ns)) syncFromStorage();
  };

  set.add(cb);
  syncFromStorage();

  if (typeof window !== "undefined") {
    window.addEventListener(STORE_EVENT, handleStoreEvent as EventListener);
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    set.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener(STORE_EVENT, handleStoreEvent as EventListener);
      window.removeEventListener("storage", handleStorage);
    }
  };
}
