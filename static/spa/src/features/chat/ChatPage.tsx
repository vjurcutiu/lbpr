// src/features/chat/ChatPage.tsx
import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { Send, Loader2, PlusCircle, MessageSquare, MoreVertical, Pencil, Trash2, Info, AlertCircle, Crown, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import * as chatApi from "./api";
import { ApiError } from "./api";
import {
  appendMessage,
  createConversation,
  ensureConversation,
  hasCachedMessages,
  renameConversation,
  subscribeConversations,
  subscribeMessages,
  deleteConversation,
} from "./chatStore";
import type { ChatTurn, ConversationMeta, Citation as TurnCitation } from "./types";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { loadBool, saveBool } from "@/shared/persist";
import { useAuthContext } from "@/features/auth/AuthProvider";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// Markdown rendering for assistant messages
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  caps: { messages: number; file_processing_tokens?: number; upload_tokens: number; workflow_tokens?: number };
  usage: { messages: number; file_processing_tokens?: number; upload_tokens: number; workflow_tokens?: number };
  remaining: { messages: number; file_processing_tokens?: number; upload_tokens: number; workflow_tokens?: number };
};


function fileProcessingValue(bucket: { file_processing_tokens?: number; upload_tokens?: number } | null | undefined): number {
  return Number(bucket?.file_processing_tokens ?? bucket?.upload_tokens ?? 0);
}

function workflowTokensValue(bucket: { workflow_tokens?: number } | null | undefined): number {
  return Number(bucket?.workflow_tokens ?? 0);
}

