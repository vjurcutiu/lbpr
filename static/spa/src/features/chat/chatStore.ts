import { v4 as uuidv4 } from "uuid";

import { deleteJSON, getJSON, patchJSON, postJSON } from "@/shared/api";
import type { ChatTurn, ConversationMeta } from "./types";

type StoredShape = {
  conversations: ConversationMeta[];
  messages: Record<string, ChatTurn[]>;
};

type MessageListener = (id: string, msgs: ChatTurn[]) => void;
type ConversationListener = (conversations: ConversationMeta[]) => void;
type MessageSubscriptionMeta = {
  source: "cache" | "remote" | "fallback";
  hasCache: boolean;
};

const MESSAGE_LISTENERS: Record<string, Set<MessageListener>> = {};
const CONVERSATION_LISTENERS: Record<string, Set<ConversationListener>> = {};
const STORE_EVENT = "lbp-chat-store-change";
const SYNC_KEY_PREFIX = "lbp_chat_sync:";
const LEGACY_MIGRATION_PREFIX = "lbp_chat_migrated:";
const LEGACY_STORE_PREFIX = "lbp_chat_";
const TYPING_KEY_PREFIX = "chat:pending:";
const REFRESH_INTERVAL_MS = 15000;

const STATE_CACHE: Record<string, StoredShape> = {};
const INFLIGHT_MIGRATIONS: Record<string, Promise<void>> = {};
const INFLIGHT_CONVERSATIONS: Record<string, Promise<ConversationMeta[]>> = {};
const INFLIGHT_MESSAGES: Record<string, Promise<ChatTurn[]>> = {};

function legacyKey(ns: string) {
  return `${LEGACY_STORE_PREFIX}${ns}`;
}

function syncKey(ns: string) {
  return `${SYNC_KEY_PREFIX}${ns}`;
}

function migrationKey(ns: string) {
  return `${LEGACY_MIGRATION_PREFIX}${ns}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sortedConversations(conversations: ConversationMeta[]) {
  return [...conversations].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function getState(ns: string): StoredShape {
  const cached = STATE_CACHE[ns];
  if (cached) return cached;
  const empty: StoredShape = { conversations: [], messages: {} };
  STATE_CACHE[ns] = empty;
  return empty;
}

function setConversationsCache(ns: string, conversations: ConversationMeta[]) {
  const state = getState(ns);
  state.conversations = sortedConversations(conversations);
}

function setMessagesCache(ns: string, id: string, msgs: ChatTurn[]) {
  const state = getState(ns);
  state.messages[id] = [...msgs].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}

function hasMessagesCache(ns: string, id: string) {
  return Object.prototype.hasOwnProperty.call(getState(ns).messages, id);
}

function emitMessages(ns: string, id: string) {
  const listeners = MESSAGE_LISTENERS[ns];
  if (!listeners) return;
  const msgs = getState(ns).messages[id] || [];
  for (const cb of listeners) cb(id, msgs);
}

function emitConversations(ns: string) {
  const listeners = CONVERSATION_LISTENERS[ns];
  if (!listeners) return;
  const conversations = sortedConversations(getState(ns).conversations);
  for (const cb of listeners) cb(conversations);
}

function emitAll(ns: string, conversationId?: string) {
  emitConversations(ns);
  if (conversationId) emitMessages(ns, conversationId);
}

function broadcastChange(ns: string) {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(syncKey(ns), String(Date.now()));
    } catch {
      // no-op
    }
    window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: { ns } }));
  }
}

function readLegacyStore(ns: string): StoredShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(legacyKey(ns));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages: parsed.messages && typeof parsed.messages === "object" ? parsed.messages : {},
    };
  } catch {
    return null;
  }
}

async function refreshConversations(ns: string): Promise<ConversationMeta[]> {
  if (INFLIGHT_CONVERSATIONS[ns]) return INFLIGHT_CONVERSATIONS[ns];
  const promise = (async () => {
    await maybeMigrateLegacyNamespace(ns);
    const rows = await getJSON<ConversationMeta[]>(`/v1/chat/conversations?ns=${encodeURIComponent(ns)}`);
    setConversationsCache(ns, rows || []);
    emitConversations(ns);
    return getState(ns).conversations;
  })();
  INFLIGHT_CONVERSATIONS[ns] = promise;
  try {
    return await promise;
  } finally {
    delete INFLIGHT_CONVERSATIONS[ns];
  }
}

async function refreshMessages(ns: string, id: string): Promise<ChatTurn[]> {
  const inflightKey = `${ns}:${id}`;
  if (INFLIGHT_MESSAGES[inflightKey]) return INFLIGHT_MESSAGES[inflightKey];
  const promise = (async () => {
    await maybeMigrateLegacyNamespace(ns);
    const rows = await getJSON<ChatTurn[]>(`/v1/chat/conversations/${encodeURIComponent(id)}/messages?ns=${encodeURIComponent(ns)}`);
    setMessagesCache(ns, id, rows || []);
    emitMessages(ns, id);
    return getState(ns).messages[id] || [];
  })();
  INFLIGHT_MESSAGES[inflightKey] = promise;
  try {
    return await promise;
  } finally {
    delete INFLIGHT_MESSAGES[inflightKey];
  }
}

async function maybeMigrateLegacyNamespace(ns: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(migrationKey(ns)) === "1") return;
  const legacy = readLegacyStore(ns);
  if (!legacy || legacy.conversations.length === 0) {
    localStorage.setItem(migrationKey(ns), "1");
    return;
  }
  if (INFLIGHT_MIGRATIONS[ns]) return INFLIGHT_MIGRATIONS[ns];

  const promise = (async () => {
    for (const conv of sortedConversations(legacy.conversations)) {
      const conversationId = String(conv.id || uuidv4());
      await postJSON(`/v1/chat/conversations`, {
        ns,
        id: conversationId,
        title: conv.title || "New chat",
        tenant_id: conv.tenant_id || "tenant_demo",
        created_at: conv.created_at || nowIso(),
        updated_at: conv.updated_at || conv.created_at || nowIso(),
      });

      const msgs = legacy.messages?.[conversationId] || [];
      for (const msg of msgs) {
        await postJSON(`/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
          ns,
          role: msg.role,
          content: msg.content,
          created_at: msg.created_at || nowIso(),
          citations: msg.citations || [],
          trace_id: msg.trace_id ?? null,
          request_id: msg.request_id ?? null,
        });
      }
    }

    localStorage.removeItem(legacyKey(ns));
    localStorage.setItem(migrationKey(ns), "1");
    broadcastChange(ns);
  })();

  INFLIGHT_MIGRATIONS[ns] = promise;
  try {
    await promise;
  } finally {
    delete INFLIGHT_MIGRATIONS[ns];
  }
}

