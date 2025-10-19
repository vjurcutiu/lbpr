// src/features/chat/ChatPage.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Send, Loader2, PlusCircle, MessageSquare, MoreVertical, Pencil, Trash2, Info, AlertCircle, Crown, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import * as chatApi from "./api";
import { ApiError } from "./api";
import { getAuth } from "firebase/auth";
import {
  appendMessage,
  createConversation,
  ensureConversation,
  listConversations,
  renameConversation,
  subscribeMessages,
  deleteConversation,
} from "./chatStore";
import type { ChatTurn, ConversationMeta } from "./types";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";

/**
 * Namespacing model:
 * - Keep the app-level "namespace" UX (stored in localStorage).
 * - Derive a per-user effective namespace: `u:<uid>:<namespace>` (or `anon:<namespace>` when signed out).
 * - Use the effective namespace for ALL chatStore calls and subscriptions.
 */

function useNamespace() {
  const [ns, setNs] = useState<string>(() => localStorage.getItem("lbp_chat_ns") || "default");
  useEffect(() => {
    localStorage.setItem("lbp_chat_ns", ns);
  }, [ns]);
  return { namespace: ns, setNamespace: setNs };
}

type RenderMessage = ChatTurn & { id: string };

type LimitsMe = {
  plan: "FREE" | "PRO";
  window: string;
  period: { start_ts: number; end_ts: number };
  caps: { messages: number; upload_tokens: number };
  usage: { messages: number; upload_tokens: number };
  remaining: { messages: number; upload_tokens: number };
};

