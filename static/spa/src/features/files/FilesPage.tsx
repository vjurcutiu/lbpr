import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Folder,
  FileText,
  ChevronRight,
  Loader2,
  RefreshCw,
  Download,
  Trash2,
  MoreVertical,
  Search,
  File as FileGeneric,
  FileCode,
  FileImage,
  FileAudio2,
  FileVideo2,
  FileArchive,
  FileSpreadsheet,
  FileType,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  listFiles,
  uploadFile,
  deleteFile,
  getFileContent,
  fileDownloadUrl,
  type FileItem,
} from "./api";

/** --------------------------
 * Derived folder tree (client-side)
 * ------------------------- */
type TreeNode = {
  type: "folder" | "file";
  name: string;            // label (no slashes)
  path: string;            // full virtual path
  children?: TreeNode[];   // only for folders
  file?: FileItem;         // only for files
};

function buildTree(files: FileItem[]): TreeNode {
  const root: TreeNode = { type: "folder", name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.name.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const atLeaf = i === parts.length - 1;
      if (atLeaf) {
        (cur.children ||= []).push({
          type: "file",
          name: part,
          path: (cur.path ? cur.path + "/" : "") + part,
          file: f,
        });
      } else {
        let next = cur.children?.find(
          (c) => c.type === "folder" && c.name === part
        );
        if (!next) {
          next = {
            type: "folder",
            name: part,
            path: (cur.path ? cur.path + "/" : "") + part,
            children: [],
          };
          (cur.children ||= []).push(next);
        }
        cur = next;
      }
    }
  }
  // sort folders first, then files
  function sort(node: TreeNode) {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sort);
  }
  sort(root);
  return root;
}

/** --------------------------
 * Tabs & viewer state
 * ------------------------- */
