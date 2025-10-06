// src/features/chat/ChatPage.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Paperclip, Send, Loader2, Trash2, PlusCircle, LinkIcon, Bug, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import * as chatApi from "./api";
import { listFiles } from "@/features/files/api";

type FileItem = { id: string; name: string; size: number; created_at?: string };

function useTenantId() {
  return "tenant_demo";
}

const STARTER_SUGGESTIONS = [
  "Summarize the latest PRs in the repo",
  "Explain our RAG architecture in 3 bullets",
  "Generate unit tests for the auth service",
  "What should we log for chat retries?"
];

type RenderMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: chatApi.Citation[];
  created_at?: string;
  trace_id?: string | null;
  request_id?: string | null;
};

type SessionMeta = { id: string; title: string; updated_at: string };

const SESSIONS_KEY = "lbp_chat_sessions";
const SESSION_DATA_PREFIX = "lbp_chat_session_";

export default function ChatPage() {
  const [messages, setMessages] = useState<RenderMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [streamEnabled] = useState(false);
  const [showHud, setShowHud] = useState(false);

  const [sessions, setSessions] = useState<SessionMeta[]>(() => loadSessions());
  const [sessionId, setSessionId] = useState<string>(() => createSessionIfNone(loadSessions()));

  const listRef = useRef<HTMLDivElement>(null);
  const tenantId = useTenantId();

  const hasThread = messages.length > 0;
  const canSend = input.trim().length > 0 && !sending;

  // ---- storage helpers ----
  function loadSessions(): SessionMeta[] {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as SessionMeta[];
    } catch {
      return [];
    }
  }

  function saveSessions(next: SessionMeta[]) {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
  }

  function saveSessionData(id: string, msgs: RenderMessage[]) {
    localStorage.setItem(SESSION_DATA_PREFIX + id, JSON.stringify(msgs));
  }

  function loadSessionData(id: string): RenderMessage[] {
    try {
      const raw = localStorage.getItem(SESSION_DATA_PREFIX + id);
      if (!raw) return [];
      return JSON.parse(raw) as RenderMessage[];
    } catch {
      return [];
    }
  }

  function createSessionIfNone(existing: SessionMeta[]) {
    if (existing.length > 0) return existing[0].id;
    const id = cryptoRandomId();
    const meta: SessionMeta = {
      id,
      title: "New chat",
      updated_at: new Date().toISOString(),
    };
    const next = [meta];
    saveSessions(next);
    saveSessionData(id, []);
    return id;
  }

  const startNewSearch = useCallback(() => {
    const id = cryptoRandomId();
    const meta: SessionMeta = {
      id,
      title: "New chat",
      updated_at: new Date().toISOString(),
    };
    const next = [meta, ...sessions].slice(0, 50);
    setSessions(next);
    saveSessions(next);
    saveSessionData(id, []);
    setSessionId(id);
    setMessages([]);
    setSelectedFileIds([]);
    setInput("");
  }, [sessions]);

  const switchSession = useCallback((id: string) => {
    if (id === sessionId) return;
    setSessionId(id);
    const msgs = loadSessionData(id);
    setMessages(msgs);
    setSelectedFileIds([]);
    setInput("");
  }, [sessionId]);

  // ---- effects ----
  useEffect(() => {
    listFiles().then(setFiles).catch(() => {});
  }, []);

  // load current session messages on mount / session change
  useEffect(() => {
    const msgs = loadSessionData(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  // persist messages to session
  useEffect(() => {
    saveSessionData(sessionId, messages);
    // update session title from first user message
    if (messages.length > 0) {
      const firstUser = messages.find(m => m.role === "user");
      const title = firstUser ? trimForTitle(firstUser.content) : "New chat";
      const updated_at = new Date().toISOString();
      setSessions(prev => {
        const next = [
          { id: sessionId, title, updated_at },
          ...prev.filter(s => s.id !== sessionId),
        ];
        saveSessions(next);
        return next;
      });
    }
  }, [messages, sessionId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const toggleAttach = (id: string) => {
    setSelectedFileIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const onPickSuggestion = (s: string) => {
    setInput(s);
  };

  const historyForRequest: chatApi.ChatTurn[] = useMemo(
    () => messages.map(m => ({ role: m.role, content: m.content })),
    [messages]
  );

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;

    const attachmentNote =
      selectedFileIds.length > 0
        ? `\\n\\n[Attached files: ${selectedFileIds.join(", ")}]`
        : "";

    const userMsg: RenderMessage = {
      id: cryptoRandomId(),
      role: "user",
      content: input.trim() + attachmentNote,
      created_at: new Date().toISOString(),
      trace_id: null,
      request_id: null,
    };

    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    const traceId = cryptoRandomId();
    console.debug("[chat.ui] sending", { traceId, tenantId, len: userMsg.content.length });

    try {
      const req: chatApi.ChatRequest = {
        tenant_id: tenantId,
        message: userMsg.content,
        history: historyForRequest,
        stream: streamEnabled,
      };

      const res = await chatApi.sendChat(req, traceId);

      const assistantMsg: RenderMessage = {
        id: cryptoRandomId(),
        role: "assistant",
        content: res.answer,
        citations: res.citations ?? [],
        created_at: new Date().toISOString(),
        trace_id: (res as any).__trace_id,
        request_id: (res as any).__request_id ?? null,
      };

      setMessages(prev => [...prev, assistantMsg]);
      setInput("");
      console.debug("[chat.ui] ok", {
        traceId: assistantMsg.trace_id,
        requestId: assistantMsg.request_id,
        retrieved: res.usage?.retrieved,
        dur_ms: (res as any).__dur_ms,
        status: (res as any).__status,
      });
    } catch (err: any) {
      const errMsg: RenderMessage = {
        id: cryptoRandomId(),
        role: "system",
        content: (err?.message || "Failed to send message") + (traceId ? ` (trace ${traceId})` : ""),
        trace_id: traceId,
        request_id: null,
      };
      setMessages(prev => [...prev, errMsg]);
      console.error("[chat.ui] error", { traceId, err });
    } finally {
      setSending(false);
    }
  };

  const clear = () => {
    setMessages([]);
    setSelectedFileIds([]);
    setInput("");
  };

  // ---- full-bleed layout (fills AppShell main) ----
  return (
    <div className="h-full w-full overflow-hidden flex">
      <LeftSidebar
        sessions={sessions}
        currentId={sessionId}
        onNew={startNewSearch}
        onSelect={switchSession}
      />

      {/* Ensure this column can shrink and avoid creating a page scrollbar */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="font-medium">LBP Assistant</div>
          <Button variant="ghost" size="sm" onClick={() => setShowHud(s => !s)} title="Toggle debug HUD">
            <Bug className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Debug</span>
          </Button>
        </div>

        {showHud && <DebugHud last={messages.filter(m => m.role === "assistant").slice(-1)[0]} />}

        {/* Scrollable thread */}
        <div ref={listRef} className="flex-1 overflow-auto">
          {!hasThread ? (
            <EmptyState
              suggestions={STARTER_SUGGESTIONS}
              onPick={onPickSuggestion}
              heroValue={input}
              onHeroChange={setInput}
              onHeroSubmit={() => onSubmit()}
            />
          ) : (
            <div className="px-4 sm:px-6 py-6 space-y-6">
              {messages.map(m => (
                <MessageRow key={m.id} role={m.role} content={m.content} citations={m.citations} />
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Composer stays pinned inside the column; no need for page scroll */}
        <form onSubmit={onSubmit} className="p-3 sm:p-4 bg-background">
          <div className="rounded-2xl border border-input bg-background shadow-sm">
            {selectedFileIds.length > 0 && (
              <div className="px-3 py-2 flex flex-wrap gap-2 border-b border-input bg-secondary/50">
                {selectedFileIds.map(fid => {
                  const f = files.find(x => x.id === fid);
                  return (
                    <span
                      key={fid}
                      className="pill px-2 py-1 text-xs text-muted-foreground bg-background rounded-md"
                      title={f?.name}
                    >
                      {f?.name ?? fid}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="p-2 sm:p-3 flex items-end gap-2">
              <AttachPopover files={files} selected={selectedFileIds} toggle={toggleAttach} />
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
                className="min-h-[52px] max-h-44 resize-y border-0 focus-visible:ring-0 focus-visible:border-0 px-0"
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={clear} title="Clear chat">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button type="submit" disabled={!canSend} className="min-w-[92px]">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <span className="ml-2">{sending ? "Sending" : "Send"}</span>
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function LeftSidebar({
  sessions,
  currentId,
  onNew,
  onSelect,
}: {
  sessions: SessionMeta[];
  currentId: string;
  onNew: () => void;
  onSelect: (id: string) => void;
}) {
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
              <button
                className={[
                  "w-full text-left rounded-lg px-3 py-2 hover:bg-accent/60 transition flex items-start gap-2",
                  s.id === currentId ? "bg-accent/60" : ""
                ].join(" ")}
                onClick={() => onSelect(s.id)}
                title={s.title}
              >
                <MessageSquare className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-sm">{s.title || "Untitled"}</div>
                  <div className="text-[11px] text-muted-foreground">{formatTimeAgo(s.updated_at)}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function DebugHud({ last }: { last?: RenderMessage }) {
  if (!last) return null;
  return (
    <div className="px-4 py-2 text-xs text-muted-foreground border-b bg-muted/30">
      <div>Last trace: <span className="font-mono">{last.trace_id || "-"}</span></div>
      <div>Last request: <span className="font-mono">{last.request_id || "-"}</span></div>
    </div>
  );
}

function EmptyState({
  suggestions,
  onPick,
  heroValue,
  onHeroChange,
  onHeroSubmit,
}: {
  suggestions: string[];
  onPick: (s: string) => void;
  heroValue: string;
  onHeroChange: (v: string) => void;
  onHeroSubmit: () => void;
}) {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="text-center px-6 max-w-3xl w-full">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">
          What’s on your mind today?
        </h1>

        {/* Hero search/prompt bar */}
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
              className="min-h-[44px] max-h-40 resize-none border-0 focus-visible:ring-0 focus-visible;border-0 px-0"
            />
            <Button onClick={onHeroSubmit} disabled={!heroValue.trim()}>
              <Send className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Ask</span>
            </Button>
          </div>
        </div>

        {/* Suggestions */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {suggestions.map((s) => (
            <button
              key={s}
              className="text-left card hover:shadow-md transition-shadow rounded-xl p-3"
              onClick={() => onPick(s)}
              type="button"
            >
              <span className="text-sm">{s}</span>
            </button>
          ))}
        </div>

        {/* Small note */}
        <p className="text-muted-foreground mt-3 text-xs">
          Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to send, <kbd className="px-1 py-0.5 bg-muted rounded">Shift</kbd>+<kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> for a new line.
        </p>
      </div>
    </div>
  );
}

function MessageRow({
  role,
  content,
  citations,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  citations?: chatApi.Citation[];
}) {
  const isUser = role === "user";
  const isSystem = role === "system";

  if (isSystem) {
    return (
      <div className="mx-auto max-w-2xl text-center text-xs text-muted-foreground bg-muted rounded-xl px-3 py-2">
        {content}
      </div>
    );
  }

  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex items-start gap-3 max-w-[min(80%,720px)] ${isUser ? "flex-row-reverse" : ""}`}>
        <Avatar className="size-8">
          <AvatarFallback>{isUser ? "U" : "A"}</AvatarFallback>
        </Avatar>
        <div className="space-y-2">
          <div
            className={[
              "rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border"
            ].join(" ")}
          >
            {content}
          </div>
          {!isUser && !!citations?.length && (
            <CitationList citations={citations} />
          )}
        </div>
      </div>
    </div>
  );
}

function CitationList({ citations }: { citations: chatApi.Citation[] }) {
  return (
    <div className="text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <LinkIcon className="h-3 w-3" />
        <span>Citations</span>
      </div>
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

function AttachPopover({
  files,
  selected,
  toggle,
}: {
  files: FileItem[];
  selected: string[];
  toggle: (id: string) => void;
}) {
  return (
    <div className="relative">
      <details className="group">
        <summary className="list-none">
          <Button type="button" variant="outline" title="Attach files">
            <Paperclip className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Attach</span>
          </Button>
        </summary>
        <div className="absolute z-10 mt-2 w-72 max-h-64 overflow-auto rounded-xl border bg-popover p-2 shadow-md">
          {files.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">
              No files yet. Upload some on the Files page.
            </div>
          ) : (
            <div className="space-y-1">
              {files.map((f) => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 text-sm rounded-md px-2 py-1 hover:bg-accent/60 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="accent-[hsl(var(--ring))]"
                    checked={selected.includes(f.id)}
                    onChange={() => toggle(f.id)}
                  />
                  <span className="truncate" title={f.name}>
                    {f.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return Array.from(buf).map(n => n.toString(36)).join("");
  }
  return Math.random().toString(36).slice(2);
}

function trimForTitle(s: string) {
  const t = s.replace(/\\s+/g, " ").trim();
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