async function fetchLimits(): Promise<LimitsMe | null> {
  try {
    const res = await fetch("/api/limits/me", { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as LimitsMe;
  } catch {
    return null;
  }
}

export default function ChatPage() {
  const [messages, setMessages] = useState<RenderMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamEnabled] = useState(false);

  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const { namespace } = useNamespace();
  const listRef = useRef<HTMLDivElement>(null);
  const canSend = input.trim().length > 0 && !sending;

  // Current Firebase user
  const uid = getAuth().currentUser?.uid || null;

  // ----- NEW: derive a per-user effective namespace -----
  const effectiveNs = useMemo(() => {
    return uid ? `u:${uid}:${namespace}` : `anon:${namespace}`;
  }, [uid, namespace]);

  // Helpers
  async function refreshConversations(ns = effectiveNs) {
    try {
      const convs = await listConversations(ns);
      setSessions(convs);
      if (!sessionId && convs[0]) setSessionId(convs[0].id);
    } catch (e) {
      console.error("[chat] listConversations error", e);
    }
  }

  // When user or namespace changes, (re)load list
  useEffect(() => {
    if (!uid) {
      // When signed out, reset UI state but still allow anon namespace separation
      setSessions([]);
      setSessionId(null);
      setMessages([]);
      return;
    }
    refreshConversations();
  }, [uid, effectiveNs]); // effectiveNs includes namespace

  // Subscribe message thread for selected session
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    const unsub = subscribeMessages(effectiveNs, sessionId, (msgs) => {
      setMessages(msgs.map((m, i) => ({ ...m, id: `${i}` })));
      queueMicrotask(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      });
    });
    return () => unsub();
  }, [effectiveNs, sessionId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [sending]);

  const historyForRequest: chatApi.ChatTurn[] = useMemo(
    () => messages.map((m) => ({ role: m.role, content: m.content })),
    [messages]
  );

  const startNewSearch = useCallback(async () => {
    try {
      const id = await createConversation(effectiveNs, "New chat");
      await refreshConversations();
      setSessionId(id);
      setMessages([]);
      setInput("");
    } catch (e) {
      console.error("[chat] createConversation error", e);
    }
  }, [effectiveNs]);

  const switchSession = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      setSessionId(id);
      setInput("");
    },
    [sessionId]
  );

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;

    const trimmed = input.trim();
    const userMsg: ChatTurn = {
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
      trace_id: null,
      request_id: null,
    } as any;

    setInput("");
    setSending(true);

    try {
      const convId = await ensureConversation(effectiveNs, sessionId);
      if (!sessionId) setSessionId(convId);

      await appendMessage(effectiveNs, convId, userMsg);

      const req: chatApi.ChatRequest = {
        message: userMsg.content,
        history: [...historyForRequest, { role: "user", content: userMsg.content }],
        stream: streamEnabled,
      };

      const res = await chatApi.sendChat(req);
      const assistantMsg: ChatTurn = {
        role: "assistant",
        content: res.answer,
        citations: res.citations ?? [],
        created_at: new Date().toISOString(),
        trace_id: (res as any).__trace_id,
        request_id: (res as any).__request_id ?? null,
      } as any;

      await appendMessage(effectiveNs, convId, assistantMsg);

      if (messages.length === 0) {
        const title = trimForTitle(userMsg.content);
        await renameConversation(effectiveNs, convId, title);
        await refreshConversations();
      }
    } catch (err: any) {
      // Friendly UX for rate limits (HTTP 429)
      if (err instanceof ApiError && err.status === 429 && sessionId) {
        const lim = await fetchLimits();
        const payload = {
          __kind: "limit",
          reason: "messages",
          limits: lim,
        };
        const sysMsg: ChatTurn = {
          role: "system",
          content: JSON.stringify(payload),
          created_at: new Date().toISOString(),
        } as any;
        await appendMessage(effectiveNs, sessionId, sysMsg);
      } else {
        // Fallback: raw error as a small system bubble
        if (sessionId) {
          const sysMsg: ChatTurn = {
            role: "system",
            content: err?.message || "Failed to send message",
            created_at: new Date().toISOString(),
          } as any;
          await appendMessage(effectiveNs, sessionId, sysMsg);
        }
      }
      console.error("[chat.ui] error", err);
    } finally {
      setSending(false);
      queueMicrotask(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  };

  const hasThread = messages.length > 0;
  const composerTextClass = "text-left placeholder:text-left leading-[1.4] h-12 py-3";

  return (
    <div className="h-full w-full overflow-hidden flex">
      <LeftSidebar
        sessions={sessions}
        currentId={sessionId || ""}
        onNew={startNewSearch}
        onSelect={switchSession}
        onRename={async (id, title) => {
          await renameConversation(effectiveNs, id, title);
          await refreshConversations();
        }}
        onDelete={async (id) => {
          await deleteConversation(effectiveNs, id);
          await refreshConversations();
          if (id === sessionId) {
            const next = (await listConversations(effectiveNs))[0]?.id || null;
            setSessionId(next);
            setMessages([]);
          }
        }}
      />

      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <div ref={listRef} className="flex-1 overflow-auto">
          {!hasThread ? (
            <EmptyState
              heroValue={input}
              onHeroChange={setInput}
              onHeroSubmit={() => onSubmit()}
            />
          ) : (
            <div className="px-4 sm:px-6 py-6 space-y-6">
              {messages.map((m, idx) => (
                <MessageRow
                  key={m.id || String(idx)}
                  role={m.role}
                  content={m.content}
                  citations={(m as any).citations as any}
                />
              ))}
              {sending && <AssistantThinkingRow />}
            </div>
          )}
        </div>

        {hasThread && (
          <>
            <Separator />
            <form onSubmit={onSubmit} className="p-3 sm:p-4 bg-background">
              <div className="rounded-2xl border border-input bg-background shadow-sm">
                <div className="p-2 sm:p-3 flex items-center gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (canSend) onSubmit();
                      }
                    }}
                    placeholder="Ask anything…"
                    className={`max-h-44 resize-y border-0 focus-visible:ring-0 focus-visible:border-0 px-4 py-2 ${composerTextClass}`}
                  />
                  <Button type="submit" disabled={!canSend} className="min-w-[92px]">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    <span className="ml-2">{sending ? "Sending" : "Send"}</span>
                  </Button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* --- Sidebar, Message, and Helper Components --- */

function LeftSidebar({
  sessions,
  currentId,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: {
  sessions: ConversationMeta[];
  currentId: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState<string>("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const sMap = new Map(sessions.map(s => [s.id, s]));

  return (
    <aside className="hidden sm:flex w-64 border-r flex-col bg-muted/20">
      <div className="p-3 border-b">
        <Button className="w-full justify-start gap-2" onClick={onNew}>
          <PlusCircle className="h-4 w-4" />
          New Search
        </Button>
      </div>
      <div className="p-2 flex-1 overflow-auto">
        <div className="px-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Conversations
        </div>
        <ul className="space-y-1">
          {sessions.length === 0 && (
            <li className="text-xs text-muted-foreground px-2 py-1">No conversations yet</li>
          )}
          {sessions.map((s) => (
            <li key={s.id}>
              <div
                className={[
                  "w-full rounded-lg px-3 py-2 hover:bg-accent/60 transition flex items-start gap-2",
                  s.id === currentId ? "bg-accent/60" : "",
                ].join(" ")}
              >
                <button
                  className="flex-1 text-left flex items-start gap-2 min-w-0"
                  onClick={() => onSelect(s.id)}
                  title={s.title}
                >
                  <MessageSquare className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{s.title || "Untitled"}</div>
                    <div className="text-[11px] text-muted-foreground">{formatTimeAgo(s.updated_at)}</div>
                  </div>
                </button>

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Conversation actions">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      side="right"
                      align="start"
                      className="min-w-[180px] rounded-md border bg-popover p-1 shadow-md z-40 data-[state=open]:animate-in"
                    >
                      <DropdownMenu.Item
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/60 cursor-pointer"
                        onSelect={(e) => {
                          e.preventDefault();
                          setRenameId(s.id);
                          setRenameVal(s.title || "");
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        Rename
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="my-1 h-px bg-border" />
                      <DropdownMenu.Item
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/60 text-destructive cursor-pointer"
                        onSelect={(e) => {
                          e.preventDefault();
                          setDeleteId(s.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Dialog.Root open={!!renameId} onOpenChange={(o) => !o && setRenameId(null)}>
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-popover p-4 shadow-lg">
          <Dialog.Title className="text-base font-medium">Rename conversation</Dialog.Title>
          <div className="mt-3">
            <input
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              autoFocus
              className="w-full rounded-xl border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-black"
              placeholder="Conversation title"
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (renameId) {
                    await onRename(renameId, renameVal.trim() || "Untitled");
                    setRenameId(null);
                  }
                }
              }}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenameId(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (renameId) {
                  await onRename(renameId, renameVal.trim() || "Untitled");
                  setRenameId(null);
                }
              }}
            >
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-popover p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Delete conversation</Dialog.Title>
          <div className="mt-3 text-sm text-muted-foreground">
            Are you sure you want to delete{" "}
            <span className="font-medium text-foreground">
              “{(deleteId && sMap.get(deleteId)?.title) || "Untitled"}”
            </span>
            ? This action cannot be undone.
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (deleteId) {
                  await onDelete(deleteId);
                  setDeleteId(null);
                }
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </aside>
  );
}

function MessageRow({
  role,
  content,
  citations,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  citations?: any;
}) {
  const isUser = role === "user";
  const isSystem = role === "system";

  // Pretty system notice for limits
  if (isSystem) {
    try {
      const data = JSON.parse(content);
      if (data && data.__kind === "limit") {
        return <LimitReachedCard payload={data} />;
      }
    } catch {}
    return (
      <div className="mx-auto max-w-2xl text-center text-xs text-muted-foreground bg-muted rounded-xl px-3 py-2">
        {content}
      </div>
    );
  }

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex items-start gap-3 max-w-[min(80%,720px)] ${isUser ? "flex-row-reverse" : ""}`}
      >
        <Avatar className="size-8">
          <AvatarFallback>{isUser ? "U" : "A"}</AvatarFallback>
        </Avatar>
        <div className="space-y-2">
          <div
            className={[
              "rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed",
              isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border",
            ].join(" ")}
          >
            {content}
          </div>
          {!isUser && !!citations?.length && <CitationList citations={citations as any} />}
        </div>
      </div>
    </div>
  );
}

function AssistantThinkingRow() {
  return (
    <div className="w-full flex justify-start">
      <div className="flex items-start gap-3 max-w-[min(80%,720px)]">
        <Avatar className="size-8">
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
        <div className="space-y-2">
          <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-card border border-border text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Assistant is thinking…</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CitationList({ citations }: { citations: any[] }) {
  return (
    <div className="text-xs text-muted-foreground">
      <ul className="mt-1 ml-5 list-disc space-y-1">
        {citations.map((c, idx) => (
          <li key={idx}>
            <span className="font-medium">{c.title ?? c.doc_id}</span>
            {c.span ? <span className="opacity-80"> — {c.span}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function trimForTitle(s: string) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 45) + "…" : t || "New chat";
}

function formatTimeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function EmptyState({
  heroValue,
  onHeroChange,
  onHeroSubmit,
}: {
  heroValue: string;
  onHeroChange: (v: string) => void;
  onHeroSubmit: () => void;
}) {
  const heroTextClass = "text-left placeholder:text-left leading-[1.4] h-11 py-3";
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="text-center px-6 max-w-3xl w-full">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">
          Welcome to RAG Chat
        </h1>

        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 shadow-sm">
            <Textarea
              value={heroValue}
              onChange={(e) => onHeroChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onHeroSubmit();
                }
              }}
              placeholder="Ask anything…"
              className={`max-h-40 resize-none border-0 focus-visible:ring-0 focus-visible:border-0 px-2 ${heroTextClass}`}
            />
            <Button onClick={onHeroSubmit} disabled={!heroValue.trim()}>
              <Send className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Ask</span>
            </Button>
          </div>
        </div>

        <div className="mt-6 text-left mx-auto max-w-2xl space-y-3">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-1 shrink-0" />
            <p className="text-sm">
              <span className="font-medium">How it works:</span> your question is embedded and matched against your uploaded docs, then the assistant answers with citations.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-1 shrink-0" />
            <p className="text-sm">
              <span className="font-medium">Upload files:</span> drag & drop PDFs, docs, or text into the knowledge area (left menu) to make them searchable.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-1 shrink-0" />
            <p className="text-sm">
              <span className="font-medium">Tips:</span> be specific; include file names or sections when possible; follow-ups refine the context.
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to send,&nbsp;
            <kbd className="px-1 py-0.5 bg-muted rounded">Shift</kbd>+
            <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> for a new line.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Friendly card shown when monthly chat/message limit is hit (HTTP 429). */
function LimitReachedCard({ payload }: { payload: any }) {
  const lim: LimitsMe | null = payload?.limits || null;
  const plan = lim?.plan || "FREE";
  const cap = lim?.caps?.messages ?? null;
  const used = lim?.usage?.messages ?? null;
  const remaining = lim?.remaining?.messages ?? null;
  const periodEnd = lim?.period?.end_ts ? new Date(lim.period.end_ts * 1000) : null;
  const resetsText = lim?.window === "infinite"
    ? "Free plan quotas don't auto‑reset monthly."
    : periodEnd
      ? `Resets on ${periodEnd.toLocaleString()}`
      : "";

  return (
    <div className="mx-auto max-w-2xl w-full">
      <div className="rounded-2xl border bg-card shadow-sm p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <AlertCircle className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">You've reached your monthly chat limit</div>
            <div className="text-xs text-muted-foreground mt-1">
              Your current plan: <span className="inline-flex items-center gap-1 font-medium">{plan === "PRO" ? <Crown className="h-3.5 w-3.5" /> : null}{plan}</span>.
              {resetsText ? <> {resetsText}</> : null}
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-xl border bg-background p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Gauge className="h-3.5 w-3.5" /> Messages used
                </div>
                <div className="text-sm font-medium mt-1">{used ?? "—"} {cap != null ? <>/ {cap}</> : null}</div>
              </div>
              <div className="rounded-xl border bg-background p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Remaining</div>
                <div className="text-sm font-medium mt-1">{remaining ?? "0"}</div>
              </div>
              <div className="rounded-xl border bg-background p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Uploads this month</div>
                <div className="text-sm font-medium mt-1">{lim?.usage?.upload_tokens ?? "—"} / {lim?.caps?.upload_tokens ?? "—"}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <a href="/billing">
                <Button>Upgrade to Pro</Button>
              </a>
              <a href="/billing">
                <Button variant="outline">View usage</Button>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