export async function createConversation(ns: string, title: string, tenantId = "tenant_demo"): Promise<string> {
  const id = uuidv4();
  const ts = nowIso();
  const meta = await postJSON<ConversationMeta>(`/v1/chat/conversations`, {
    ns,
    id,
    title: title?.trim() || "New chat",
    tenant_id: tenantId,
    created_at: ts,
    updated_at: ts,
  });
  const state = getState(ns);
  state.messages[id] = [];
  setConversationsCache(ns, [meta, ...state.conversations.filter((c) => c.id !== meta.id)]);
  emitAll(ns, id);
  broadcastChange(ns);
  return id;
}

export async function ensureConversation(ns: string, maybeId: string | null): Promise<string> {
  if (maybeId) return maybeId;
  return createConversation(ns, "New chat", "tenant_demo");
}

export async function appendMessage(ns: string, id: string, msg: ChatTurn): Promise<void> {
  await postJSON(`/v1/chat/conversations/${encodeURIComponent(id)}/messages`, {
    ns,
    role: msg.role,
    content: msg.content,
    created_at: msg.created_at || nowIso(),
    citations: msg.citations || [],
    trace_id: msg.trace_id ?? null,
    request_id: msg.request_id ?? null,
  });
  await Promise.all([refreshMessages(ns, id), refreshConversations(ns)]);
  broadcastChange(ns);
}

export async function listConversations(ns: string): Promise<ConversationMeta[]> {
  return refreshConversations(ns);
}

export async function renameConversation(ns: string, id: string, title: string): Promise<void> {
  const updated = await patchJSON<ConversationMeta>(`/v1/chat/conversations/${encodeURIComponent(id)}`, {
    ns,
    title: title?.trim() || "New chat",
  });
  const state = getState(ns);
  setConversationsCache(ns, [updated, ...state.conversations.filter((c) => c.id !== id)]);
  emitConversations(ns);
  broadcastChange(ns);
}

export async function deleteConversation(ns: string, id: string): Promise<void> {
  await deleteJSON(`/v1/chat/conversations/${encodeURIComponent(id)}?ns=${encodeURIComponent(ns)}`);
  const state = getState(ns);
  setConversationsCache(ns, state.conversations.filter((c) => c.id !== id));
  delete state.messages[id];
  emitAll(ns, id);
  broadcastChange(ns);
}