type OpenTab = {
  id: string;
  title: string;
  contentType?: string;
};

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(280); // resizable
  const [isResizing, setIsResizing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);

  // file content cache: id -> content payload
  const [content, setContent] = useState<Record<string, Awaited<ReturnType<typeof getFileContent>>>>({});
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const data = await listFiles();
      console.debug("[files] listFiles ok", data.length);
      setFiles(data);
      setTree(buildTree(data));
    } catch (err) {
      console.error("[files] listFiles error", err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // --- Resizer handlers (drag to resize left pane) ---
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const min = 200;
      const max = 520;
      setSidebarWidth((w) => {
        const next = Math.min(max, Math.max(min, e.clientX));
        return next;
      });
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizing]);

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await uploadFile(f);
      await refresh();
    } catch (err) {
      console.error(err);
      alert((err as any)?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const openFile = async (file: FileItem) => {
    console.debug("[files] openFile", file.id, file.name);
    // open tab if not already
    setTabs((prev) => {
      if (prev.some((t) => t.id === file.id)) return prev;
      return [...prev, { id: file.id, title: file.name, contentType: file.content_type }];
    });
    setActiveId(file.id);
    // lazy-load content (cache)
    if (!content[file.id]) {
      try {
        const payload = await getFileContent(file.id);
        console.debug("[files] content loaded", { id: file.id, kind: payload.kind, ct: payload.contentType });
        setContent((m) => ({ ...m, [file.id]: payload }));
      } catch (e) {
        console.error(e);
        alert((e as any)?.message || "Failed to load file");
      }
    }
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      // switch active if we closed the active one
      if (id === activeId) {
        const fallback = next[idx - 1]?.id ?? next[idx]?.id ?? null;
        setActiveId(fallback);
      }
      return next;
    });
  };

  const onDelete = async (file: FileItem) => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    try {
      await deleteFile(file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setTree((t) => (t ? buildTree(files.filter((f) => f.id !== file.id)) : t));
      // close any open tab for this file
      closeTab(file.id);
    } catch (err) {
      console.error(err);
      alert((err as any)?.message || "Delete failed");
    }
  };

  const filteredTree = useMemo(() => {
    if (!tree || !filter.trim()) return tree;
    const q = filter.toLowerCase();
    function filterNode(n: TreeNode): TreeNode | null {
      if (n.type === "file") {
        const hit = n.name.toLowerCase().includes(q) || (n.file?.name.toLowerCase().includes(q) ?? false);
        return hit ? n : null;
      }
      const kids = (n.children || [])
        .map(filterNode)
        .filter(Boolean) as TreeNode[];
      if (kids.length === 0 && n.name !== "") return null;
      return { ...n, children: kids };
    }
    return filterNode(tree);
  }, [tree, filter]);

  const activeFile = activeId ? files.find((f) => f.id === activeId) || null : null;
  const breadcrumbs = activeFile?.name.split("/").filter(Boolean) ?? [];

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-3 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button onClick={onPick} disabled={uploading} size="sm">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span className="ml-1.5">{uploading ? "Uploading…" : "Upload"}</span>
        </Button>
        <Input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={onChange}
        />
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter files…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={refresh} disabled={busy} size="sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Refresh
        </Button>
      </div>

      {/* Main split: LEFT sidebar (folders), RIGHT viewer */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: File tree */}
        <aside
          className="shrink-0 overflow-hidden border-r bg-muted/20"
          style={{ width: sidebarWidth }}
        >
          <div className="h-9 flex items-center px-3 text-xs uppercase tracking-wide text-muted-foreground border-b">
            Explorer
          </div>
          <div className="h-full overflow-auto px-1 py-2">
            <Tree
              node={filteredTree}
              onOpen={(f) => openFile(f)}
              onDelete={(f) => onDelete(f)}
            />
          </div>
        </aside>

        {/* RESIZE HANDLE */}
        <div
          ref={resizeRef}
          onMouseDown={() => setIsResizing(true)}
          className={cn(
            "w-1 cursor-col-resize bg-transparent hover:bg-primary/20 transition-colors",
            isResizing && "bg-primary/30"
          )}
          title="Drag to resize"
        />

        {/* RIGHT: Tabs + viewer */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center gap-1 px-2 border-b h-9 overflow-x-auto bg-muted/10">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={cn(
                  "h-8 px-3 rounded-t-md border-b-0 border text-sm transition",
                  activeId === t.id
                    ? "bg-background"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted"
                )}
                title={t.title}
              >
                <span className="truncate max-w*[18rem] inline-flex items-center gap-2">
                  <FileIconByName name={t.title} className="h-4 w-4" />
                  {t.title.split("/").slice(-1)[0]}
                </span>
                <span
                  className="ml-2 inline-flex"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                >
                  <svg
                    className="h-4 w-4 opacity-70 hover:opacity-100"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </span>
              </button>
            ))}
            {tabs.length === 0 && (
              <div className="text-xs text-muted-foreground px-2">← Open a file from the sidebar</div>
            )}
          </div>

          {/* Breadcrumb header */}
          <div className="h-8 flex items-center px-3 text-xs border-b text-muted-foreground">
            {breadcrumbs.length > 0 ? (
              <div className="truncate">
                {breadcrumbs.map((p, i) => (
                  <span key={i} className="mr-1">
                    {i > 0 && <span className="mx-1">/</span>}
                    <span className={cn(i === breadcrumbs.length - 1 && "text-foreground")}>
                      {p}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <span>Ready.</span>
            )}
          </div>

          {/* Viewer */}
          <div className="flex-1 min-h-0 overflow-auto p-4 font-mono text-sm">
            {activeId ? (
              <FileViewer payload={content[activeId]} file={activeFile} />
            ) : (
              <EmptyState />
            )}
          </div>

          {/* Status bar */}
          <div className="h-8 border-t text-xs px-3 flex items-center justify-between text-muted-foreground bg-muted/10">
            <div className="flex items-center gap-3">
              <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
              {activeFile && <span>• {fmtSize(activeFile.size)}</span>}
            </div>
            <div>LexBot PRO • File Explorer</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ---- Components ---- */

function EmptyState() {
  return (
    <div className="h-full w-full grid place-items-center">
      <div className="text-sm text-muted-foreground">
        Select a file from the sidebar to preview it here.
      </div>
    </div>
  );
}

function Tree({
  node,
  onOpen,
  onDelete,
}: {
  node: TreeNode | null | undefined;
  onOpen: (f: FileItem) => void;
  onDelete: (f: FileItem) => void;
}) {
  if (!node) return <div className="text-sm text-muted-foreground p-2">No files.</div>;
  return (
    <div className="text-sm">
      {(node.children || []).map((child) =>
        child.type === "folder" ? (
          <FolderRow key={child.path} node={child} onOpen={onOpen} onDelete={onDelete} />
        ) : (
          <FileRow key={child.path} node={child} onOpen={onOpen} onDelete={onDelete} />
        )
      )}
    </div>
  );
}

function FolderRow({
  node,
  onOpen,
  onDelete,
}: {
  node: TreeNode;
  onOpen: (f: FileItem) => void;
  onDelete: (f: FileItem) => void;
}) {
  const [open, setOpen] = useState(true);
  const caretClass = cn(
    "h-4 w-4 transition-transform",
    open ? "rotate-90" : "rotate-0"
  );

  return (
    <div className="mb-0.5">
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-muted/40 rounded text-left"
        onClick={() => setOpen((v) => !v)}
        title={node.path}
      >
        <ChevronRight className={caretClass} />
        <Folder className="h-4 w-4" />
        <span className="font-medium">{node.name || "root"}</span>
      </button>
      {open && (
        <div className="ml-5">
          {(node.children || []).map((child) =>
            child.type === "folder" ? (
              <FolderRow key={child.path} node={child} onOpen={onOpen} onDelete={onDelete} />
            ) : (
              <FileRow key={child.path} node={child} onOpen={onOpen} onDelete={onDelete} />
            )
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({
  node,
  onOpen,
  onDelete,
}: {
  node: TreeNode; // with .file
  onOpen: (f: FileItem) => void;
  onDelete: (f: FileItem) => void;
}) {
  const f = node.file!;
  const href = fileDownloadUrl(f.id);
  return (
    <div className="group flex items-center justify-between rounded hover:bg-muted/40">
      <button
        className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-left"
        title={`${f.name} (${fmtSize(f.size)})`}
        onClick={() => onOpen(f)}
      >
        <FileIconByName name={node.name} className="h-4 w-4" />
        <span className="truncate">{node.name}</span>
      </button>
      <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5 pr-1">
        <a
          href={href}
          title="Download"
          className="p-1 rounded hover:bg-muted"
          onClick={() => console.debug("[files] click sidebar download", { id: f.id, href })}
        >
          <Download className="h-4 w-4" />
        </a>

        {/* Context menu trigger */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded hover:bg-muted" title="More">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            <DropdownMenuItem
              onClick={() => {
                console.debug("[files] dropdown download", { id: f.id, href });
                window.open(href, "_self");
              }}
            >
              <Download className="h-4 w-4" /> Download
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(f)}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function FileViewer({
  payload,
  file,
}: {
  payload: Awaited<ReturnType<typeof getFileContent>> | undefined;
  file: FileItem | null;
}) {
  if (!file) return null;
  if (!payload) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (payload.kind === "text") {
    const text = payload.text ?? "";
    return (
      <pre className="whitespace-pre-wrap leading-6">
        {text}
      </pre>
    );
  }

  if (payload.kind === "image" && payload.url) {
    return (
      <div className="w-full h-full grid place-items-center">
        <img src={payload.url} alt={file.name} className="max-w-full max-h-full object-contain" />
      </div>
    );
  }

  if (payload.kind === "pdf" && payload.url) {
    return (
      <iframe
        src={payload.url}
        title={file.name}
        className="w-full h-full border rounded"
      />
    );
  }

  // default binary
  return (
    <div className="text-sm">
      Preview not available.{" "}
      <a className="underline" href={fileDownloadUrl(file.id)} onClick={() => console.debug("[files] viewer download", { id: file.id })}>
        Download
      </a>
    </div>
  );
}

function FileIconByName({ name, className }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const Icon =
    ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "svg"
      ? FileImage
      : ext === "mp3" || ext === "wav" || ext === "flac"
      ? FileAudio2
      : ext === "mp4" || ext === "mov" || ext === "webm"
      ? FileVideo2
      : ext === "zip" || ext === "gz" || ext === "rar" || ext === "7z"
      ? FileArchive
      : ext === "csv" || ext === "xlsx"
      ? FileSpreadsheet
      : ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "py" || ext === "go" || ext === "rs" || ext === "java" || ext === "json" || ext === "yml" || ext === "yaml" || ext === "toml" || ext === "md"
      ? FileCode
      : ext === "txt"
      ? FileText
      : ext
      ? FileType
      : FileGeneric;
  return <Icon className={className} />;
}

function fmtSize(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}