async function fetchLimits(): Promise<LimitsMe | null> {
  try {
    const res = await fetch("/api/limits/me", { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as LimitsMe;
  } catch {
    return null;
  }
}

// Build a storage key for the "assistant is typing" persisted flag
function typingKey(ns: string, id: string) {
  return `chat:pending:${ns}:${id}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<RenderMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamEnabled] = useState(false);

  // Persisted "assistant is typing" flag (survives route changes)
  const [persistedTyping, setPersistedTyping] = useState(false);
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);

  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const { namespace } = useNamespace();
  const listRef = useRef<HTMLDivElement>(null);
  const chatShellRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(296);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const canSend = input.trim().length > 0 && !sending;

  const { user, loading } = useAuthContext();
  const uid = user?.uid || null;

  // Derive a per-user effective namespace
  const effectiveNs = useMemo(() => {
    return uid ? `u:${uid}:${namespace}` : `anon:${namespace}`;
  }, [uid, namespace]);

  // Keep the conversation list live and resilient to auth/session refreshes.
  useEffect(() => {
    if (loading) return;
    if (!uid) {
      setSessions([]);
      setSessionId(null);
      setMessages([]);
      setPersistedTyping(false);
      setLoadingThreadId(null);
      return;
    }

    const unsub = subscribeConversations(effectiveNs, (convs) => {
      setSessions(convs);
      setSessionId((current) => {
        if (current && convs.some((c) => c.id === current)) return current;
        return convs[0]?.id || null;
      });
    });

    return () => unsub();
  }, [effectiveNs, loading, uid]);

  // Subscribe message thread for selected session
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setPersistedTyping(false);
      setLoadingThreadId(null);
      return;
    }
    const hasCachedThread = hasCachedMessages(effectiveNs, sessionId);
    setLoadingThreadId(hasCachedThread ? null : sessionId);
    const unsub = subscribeMessages(effectiveNs, sessionId, (msgs, meta) => {
      setMessages(msgs.map((m, i) => ({ ...m, id: `${i}` })));
      if (meta.source !== "cache" || meta.hasCache) {
        setLoadingThreadId((current) => (current === sessionId ? null : current));
      }
      // If any non-user message arrives while we thought the assistant was typing, clear the persisted flag.
      const last = msgs[msgs.length - 1];
      if (last && last.role !== "user") {
        const k = typingKey(effectiveNs, sessionId);
        if (loadBool(k, false)) {
          saveBool(k, false);
          setPersistedTyping(false);
        }
      }
      queueMicrotask(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      });
    });
    // restore "assistant is typing" flag for this thread
    setPersistedTyping(loadBool(typingKey(effectiveNs, sessionId), false));
    return () => unsub();
  }, [effectiveNs, sessionId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [sending]);

  useEffect(() => {
    if (!isSidebarResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (event: MouseEvent) => {
      const shellRect = chatShellRef.current?.getBoundingClientRect();
      const shellLeft = shellRect?.left ?? 0;
      const shellWidth = shellRect?.width ?? window.innerWidth;
      const minSidebar = 240;
      const maxSidebar = Math.min(520, Math.max(minSidebar, shellWidth - 360));
      const nextWidth = event.clientX - shellLeft;
      setSidebarWidth(Math.min(maxSidebar, Math.max(minSidebar, nextWidth)));
    };

    const onUp = () => setIsSidebarResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isSidebarResizing]);

  const historyForRequest: chatApi.ChatTurn[] = useMemo(
    () => messages.map((m) => ({ role: m.role, content: m.content })),
    [messages]
  );

  const startNewSearch = useCallback(async () => {
    try {
      const id = await createConversation(effectiveNs, "New chat");
      setSessionId(id);
      setMessages([]);
      setInput("");
      setPersistedTyping(false);
      setLoadingThreadId(null);
    } catch (e) {
      console.error("[chat] createConversation error", e);
    }
  }, [effectiveNs]);

  const switchSession = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      setLoadingThreadId(hasCachedMessages(effectiveNs, id) ? null : id);
      setSessionId(id);
      setInput("");
      // refresh persisted flag for the selected session
      setPersistedTyping(loadBool(typingKey(effectiveNs, id), false));
    },
    [sessionId, effectiveNs]
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

      // Mark assistant-typing as *persisted* so it survives route changes
      saveBool(typingKey(effectiveNs, convId), true);
      setPersistedTyping(true);

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
        citations: res.citations ?? [], // kept in payload for debugging/telemetry, not rendered
        created_at: new Date().toISOString(),
        trace_id: (res as any).__trace_id,
        request_id: (res as any).__request_id ?? null,
      } as any;

      await appendMessage(effectiveNs, convId, assistantMsg);

      // Clear persisted typing flag now that a reply arrived
      saveBool(typingKey(effectiveNs, convId), false);
      setPersistedTyping(false);

      if (messages.length === 0) {
        const title = trimForTitle(userMsg.content);
        await renameConversation(effectiveNs, convId, title);
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
  const isThreadLoading = !!sessionId && loadingThreadId === sessionId;
  // Smaller composer font + height (chat window only)
  const composerTextClass = "text-left placeholder:text-left text-[14px] leading-[1.35] h-11 py-2.5";
  const isAssistantTyping = sending || persistedTyping;

  return (
    <div ref={chatShellRef} className="h-full w-full overflow-hidden flex">
      <LeftSidebar
        width={sidebarWidth}
        sessions={sessions}
        currentId={sessionId || ""}
        onNew={startNewSearch}
        onSelect={switchSession}
        onRename={async (id, title) => {
          await renameConversation(effectiveNs, id, title);
        }}
        onDelete={async (id) => {
          await deleteConversation(effectiveNs, id);
          if (id === sessionId) {
            setMessages([]);
            setPersistedTyping(false);
          }
        }}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation list"
        onMouseDown={(event) => {
          event.preventDefault();
          setIsSidebarResizing(true);
        }}
        className={`hidden sm:block w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/20 ${isSidebarResizing ? "bg-primary/30" : ""}`}
        title="Drag to resize"
      />

      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <div ref={listRef} className="flex-1 overflow-auto bg-background">
          {isThreadLoading ? (
            <ConversationLoadingState />
          ) : !hasThread ? (
            <EmptyState
              heroValue={input}
              onHeroChange={setInput}
              onHeroSubmit={() => onSubmit()}
            />
          ) : (
            <div className="px-3.5 sm:px-5 py-5 space-y-5">
              {messages.map((m, idx) => (
                <MessageRow
                  key={m.id || String(idx)}
                  role={m.role}
                  content={m.content}
                  citations={(m as any).citations}
                />
              ))}
              {isAssistantTyping && <AssistantThinkingRow />}
            </div>
          )}
        </div>

        {hasThread && (
          <>
            <Separator />
            <form onSubmit={onSubmit} className="border-t border-border/70 bg-background/95 p-3 sm:p-4 supports-[backdrop-filter]:bg-background/80">
              <div className="rounded-2xl border border-border bg-card shadow-sm">
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
                  <Button type="submit" disabled={!canSend} className="min-w-[88px]">
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
  width,
  sessions,
  currentId,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: {
  width: number;
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
    <aside
      className="hidden min-w-0 shrink-0 flex-col border-r border-border/70 bg-gradient-to-b from-background via-background to-muted/20 backdrop-blur-xl sm:flex dark:from-background dark:via-background dark:to-muted/10"
      style={{ width }}
    >
      <div className="border-b border-border/70 px-3 py-3.5">
        <Button
          className="h-11 w-full justify-start gap-2 rounded-2xl border border-[hsl(var(--chat-action-border))] bg-[hsl(var(--chat-action-bg))] px-4 text-sm font-semibold text-[hsl(var(--chat-action-foreground))] shadow-sm transition hover:bg-[hsl(var(--chat-action-bg-hover))] hover:text-[hsl(var(--chat-action-foreground-strong))]"
          onClick={onNew}
        >
          <PlusCircle className="h-4 w-4" />
          New Search
        </Button>
      </div>
      <div className="flex-1 overflow-auto px-3 py-3">
        <div className="mb-3 px-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Conversations</div>
          <div className="mt-1 text-xs text-muted-foreground">Recent chats and saved threads</div>
        </div>
        <ul className="space-y-1">
          {sessions.length === 0 && (
            <li className="rounded-2xl border border-dashed border-border bg-card/70 px-3 py-4 text-xs text-muted-foreground">No conversations yet</li>
          )}
          {sessions.map((s) => (
            <li key={s.id}>
              <div
                className={[
                  "group w-full rounded-2xl border px-3 py-3 transition flex items-start gap-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:shadow-[0_10px_24px_rgba(0,0,0,0.18)]",
                  s.id === currentId
                    ? "border-[hsl(var(--chat-sidebar-active-border))] bg-[hsl(var(--chat-sidebar-active-bg))] shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
                    : "border-transparent bg-card/45 hover:border-border hover:bg-card/80 dark:bg-card/30",
                ].join(" ")}
              >
                <button
                  className="flex-1 text-left flex items-start gap-3 min-w-0"
                  onClick={() => onSelect(s.id)}
                  title={s.title}
                >
                  <span className={[
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border",
                    s.id === currentId ? "border-[hsl(var(--chat-sidebar-active-border))] bg-[hsl(var(--chat-action-bg))] text-[hsl(var(--chat-action-foreground-strong))]" : "border-border/70 bg-background text-muted-foreground group-hover:text-foreground",
                  ].join(" ")}>
                    <MessageSquare className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div
                      className={[
                        "truncate text-sm font-medium",
                        s.id === currentId
                          ? "text-[hsl(var(--chat-sidebar-title-active))]"
                          : "text-[hsl(var(--chat-sidebar-title))] group-hover:text-[hsl(var(--chat-sidebar-title-active))]",
                      ].join(" ")}
                    >
                      {s.title || "Untitled"}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">Updated {formatTimeAgo(s.updated_at)}</div>
                  </div>
                </button>

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Conversation actions">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      side="right"
                      align="start"
                      className="z-40 min-w-[190px] rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_20px_50px_rgba(15,23,42,0.16)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.35)] data-[state=open]:animate-in"
                    >
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-foreground outline-none hover:bg-muted"
                        onSelect={(e) => {
                          e.preventDefault();
                          setRenameId(s.id);
                          setRenameVal(s.title || "");
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        Rename
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="my-1 h-px bg-border/70" />
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-rose-600 outline-none hover:bg-rose-50 dark:hover:bg-rose-950/30"
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

      <Dialog open={!!renameId} onOpenChange={(open) => !open && setRenameId(null)}>
        <DialogContent className="max-w-md rounded-3xl border border-border bg-background p-0 shadow-[0_32px_80px_rgba(15,23,42,0.18)] dark:shadow-[0_36px_96px_rgba(0,0,0,0.45)]">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (renameId) {
                await onRename(renameId, renameVal.trim() || "Untitled");
                setRenameId(null);
              }
            }}
          >
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="text-base font-semibold">Rename conversation</DialogTitle>
              <DialogDescription>
                Give this chat a clearer name so it is easier to find later.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 py-2">
              <input
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                autoFocus
                className="w-full rounded-2xl border border-input bg-background px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-ring/50"
                placeholder="Conversation title"
              />
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button type="button" variant="outline" onClick={() => setRenameId(null)}>Cancel</Button>
              <Button type="submit">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="max-w-md rounded-3xl border border-border bg-background p-0 shadow-[0_32px_80px_rgba(15,23,42,0.18)] dark:shadow-[0_36px_96px_rgba(0,0,0,0.45)]">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (deleteId) {
                await onDelete(deleteId);
                setDeleteId(null);
              }
            }}
          >
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="text-base font-semibold">Delete conversation</DialogTitle>
              <DialogDescription>
                This permanently removes the selected chat and its local message history.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 py-2 text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                “{(deleteId && sMap.get(deleteId)?.title) || "Untitled"}”
              </span>
              ? This action cannot be undone.
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button type="button" variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button
                type="submit"
                variant="destructive"
                autoFocus
              >
                Delete
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
  citations?: TurnCitation[];
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
      <div className="mx-auto max-w-2xl rounded-2xl border border-[hsl(var(--chat-system-border))] bg-[hsl(var(--chat-system-bg))] px-3.5 py-2.5 text-center text-xs font-medium text-[hsl(var(--chat-system-foreground))] shadow-sm">
        {content}
      </div>
    );
  }

  // Bubble shared styles — slightly smaller type and paddings
  const bubbleBase =
    "rounded-[22px] px-4 py-3.5 text-[14px] leading-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:shadow-[0_14px_38px_rgba(0,0,0,0.28)]";
  const bubbleUser = "border border-[hsl(var(--chat-user-border))] bg-[hsl(var(--chat-user-bg))] text-[hsl(var(--chat-user-foreground))] whitespace-pre-wrap";
  const bubbleAssistant = "border border-border bg-card text-card-foreground";

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex items-start gap-3.5 max-w-[min(82%,820px)] ${isUser ? "flex-row-reverse" : ""}`}
      >
        <Avatar className="mt-0.5 size-8 border border-border/80 bg-card shadow-sm">
          <AvatarFallback className={isUser ? "bg-[hsl(var(--chat-action-bg))] text-[hsl(var(--chat-action-foreground-strong))]" : "bg-primary/10 text-primary"}>{isUser ? "U" : "A"}</AvatarFallback>
        </Avatar>
        <div className="space-y-2">
          <div
            className={[
              bubbleBase,
              isUser ? bubbleUser : bubbleAssistant,
            ].join(" ")}
          >
            {isUser ? (
              content
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ node, className, href, children, ...props }) => {
                    if (href && href.startsWith("#cite-")) {
                      const n = parseInt(href.replace("#cite-", ""), 10);
                      return (
                        <CitationPopover index={Number.isFinite(n) ? n : 0} citations={citations}>
                          {children}
                        </CitationPopover>
                      );
                    }
                    return (
                      <a
                        {...props}
                        href={href}
                        className={["underline decoration-border underline-offset-4 transition hover:decoration-foreground", className].filter(Boolean).join(" ")}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {children}
                      </a>
                    );
                  },
                  p: ({node, className, ...props}) => (
                    <p {...props} className={["my-3 text-[14px] leading-6", className].filter(Boolean).join(" ")} />
                  ),
                  ul: ({node, className, ...props}) => (
                    <ul {...props} className={["my-3 ml-5 list-disc space-y-1", className].filter(Boolean).join(" ")} />
                  ),
                  ol: ({node, className, ...props}) => (
                    <ol {...props} className={["my-3 ml-5 list-decimal space-y-1", className].filter(Boolean).join(" ")} />
                  ),
                  li: ({node, className, ...props}) => (
                    <li {...props} className={["pl-1", className].filter(Boolean).join(" ")} />
                  ),
                  blockquote: ({node, className, ...props}) => (
                    <blockquote {...props} className={["my-3 rounded-r-2xl border-l-2 border-border bg-muted/60 py-1 pl-3 italic text-muted-foreground", className].filter(Boolean).join(" ")} />
                  ),
                  code: ({inline, className, children, ...props}) => {
                    if (inline) {
                      return <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[13px] text-foreground">{children}</code>;
                    }
                    return (
                      <pre className="overflow-auto rounded-2xl border border-border bg-muted/70 p-3 text-[13px] leading-6">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    );
                  },
                  table: ({node, className, ...props}) => (
                    <div className="overflow-x-auto my-3">
                      <table {...props} className={["min-w-full border-collapse text-sm", className].filter(Boolean).join(" ")} />
                    </div>
                  ),
                  th: ({node, className, ...props}) => <th {...props} className={["border border-border bg-muted px-2 py-1 text-left font-semibold text-foreground", className].filter(Boolean).join(" ")} />,
                  td: ({node, className, ...props}) => <td {...props} className={["border border-border px-2 py-1 align-top", className].filter(Boolean).join(" ")} />,
                  h1: ({node, className, ...props}) => <h1 {...props} className={["text-lg font-semibold mt-2 mb-1", className].filter(Boolean).join(" ")} />,
                  h2: ({node, className, ...props}) => <h2 {...props} className={["text-base font-semibold mt-2 mb-1", className].filter(Boolean).join(" ")} />,
                  h3: ({node, className, ...props}) => <h3 {...props} className={["text-sm font-semibold mt-2 mb-1", className].filter(Boolean).join(" ")} />,
                  hr: ({node, className, ...props}) => <hr {...props} className={["my-4 border-muted", className].filter(Boolean).join(" ")} />,
                }}
              >
                {linkifyCitationsMarkdown(content)}
              </ReactMarkdown>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CitationPopover({
  index,
  citations,
  children,
}: {
  index: number;
  citations?: TurnCitation[];
  children: ReactNode;
}) {
  const c = pickCitationByIndex(index, citations);
  const fileLabel =
    c?.file?.display_name || c?.file?.filename || c?.title || c?.doc_id || (index ? `Source ${index}` : "Source");
  const folderPath = c?.file?.folder_path;
  const snippet = (c?.snippet || "").trim() || (c?.span ? `Span: ${c.span}` : "");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 align-baseline text-[11px] font-semibold text-muted-foreground shadow-sm transition hover:border-border hover:bg-card hover:text-foreground"
          aria-label={index ? `Open citation ${index}` : "Open citation"}
          onClick={(e) => {
            // Keep the click local to the citation trigger.
            // NOTE: do NOT call preventDefault() here — Radix Popover relies on the click event.
            e.stopPropagation();
          }}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-[0_20px_60px_rgba(15,23,42,0.16)] dark:shadow-[0_24px_72px_rgba(0,0,0,0.4)]">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {index ? `Source [${index}]` : "Source"}
          </div>
          <div className="rounded-2xl border border-border bg-muted/60 px-3 py-2 text-xs">
            <div className="font-medium break-words text-foreground">{fileLabel}</div>
            {folderPath ? <div className="mt-1 break-words text-[11px] text-muted-foreground">{folderPath}</div> : null}
          </div>

          <div className="max-h-64 overflow-auto rounded-2xl border border-border bg-card p-3">
            <div className="text-xs whitespace-pre-wrap leading-5 text-foreground/90">
              {snippet || "No snippet available."}
            </div>
          </div>

          {c?.score != null ? (
            <div className="text-[11px] text-muted-foreground">Similarity: {Number(c.score).toFixed(3)}</div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function pickCitationByIndex(index: number, citations?: TurnCitation[]) {
  if (!index || !citations || citations.length === 0) return undefined;
  // Prefer explicit index match (new backend)
  const direct = citations.find((x: any) => Number((x as any).index) === index);
  if (direct) return direct as any;
  // Fallback: assume array order matches indices
  return citations[index - 1];
}

function linkifyCitationsMarkdown(md: string) {
  if (!md) return md;

  // Avoid rewriting inside fenced code blocks and inline code spans.
  const fenceParts = md.split("```");
  for (let i = 0; i < fenceParts.length; i++) {
    if (i % 2 === 1) continue; // inside fenced code
    const inlineParts = fenceParts[i].split("`");
    for (let j = 0; j < inlineParts.length; j++) {
      if (j % 2 === 1) continue; // inside inline code
      inlineParts[j] = inlineParts[j].replace(/\[(\d{1,3})\]/g, (_m, n) => `[\\[${n}\\]](#cite-${n})`);
    }
    fenceParts[i] = inlineParts.join("`");
  }
  return fenceParts.join("```");
}

function AssistantThinkingRow() {
  return (
    <div className="w-full flex justify-start">
      <div className="flex items-start gap-3.5 max-w-[min(82%,760px)]">
        <Avatar className="mt-0.5 size-8 border border-border/80 bg-card shadow-sm">
          <AvatarFallback className="bg-primary/10 text-primary">A</AvatarFallback>
        </Avatar>
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-[22px] border border-border bg-card px-4 py-3 text-[13px] leading-6 text-muted-foreground shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:shadow-[0_14px_38px_rgba(0,0,0,0.28)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Assistant is thinking…</span>
          </div>
        </div>
      </div>
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
        <h1 className="mb-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Welcome to LexBot PRO
        </h1>

        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm">
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
            <p className="text-sm text-foreground/90">
              <span className="font-medium">How it works:</span> your question is embedded and matched against your uploaded docs, then the assistant answers with citations.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-1 shrink-0" />
            <p className="text-sm text-foreground/90">
              <span className="font-medium">Upload files:</span> drag & drop PDFs, docs, or text into the knowledge area (left menu) to make them searchable.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-1 shrink-0" />
            <p className="text-sm text-foreground/90">
              <span className="font-medium">Tips:</span> be specific; include file names or sections when possible; follow-ups refine the context.
            </p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to send,&nbsp;
            <kbd className="px-1 py-0.5 bg-muted rounded">Shift</kbd>+
            <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> for a new line.
          </p>
        </div>
      </div>
    </div>
  );
}

function ConversationLoadingState() {
  return (
    <div
      className="flex h-full min-h-[22rem] items-center justify-center px-4 py-8"
      aria-label="Loading conversation"
      role="status"
    >
      <div className="w-full max-w-3xl rounded-[28px] border border-border/80 bg-card/80 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-3 border-b border-border/70 pb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[hsl(var(--chat-action-border))] bg-[hsl(var(--chat-action-bg))] text-[hsl(var(--chat-action-foreground-strong))] shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">Opening conversation</div>
            <div className="mt-1 text-xs text-muted-foreground">Loading the saved thread before we swap the view.</div>
          </div>
        </div>

        <div className="space-y-4 pt-5">
          <div className="flex justify-end">
            <div className="h-16 w-[68%] animate-pulse rounded-3xl border border-[hsl(var(--chat-user-border))] bg-[hsl(var(--chat-user-bg))]/80" />
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-1 h-9 w-9 shrink-0 animate-pulse rounded-2xl border border-border/70 bg-muted/70" />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="h-20 w-[88%] animate-pulse rounded-3xl border border-border/70 bg-muted/60" />
              <div className="h-16 w-[72%] animate-pulse rounded-3xl border border-border/70 bg-muted/50" />
            </div>
          </div>
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

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
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
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">File uploads this month</div>
                <div className="text-sm font-medium mt-1">{String(fileProcessingValue(lim?.usage))} / {String(fileProcessingValue(lim?.caps))}</div>
              </div>
              <div className="rounded-xl border bg-background p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Workflows this month</div>
                <div className="text-sm font-medium mt-1">{String(workflowTokensValue(lim?.usage))} / {String(workflowTokensValue(lim?.caps))}</div>
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
