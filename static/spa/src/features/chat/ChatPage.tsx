import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Send, Loader2, Trash2, Plus, LinkIcon } from "lucide-react";
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
  trace_id?: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<RenderMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [streamEnabled] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const tenantId = useTenantId();

  const hasThread = messages.length > 0;
  const canSend = input.trim().length > 0 && !sending;

  useEffect(() => {
    listFiles().then(setFiles).catch(() => {});
  }, []);

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
    };

    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    const traceId = cryptoRandomId();
    console.debug("[chat] sending", { traceId, tenantId, len: userMsg.content.length });

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
      };

      setMessages(prev => [...prev, assistantMsg]);
      setInput("");
      console.debug("[chat] ok", { traceId, retrieved: res.usage?.retrieved });
    } catch (err: any) {
      const errMsg: RenderMessage = {
        id: cryptoRandomId(),
        role: "system",
        content: (err?.message || "Failed to send message") + (traceId ? ` (trace ${traceId})` : ""),
      };
      setMessages(prev => [...prev, errMsg]);
      console.error("[chat] error", { traceId, err });
    } finally {
      setSending(false);
    }
  };

  const clear = () => {
    setMessages([]);
    setSelectedFileIds([]);
    setInput("");
  };

  return (
    <div className="mx-auto w-full max-w-5xl h-[calc(100vh-8rem)] card p-0 overflow-hidden flex flex-col">
      <div ref={listRef} className="flex-1 overflow-auto">
        {!hasThread ? (
          <EmptyState suggestions={STARTER_SUGGESTIONS} onPick={onPickSuggestion} />
        ) : (
          <div className="px-4 sm:px-6 py-6 space-y-6">
            {messages.map(m => (
              <MessageRow key={m.id} role={m.role} content={m.content} citations={m.citations} />
            ))}
          </div>
        )}
      </div>

      <Separator />

      <form onSubmit={onSubmit} className="p-3 sm:p-4 sticky bottom-0 bg-background">
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
  );
}

function EmptyState({ suggestions, onPick }: { suggestions: string[]; onPick: (s: string) => void }) {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="text-center px-6 max-w-2xl">
        <div className="inline-flex items-center justify-center size-12 rounded-2xl bg-accent text-accent-foreground shadow-sm mb-4">
          <Plus className="h-5 w-5" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">LBP Assistant</h1>
        <p className="text-muted-foreground mt-2">
          Ask about your project, files, and RAG pipeline. Try one of these:
        </p>

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