export function subscribeMessages(ns: string, id: string, cb: (msgs: ChatTurn[], meta: MessageSubscriptionMeta) => void): () => void {
  const set = (MESSAGE_LISTENERS[ns] = MESSAGE_LISTENERS[ns] || new Set());
  const wrapper = (_id: string, msgs: ChatTurn[]) => {
    if (_id === id) {
      cb(msgs, {
        source: "remote",
        hasCache: true,
      });
    }
  };

  const sync = () => {
    void refreshMessages(ns, id).catch(() => {
      cb(getState(ns).messages[id] || [], {
        source: "fallback",
        hasCache: hasMessagesCache(ns, id),
      });
    });
  };

  const handleStoreEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ ns?: string }>).detail;
    if (!detail?.ns || detail.ns === ns) sync();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === syncKey(ns)) sync();
  };

  set.add(wrapper);
  cb(getState(ns).messages[id] || [], {
    source: "cache",
    hasCache: hasMessagesCache(ns, id),
  });
  sync();

  const timer = typeof window !== "undefined" ? window.setInterval(sync, REFRESH_INTERVAL_MS) : null;

  if (typeof window !== "undefined") {
    window.addEventListener(STORE_EVENT, handleStoreEvent as EventListener);
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    set.delete(wrapper);
    if (typeof window !== "undefined") {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener(STORE_EVENT, handleStoreEvent as EventListener);
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function hasCachedMessages(ns: string, id: string): boolean {
  return hasMessagesCache(ns, id);
}

export function subscribeConversations(ns: string, cb: (conversations: ConversationMeta[]) => void): () => void {
  const set = (CONVERSATION_LISTENERS[ns] = CONVERSATION_LISTENERS[ns] || new Set());

  const sync = () => {
    void refreshConversations(ns).catch(() => {
      cb(sortedConversations(getState(ns).conversations));
    });
  };

  const handleStoreEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ ns?: string }>).detail;
    if (!detail?.ns || detail.ns === ns) sync();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === syncKey(ns)) sync();
  };

  set.add(cb);
  cb(sortedConversations(getState(ns).conversations));
  sync();

  const timer = typeof window !== "undefined" ? window.setInterval(sync, REFRESH_INTERVAL_MS) : null;

  if (typeof window !== "undefined") {
    window.addEventListener(STORE_EVENT, handleStoreEvent as EventListener);
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    set.delete(cb);
    if (typeof window !== "undefined") {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener(STORE_EVENT, handleStoreEvent as EventListener);
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function clearConversationNamespace(ns: string): void {
  delete STATE_CACHE[ns];
  if (typeof window !== "undefined") {
    localStorage.removeItem(legacyKey(ns));
    localStorage.removeItem(syncKey(ns));
    localStorage.removeItem(migrationKey(ns));
    const typingPrefix = `${TYPING_KEY_PREFIX}${ns}:`;
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const rawKey = localStorage.key(i);
      if (rawKey && rawKey.startsWith(typingPrefix)) toDelete.push(rawKey);
    }
    for (const rawKey of toDelete) localStorage.removeItem(rawKey);
  }
  emitConversations(ns);
}

export function clearUserConversationNamespaces(uid: string): void {
  if (typeof window === "undefined") return;
  const nsPrefix = `u:${uid}:`;
  const legacyPrefix = `${LEGACY_STORE_PREFIX}${nsPrefix}`;
  const syncPrefix = `${SYNC_KEY_PREFIX}${nsPrefix}`;
  const migrationPrefix = `${LEGACY_MIGRATION_PREFIX}${nsPrefix}`;
  const typingPrefix = `${TYPING_KEY_PREFIX}${nsPrefix}`;
  const removeKeys: string[] = [];

  for (const ns of Object.keys(STATE_CACHE)) {
    if (ns.startsWith(nsPrefix)) {
      delete STATE_CACHE[ns];
      emitConversations(ns);
    }
  }

  for (let i = 0; i < localStorage.length; i += 1) {
    const rawKey = localStorage.key(i);
    if (!rawKey) continue;
    if (
      rawKey.startsWith(legacyPrefix) ||
      rawKey.startsWith(syncPrefix) ||
      rawKey.startsWith(migrationPrefix) ||
      rawKey.startsWith(typingPrefix)
    ) {
      removeKeys.push(rawKey);
    }
  }

  for (const rawKey of removeKeys) localStorage.removeItem(rawKey);
  localStorage.removeItem("lbp_chat_ns");
}
