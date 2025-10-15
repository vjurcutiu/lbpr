import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Loader2,
  RefreshCw,
  Trash2,
  Search,
  Info,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listFiles,
  uploadFile,
  uploadFiles,
  deleteFile,
  getFileContent,
  type FileItem,
} from "./api";

import { buildTree, type TreeNode } from "./utils/fileTree";
import { fmtSize, parseErr } from "./utils/formatters";
import { FileTree } from "./components/FileTree";
import { FileViewer } from "./components/FileViewer";
import { EmptyState } from "./components/EmptyState";
import { FileIconByName } from "./components/FileIconByName";
import { UploadTrackerPanel } from "./components/UploadTracker";
import { listUploadJobs, type UploadJob } from "./uploadTrackerApi";

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);

  // delete modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);

  const [content, setContent] = useState<
    Record<string, Awaited<ReturnType<typeof getFileContent>>>
  >({});
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; contentType?: string }>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // in-file search + metadata modal
  const [infileQuery, setInfileQuery] = useState("");
  const [metaOpen, setMetaOpen] = useState(false);

  // Upload tracker panel
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [trackerRefreshKey, setTrackerRefreshKey] = useState<number>(0);

  // Optimistic jobs seeded per-batch
  const [optimisticJobs, setOptimisticJobs] = useState<UploadJob[]>([]);
  // This-batch filter by filename
  const [batchFilenames, setBatchFilenames] = useState<string[]>([]);
  // NEW: seed the tracker with existing history so it shows immediately
  const [seedFetched, setSeedFetched] = useState<UploadJob[]>([]);

  // UI niceties
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const data = await listFiles();
      setFiles(data);
      setTree(buildTree(data));
      setLastRefreshed(Date.now());
    } catch (err) {
      console.error("[files] listFiles error", err);
      toast.error("Failed to load files", { description: parseErr(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Resize logic
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const min = 220;
      const max = 560;
      setSidebarWidth(() => Math.min(max, Math.max(min, e.clientX)));
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

  function makeTempJob(file: File): UploadJob {
    const now = Math.floor(Date.now() / 1000);
    const tempId = `temp:${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))}`;
    return {
      job_id: tempId,
      uid: "me",
      filename: file.name,
      dataset: "default",
      total_bytes: file.size,
      bytes: 0,
      phase: "receive",
      pct: 0,
      status: "running",
      error: null,
      created_at: now,
      updated_at: now,
    };
  }

  // Shared handler for traditional file input and drag&drop
  const handleFiles = async (fs: File[]) => {
    if (fs.length === 0) return;
    setUploading(true);
    try {
      // 1) Pre-fetch existing jobs so the tracker opens already populated
      try {
        const existing = await listUploadJobs();
        setSeedFetched(existing);
      } catch (prefetchErr) {
        console.debug("[files] prefetch upload jobs failed (non-fatal)", prefetchErr);
      }

      // 2) Prepare *this batch* optimistic entries
      const temps = fs.map(makeTempJob);
      setOptimisticJobs(temps); // reset instead of accumulating
      setBatchFilenames(fs.map(f => f.name));

      // 3) Open tracker *after* seeding existing + optimistic
      setTrackerOpen(true);
      toast.message("Uploads started", { description: `0/${fs.length} complete. Tracking in Transfers.` });

      // 4) Kick the uploads
      if (fs.length === 1) {
        const { job_id } = await uploadFile(fs[0]);
        const tempId = temps[0].job_id;
        const now = Math.floor(Date.now() / 1000);
        setOptimisticJobs((list) =>
          list.map((j) => (j.job_id === tempId ? { ...j, job_id, updated_at: now } : j))
        );
      } else {
        const { jobs } = await uploadFiles(fs);
        const now = Math.floor(Date.now() / 1000);
        const idMap = new Map<string, string>(); // temp -> real
        for (let i = 0; i < temps.length; i++) {
          if (jobs[i]) idMap.set(temps[i].job_id, jobs[i]);
        }
        setOptimisticJobs((list) =>
          list.map((j) => (idMap.has(j.job_id) ? { ...j, job_id: idMap.get(j.job_id)!, updated_at: now } : j))
        );
      }

      // 5) Force an immediate panel refresh + file refresh
      setTrackerRefreshKey(Date.now());
      await refresh();
    } catch (err) {
      console.error(err);
      toast.error("Upload failed", { description: parseErr(err) });
      const now = Math.floor(Date.now() / 1000);
      const tempIds = new Set(optimisticJobs.map(t => t.job_id));
      setOptimisticJobs((list) =>
        list.map((j) => (tempIds.has(j.job_id) ? { ...j, status: "error", phase: "error", updated_at: now, error: "Failed to start upload" } : j))
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = Array.from(e.target.files || []);
    await handleFiles(fs);
  };

  // Global drag & drop overlay
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        setDragActive(true);
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        setDragActive(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      // Only hide if leaving the window entirely
      if ((e as any).relatedTarget === null) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        const fs = Array.from(e.dataTransfer.files || []);
        setDragActive(false);
        handleFiles(fs);
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  const openFile = async (file: FileItem) => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === file.id)) return prev;
      return [...prev, { id: file.id, title: file.name, contentType: file.content_type }];
    });
    setActiveId(file.id);
    if (!content[file.id]) {
      try {
        const payload = await getFileContent(file.id);
        setContent((m) => ({ ...m, [file.id]: payload }));
      } catch (e) {
        console.error(e);
        toast.error("Preview failed", { description: parseErr(e) });
      }
    }
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId) {
        const fallback = next[idx - 1]?.id ?? next[idx]?.id ?? null;
        setActiveId(fallback);
      }
      return next;
    });
  };

  const requestDelete = (file: FileItem) => {
    setFileToDelete(file);
    setConfirmOpen(true);
  };

  const performDelete = async () => {
    if (!fileToDelete) return;
    setDeleting(true);
    try {
      await deleteFile(fileToDelete.id);
      setFiles((prev) => prev.filter((f) => f.id !== fileToDelete.id));
      setTree((t) => t ? buildTree(files.filter((f) => f.id !== fileToDelete.id)) : t);
      closeTab(fileToDelete.id);
      toast.success("File deleted", { description: `"${fileToDelete.name}" removed.` });
    } catch (err) {
      console.error(err);
      toast.error("Delete failed", { description: parseErr(err) });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
      setFileToDelete(null);
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
      const kids = (n.children || []).map(filterNode).filter(Boolean) as TreeNode[];
      if (kids.length === 0 && n.name !== "") return null;
      return { ...n, children: kids };
    }
    return filterNode(tree);
  }, [tree, filter]);

  const activeFile = activeId ? files.find((f) => f.id === activeId) || null : null;

  // When jobs finish, auto-refresh files so new items appear without manual reload
  const handleAnyComplete = async () => {
    await refresh();
  };

  const totalSize = useMemo(() => files.reduce((acc, f) => acc + (f.size || 0), 0), [files]);
  const runningUploads = useMemo(
    () => optimisticJobs.some(j => j.status === "running"),
    [optimisticJobs]
  );

  return (
    <div className="h-full min-h-0 flex flex-col relative">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-3 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button onClick={onPick} disabled={uploading} size="sm">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span className="ml-1.5">{uploading ? "Uploading…" : "Upload"}</span>
        </Button>
        <Input ref={inputRef} type="file" className="hidden" onChange={onChange} multiple />
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter files…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8 pr-7"
          />
          {filter && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
              title="Clear"
            >
              ×
            </button>
          )}
        </div>
        <div className="flex-1" />
        <div className="hidden md:flex items-center text-xs text-muted-foreground mr-2">
          <span className="mr-3">{files.length} file{files.length === 1 ? "" : "s"}</span>
          <span>• {fmtSize(totalSize)}</span>
        </div>
        <Button variant="outline" onClick={refresh} disabled={busy} size="sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Refresh
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setTrackerOpen(v => !v)} title="Show transfers" className="relative">
          <Activity className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">Transfers</span>
          {(uploading || runningUploads) && (
            <span className="absolute -top-1 -right-1 inline-flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
          )}
        </Button>
      </div>

      {/* Main split */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: File tree */}
        <aside className="shrink-0 overflow-hidden border-r bg-muted/20" style={{ width: sidebarWidth }}>
          <div className="h-9 flex items-center px-3 text-xs uppercase tracking-wide text-muted-foreground border-b">Explorer</div>
          <div className="h-full overflow-auto px-1 py-2">
            <FileTree node={filteredTree} onOpen={(f) => openFile(f)} onDelete={(f) => requestDelete(f)} />
          </div>
        </aside>

        {/* RESIZE HANDLE */}
        <div
          ref={resizeRef}
          onMouseDown={() => setIsResizing(true)}
          className={cn("w-1 cursor-col-resize bg-transparent hover:bg-primary/20 transition-colors", isResizing && "bg-primary/30")}
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
                  activeId === t.id ? "bg-background" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                )}
                title={t.title}
              >
                <span className="truncate inline-flex max-w-[18rem] items-center gap-2">
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
                  <svg className="h-4 w-4 opacity-70 hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </span>
              </button>
            ))}
            {tabs.length === 0 && (
              <div className="text-xs text-muted-foreground px-2">← Open a file from the sidebar</div>
            )}
          </div>

          {/* Title section */}
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-background">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground truncate">
                {activeId ? (files.find((f) => f.id === activeId)?.name || "Unknown") : "Ready."}
              </div>
            </div>
            <div className="relative w-[26rem] max-w-[60vw]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={activeId ? "Search in this file…" : "Open a file to search…"} value={infileQuery} onChange={(e) => setInfileQuery(e.target.value)} className="pl-8" disabled={!activeId} />
            </div>
            <Button variant="outline" size="sm" onClick={() => setMetaOpen(true)} disabled={!activeId} title="View file metadata">
              <Info className="h-4 w-4" />
              <span className="ml-1.5 hidden sm:inline">Metadata</span>
            </Button>
          </div>

          {/* Viewer */}
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <div className="h-full rounded-lg border bg-background shadow-sm p-4">
              {activeId ? (
                <FileViewer payload={content[activeId]} file={files.find((f) => f.id === activeId) || null} searchTerm={infileQuery} />
              ) : (
                <EmptyState onUploadClick={onPick} />
              )}
            </div>
          </div>

          {/* Status bar */}
          <div className="h-8 border-t text-xs px-3 flex items-center justify-between text-muted-foreground bg-muted/10">
            <div className="flex items-center gap-3">
              <span>{files.length} file{files.length === 1 ? "" : "s"} • {fmtSize(totalSize)}</span>
            </div>
            <div>
              {lastRefreshed ? `Updated ${new Date(lastRefreshed).toLocaleTimeString()}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Global drag & drop overlay */}
      {dragActive && (
        <div
          className="pointer-events-none fixed inset-0 z-20 grid place-items-center bg-background/80 backdrop-blur border-2 border-dashed border-primary"
        >
          <div className="pointer-events-auto rounded-xl border bg-background shadow-lg px-6 py-4 text-center">
            <div className="text-sm font-medium">Drop files to upload</div>
            <div className="text-xs text-muted-foreground mt-1">We&apos;ll start the upload immediately</div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              {fileToDelete ? `This will permanently delete "${fileToDelete.name}". You can't undo this action.` : "This will permanently delete the file."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={performDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span className="ml-2">Delete</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Metadata modal */}
      <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>File info</DialogTitle>
            <DialogDescription>Details and metadata for the selected file.</DialogDescription>
          </DialogHeader>
          {activeId ? (
            <div className="text-sm grid grid-cols-3 gap-x-4 gap-y-2">
              <div className="text-muted-foreground">Name</div>
              <div className="col-span-2 break-all">{files.find((f) => f.id === activeId)?.name}</div>
              <div className="text-muted-foreground">ID</div>
              <div className="col-span-2 break-all">{activeId}</div>
              <div className="text-muted-foreground">Size</div>
              <div className="col-span-2">{fmtSize(files.find((f) => f.id === activeId)?.size || 0)}</div>
              {files.find((f) => f.id === activeId)?.created_at && (
                <>
                  <div className="text-muted-foreground">Created</div>
                  <div className="col-span-2">
                    {new Date(files.find((f) => f.id === activeId)!.created_at!).toLocaleString()}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No file selected.</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetaOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload tracker floating panel */}
      <UploadTrackerPanel
        open={trackerOpen}
        onClose={() => setTrackerOpen(false)}
        refreshKey={trackerRefreshKey}
        onAnyComplete={handleAnyComplete}
        optimistic={optimisticJobs}
        batchFilenames={batchFilenames}
        showHistory={true}
        seedFetched={seedFetched}
      />
    </div>
  );
}
