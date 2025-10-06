// src/features/chat/chatStore.ts
import { getFirebaseApp } from "@/lib/firebase";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit as qLimit,
  serverTimestamp,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import type { ChatTurn, ConversationMeta } from "./types";

const app = getFirebaseApp();
const db = getFirestore(app);

export function getUid(): string {
  const u = getAuth().currentUser;
  if (!u) throw new Error("No authenticated user");
  return u.uid;
}

function nsBase(uid: string, namespace: string) {
  // Per our convention (see backend NAMESPACES.md): users/{uid}/chat/{namespace}/conversations/{cid}
  return collection(db, "users", uid, "chat", namespace, "conversations");
}

function tsToIso(v: any): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return String(v);
}

export async function createConversation(namespace: string, title = "New chat", tenant_id?: string) {
  const uid = getUid();
  const convCol = nsBase(uid, namespace);
  const now = serverTimestamp();
  const ref = await addDoc(convCol, {
    title,
    tenant_id: tenant_id || null,
    namespace,
    created_at: now,
    updated_at: now,
    last_role: null,
    last_snippet: "",
  });
  return ref.id;
}

export async function ensureConversation(namespace: string, existingId?: string | null) {
  if (existingId) return existingId;
  return createConversation(namespace);
}

export async function listConversations(namespace: string, opts?: { pageSize?: number }): Promise<ConversationMeta[]> {
  const uid = getUid();
  const convCol = nsBase(uid, namespace);
  const q = query(convCol, orderBy("updated_at", "desc"), qLimit(opts?.pageSize ?? 50));
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const data = d.data() as any;
    return {
      id: d.id,
      title: String(data.title || "New chat"),
      namespace: String(data.namespace || namespace),
      tenant_id: data.tenant_id || undefined,
      created_at: tsToIso(data.created_at),
      updated_at: tsToIso(data.updated_at),
    } satisfies ConversationMeta;
  });
}

export function messagesCol(uid: string, namespace: string, conversationId: string) {
  return collection(db, "users", uid, "chat", namespace, "conversations", conversationId, "messages");
}

export async function getMessages(namespace: string, conversationId: string): Promise<ChatTurn[]> {
  const uid = getUid();
  const msgsQ = query(messagesCol(uid, namespace, conversationId), orderBy("created_at", "asc"));
  const snap = await getDocs(msgsQ);
  return snap.docs.map(d => {
    const data = d.data() as any;
    return {
      role: data.role,
      content: data.content,
      citations: data.citations || undefined,
      created_at: tsToIso(data.created_at),
      trace_id: data.trace_id ?? null,
      request_id: data.request_id ?? null,
    } as ChatTurn;
  });
}

export function subscribeMessages(
  namespace: string,
  conversationId: string,
  onUpdate: (messages: ChatTurn[]) => void
): Unsubscribe {
  const uid = getUid();
  const msgsQ = query(messagesCol(uid, namespace, conversationId), orderBy("created_at", "asc"));
  return onSnapshot(msgsQ, (snap) => {
    const list: ChatTurn[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      list.push({
        role: data.role,
        content: data.content,
        citations: data.citations || undefined,
        created_at: tsToIso(data.created_at),
        trace_id: data.trace_id ?? null,
        request_id: data.request_id ?? null,
      });
    });
    onUpdate(list);
  });
}

export async function appendMessage(
  namespace: string,
  conversationId: string,
  msg: ChatTurn
) {
  const uid = getUid();
  const mcol = messagesCol(uid, namespace, conversationId);
  await addDoc(mcol, {
    role: msg.role,
    content: msg.content,
    citations: msg.citations || null,
    created_at: serverTimestamp(),
    trace_id: msg.trace_id ?? null,
    request_id: msg.request_id ?? null,
  });
  // Update conversation summary fields
  await setDoc(
    doc(db, "users", uid, "chat", namespace, "conversations", conversationId),
    {
      updated_at: serverTimestamp(),
      last_role: msg.role,
      last_snippet: (msg.content || "").slice(0, 140),
    },
    { merge: true }
  );
}

export async function renameConversation(namespace: string, conversationId: string, title: string) {
  const uid = getUid();
  await setDoc(
    doc(db, "users", uid, "chat", namespace, "conversations", conversationId),
    { title, updated_at: serverTimestamp() },
    { merge: true }
  );
}