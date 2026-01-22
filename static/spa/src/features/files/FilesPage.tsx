import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Loader2,
  RefreshCw,
  Trash2,
  Search,
  Info,
  Activity,
  ChevronLeft,
  ChevronRight,
  ChevronUp,  ChevronDown,
  Folder,
  FolderPlus,
  X,
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  listFiles,
  listFolders,
  uploadFile,
  uploadFiles,
  deleteFile,
  createFolder,
  updateFile,
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
import { loadBool, saveBool, loadJSON, saveJSON } from "@/shared/persist";
import "./styles.css";

const LS_TRACKER_OPEN = "files:trackerOpen";
const LS_OPTIMISTIC = "files:optimisticJobs";
const LS_BATCH = "files:batchFilenames";


function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Safari < 14 uses addListener/removeListener
    if ("addEventListener" in mql) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // @ts-expect-error legacy
    mql.addListener(onChange);
    // @ts-expect-error legacy
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef<string>("");
  const resizeRef = useRef<HTMLDivElement>(null);


  const isMobile = useMediaQuery("(max-width: 767px)");
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);

  // Close mobile explorer automatically when switching to desktop.
  useEffect(() => {
    if (!isMobile) setMobileExplorerOpen(false);
  }, [isMobile]);

  // delete modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);

  // Folder + move/rename dialogs
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderBusy, setNewFolderBusy] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState<string>("");

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [fileToMove, setFileToMove] = useState<FileItem | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState<string>("");

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const [content, setContent] = useState<
    Record<string, Awaited<ReturnType<typeof getFileContent>>>
  >({});
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; contentType?: string }>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // in-file search + metadata modal
  const [infileQuery, setInfileQuery] = useState("");
  const [infileIdx, setInfileIdx] = useState(0);
  const [metaOpen, setMetaOpen] = useState(false);

  // Upload tracker panel
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [trackerRefreshKey, setTrackerRefreshKey] = useState<number>(0);

  // Optimistic jobs seeded per-batch
  const [optimisticJobs, setOptimisticJobs] = useState<UploadJob[]>([]);
  // This-batch filter by filename
  const [batchFilenames, setBatchFilenames] = useState<string[]>([]);
  // Seed the tracker with existing history so it shows immediately
  const [seedFetched, setSeedFetched] = useState<UploadJob[]>([]);

  // UI niceties
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Tabs scroll state
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [fileData, folderData] = await Promise.all([
        listFiles(),
        listFolders().catch((e) => {
          console.debug("[files] listFolders failed (non-fatal)", e);
          return [] as string[];
        }),
      ]);

      // Normalize folders and ensure parents exist so the tree can display empties.
      const folderSet = new Set<string>();
      for (const raw of folderData || []) {
        const rawStr = typeof raw === "string" ? raw : (raw as any)?.path;
        const p = String(rawStr || "")
          .trim()
          .replace(/^\/+/, "")
          .replace(/\/+$/, "")
          .replace(/\/{2,}/g, "/");
        if (!p) continue;
        const parts = p.split("/").filter(Boolean);
        for (let i = 1; i <= parts.length; i++) folderSet.add(parts.slice(0, i).join("/"));
      }
      const folderList = Array.from(folderSet).sort((a, b) => a.localeCompare(b));

      setFolders(folderList);
      setFiles(fileData);
      setTree(buildTree(fileData, folderList));

      // keep open tabs in sync with any renames/moves
      setTabs((prev) => {
        const byId = new Map(fileData.map((f) => [f.id, f] as const));
        return prev
          .filter((t) => byId.has(t.id))
          .map((t) => {
            const f = byId.get(t.id)!;
            return { ...t, title: f.name, contentType: f.content_type };
          });
      });
      setLastRefreshed(Date.now());
    } catch (err) {
      console.error("[files] listFiles error", err);
      toast.error("Failed to load files", { description: parseErr(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // --- NEW: Rehydrate tracker state across route changes ---
  useEffect(() => {
    // restore toggled-open state
    const open = loadBool(LS_TRACKER_OPEN, false);
    setTrackerOpen(open);
    // restore optimistic batch + filenames (these will be de-duped against fetched jobs by the panel)
    const opt = loadJSON<UploadJob[]>(LS_OPTIMISTIC, []);
    if (opt.length) setOptimisticJobs(opt);
    const bf = loadJSON<string[]>(LS_BATCH, []);
    if (bf.length) setBatchFilenames(bf);
    // if it was open, prefetch existing server-side jobs to show immediately
    if (open) {
      listUploadJobs().then(setSeedFetched).catch(() => {});
      setTrackerRefreshKey(Date.now());
    }
  }, []);

  // persist tracker UI as it changes
  useEffect(() => { saveBool(LS_TRACKER_OPEN, trackerOpen); }, [trackerOpen]);
  useEffect(() => { saveJSON(LS_OPTIMISTIC, optimisticJobs); }, [optimisticJobs]);
  useEffect(() => { saveJSON(LS_BATCH, batchFilenames); }, [batchFilenames]);

  // Resize logic (desktop only)
  useEffect(() => {
    if (isMobile) return;
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
  }, [isResizing, isMobile]);

  const onPick = (folderPath: string = "") => {
    uploadFolderRef.current = folderPath;
    inputRef.current?.click();
  };

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
  const handleFiles = async (fs: File[], folderPath: string = "") => {
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
        const { job_id } = await uploadFile(fs[0], folderPath);
        const tempId = temps[0].job_id;
        const now = Math.floor(Date.now() / 1000);
        setOptimisticJobs((list) =>
          list.map((j) => (j.job_id === tempId ? { ...j, job_id, updated_at: now } : j))
        );
      } else {
        const { jobs } = await uploadFiles(fs, folderPath);
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
    const folderPath = uploadFolderRef.current || "";
    uploadFolderRef.current = "";
    await handleFiles(fs, folderPath);
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
    if (isMobile) setMobileExplorerOpen(false);
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
      closeTab(fileToDelete.id);
      setContent((m) => {
        const next = { ...m };
        delete next[fileToDelete.id];
        return next;
      });
      toast.success("File deleted", { description: `"${fileToDelete.name}" removed.` });
      await refresh();
    } catch (err) {
      console.error(err);
      toast.error("Delete failed", { description: parseErr(err) });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
      setFileToDelete(null);
    }
  };

  // ---- Folder helpers + actions ----
  const normPath = (p: string) =>
    (p || "")
      .trim()
      .replace(/^\/+/g, "")
      .replace(/\/+$/g, "")
      .replace(/\/{2,}/g, "/");

  const fileFolder = (fullName: string) => {
    const parts = (fullName || "").split("/").filter(Boolean);
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/");
  };
  const fileBase = (fullName: string) => {
    const parts = (fullName || "").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : fullName;
  };
  const joinPath = (folderPath: string, baseName: string) =>
    folderPath ? `${folderPath}/${baseName}` : baseName;

  const requestNewFolder = (parentPath: string) => {
    setNewFolderParent(parentPath || "");
    setNewFolderName("");
    setNewFolderOpen(true);
  };

  const doCreateFolder = async () => {
    const parent = normPath(newFolderParent);
    const name = normPath(newFolderName);
    if (name.includes("/")) {
      toast.error("Folder name can't include '/'", { description: "Create nested folders one level at a time." });
      return;
    }
    const full = normPath([parent, name].filter(Boolean).join("/"));
    if (!full) {
      toast.error("Folder name required");
      return;
    }
    setNewFolderBusy(true);
    try {
      await createFolder(full);
      toast.success("Folder created", { description: full });
      setNewFolderOpen(false);
      setNewFolderName("");
      await refresh();
    } catch (e) {
      console.error(e);
      toast.error("Create folder failed", { description: parseErr(e) });
    } finally {
      setNewFolderBusy(false);
    }
  };

  const requestRename = (f: FileItem) => {
    setFileToRename(f);
    setRenameValue(fileBase(f.name));
    setRenameOpen(true);
  };

  const doRename = async () => {
    if (!fileToRename) return;
    const base = (renameValue || "").trim();
    if (!base) {
      toast.error("Name required");
      return;
    }
    if (base.includes("/")) {
      toast.error("Rename can't include '/'", { description: "Use Move to… for folders." });
      return;
    }

    const folder = fileFolder(fileToRename.name);
    const display = joinPath(folder, base);

    setRenameBusy(true);
    try {
      await updateFile(fileToRename.id, { folder, name: base, display_name: display });
      toast.success("Renamed", { description: display });
      setRenameOpen(false);
      setFileToRename(null);
      await refresh();
    } catch (e) {
      console.error(e);
      toast.error("Rename failed", { description: parseErr(e) });
    } finally {
      setRenameBusy(false);
    }
  };

  const requestMove = (f: FileItem) => {
    setFileToMove(f);
    setMoveTargetFolder(fileFolder(f.name));
    setMoveOpen(true);
  };

  const doMove = async () => {
    if (!fileToMove) return;
    const target = normPath(moveTargetFolder);
    const current = fileFolder(fileToMove.name);
    if (target === current) {
      setMoveOpen(false);
      setFileToMove(null);
      return;
    }

    const base = fileBase(fileToMove.name);
    const display = joinPath(target, base);

    setMoveBusy(true);
    try {
      await updateFile(fileToMove.id, { folder: target, name: base, display_name: display });
      toast.success("Moved", { description: display });
      setMoveOpen(false);
      setFileToMove(null);
      await refresh();
    } catch (e) {
      console.error(e);
      toast.error("Move failed", { description: parseErr(e) });
    } finally {
      setMoveBusy(false);
    }
  };

  const moveFileToFolder = (fileId: string, folderPath: string) => {
    const target = normPath(folderPath);
    void (async () => {
      const f = files.find((x) => x.id === fileId) || null;
      const current = f ? fileFolder(f.name) : null;
      if (current !== null && target === current) return;

      const base = f ? fileBase(f.name) : null;
      const display = base ? joinPath(target, base) : null;
      try {
        await updateFile(fileId, {
          folder: target,
          ...(base ? { name: base } : {}),
          ...(display ? { display_name: display } : {}),
        });
        toast.success("Moved", { description: display || target || "root" });
        await refresh();
      } catch (e) {
        console.error(e);
        toast.error("Move failed", { description: parseErr(e) });
      }
    })();
  };

  const clearGlobalDrag = () => setDragActive(false);


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
  const activePayload = activeId ? content[activeId] : undefined;
  const canSearchInFile = activePayload?.kind === "text";
  const matchCount = useMemo(() => {
    if (!canSearchInFile) return 0;
    const q = (infileQuery || "").trim();
    if (!q) return 0;
    const text = (activePayload as any)?.text || "";
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    let cnt = 0;
    while (re.exec(text)) cnt++;
    return cnt;
  }, [canSearchInFile, infileQuery, activePayload]);

  // keep selection in range when query, file, or count changes
  useEffect(() => {
    setInfileIdx(0);
  }, [infileQuery, activeId]);

  useEffect(() => {
    if (infileIdx >= matchCount) setInfileIdx(matchCount > 0 ? matchCount - 1 : 0);
  }, [matchCount]);

  const gotoPrev = () => {
    if (matchCount <= 0) return;
    setInfileIdx((i) => (i - 1 + matchCount) % matchCount);
  };
  const gotoNext = () => {
    if (matchCount <= 0) return;
    setInfileIdx((i) => (i + 1) % matchCount);
  };
  const clearInfile = () => {
    setInfileQuery("");
    setInfileIdx(0);
  };

  // Tabs scroll helpers
  const recalcTabsOverflow = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    const maxLeft = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(left > 0);
    setCanScrollRight(left < maxLeft - 1);
  }, []);

  const scrollTabsBy = (delta: number) => {
    const el = tabsRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    recalcTabsOverflow();
    const onScroll = () => recalcTabsOverflow();
    el.addEventListener("scroll", onScroll, { passive: true });
    // Horizontal scroll via wheel
    const onWheel = (e: WheelEvent) => {
      // Convert vertical wheel to horizontal scroll
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // Recalc on resize/content changes
    let ro: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(() => recalcTabsOverflow());
      ro.observe(el);
    }
    const onWinResize = () => recalcTabsOverflow();
    window.addEventListener("resize", onWinResize);

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel as any);
      window.removeEventListener("resize", onWinResize);
      if (ro) ro.disconnect();
    };
  }, [tabs.length, recalcTabsOverflow]);

  // When active tab changes, ensure it's scrolled into view
  useEffect(() => {
    const el = tabsRef.current;
    if (!el || !activeId) return;
    const btn = el.querySelector<HTMLButtonElement>(`button[data-tab-id="${activeId}"]`);
    if (btn) {
      btn.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    }
  }, [activeId]);

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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-full min-h-0 flex flex-col relative">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button
          variant="outline"
          size="sm"
          className="md:hidden"
          onClick={() => setMobileExplorerOpen(true)}
          title="Browse files"
        >
          <Folder className="h-4 w-4" />
          <span className="ml-1.5">Files</span>
        </Button>

        <Button onClick={() => onPick("")} disabled={uploading} size="sm">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span className="ml-1.5">{uploading ? "Uploading…" : "Upload"}</span>
        </Button>
        <Input ref={inputRef} type="file" className="hidden" onChange={onChange} multiple />

        <div className="relative w-full md:max-w-sm md:w-full md:order-none order-last">
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

        <div className="flex-1 hidden md:block" />
        <div className="hidden md:flex items-center text-xs text-muted-foreground mr-2">
          <span className="mr-3">{files.length} file{files.length === 1 ? "" : "s"}</span>
          <span>• {fmtSize(totalSize)}</span>
        </div>
        <Button variant="outline" onClick={refresh} disabled={busy} size="sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 md:mr-1.5" />}
          <span className="hidden md:inline">Refresh</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTrackerOpen((v) => !v)}
          title="Show transfers"
          className="relative"
        >
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
        <aside className="hidden md:block shrink-0 overflow-hidden border-r bg-muted/20" style={{ width: sidebarWidth }}>
          <div className="h-9 flex items-center px-3 text-xs uppercase tracking-wide text-muted-foreground border-b">Explorer</div>
          <div className="h-full overflow-auto px-1 py-2">
            <FileTree
              loading={busy && (!tree || files.length === 0)}
              node={filteredTree}
              onOpen={(f) => openFile(f)}
              onDelete={(f) => requestDelete(f)}
              onRequestRename={(f) => requestRename(f)}
              onRequestMove={(f) => requestMove(f)}
              onMoveToFolder={(fileId, folderPath) => moveFileToFolder(fileId, folderPath)}
              onUploadToFolder={(folderPath) => onPick(folderPath)}
              onUploadFilesToFolder={(fs, folderPath) => void handleFiles(fs, folderPath)}
              onCreateFolder={(parentPath) => requestNewFolder(parentPath)}
              onClearGlobalDragActive={clearGlobalDrag}
            />
          </div>
        </aside>

        {/* RESIZE HANDLE */}
        <div
          ref={resizeRef}
          onMouseDown={() => setIsResizing(true)}
          className={cn("hidden md:block w-1 cursor-col-resize bg-transparent hover:bg-primary/20 transition-colors", isResizing && "bg-primary/30")}
          title="Drag to resize"
        />

        {/* RIGHT: Tabs + viewer */}
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* Tabs with overflow arrows (no visible scrollbars) */}
          <div className="relative border-b bg-muted/10 h-9">
            {/* Left arrow */}
            {canScrollLeft && (
              <button
                className="absolute left-0 top-0 bottom-0 z-10 pl-1 pr-2 bg-gradient-to-r from-background to-transparent flex items-center"
                onClick={() => scrollTabsBy(-240)}
                title="Scroll left"
                aria-label="Scroll tabs left"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {/* Right arrow */}
            {canScrollRight && (
              <button
                className="absolute right-0 top-0 bottom-0 z-10 pr-1 pl-2 bg-gradient-to-l from-background to-transparent flex items-center"
                onClick={() => scrollTabsBy(240)}
                title="Scroll right"
                aria-label="Scroll tabs right"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {/* Clip the scroller so scrollbars never show */}
            <div className="absolute inset-0 overflow-hidden">
              <div
                ref={tabsRef}
                className="flex items-center gap-1 px-2 h-9 overflow-x-auto no-scrollbar"
              >
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    data-tab-id={t.id}
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      "h-8 px-3 rounded-t-md border-b-0 border text-sm transition whitespace-nowrap",
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
            </div>
          </div>

          {/* Title + in-file search controls */}
          <div className="flex flex-col md:flex-row md:items-center gap-2 px-3 py-2 border-b bg-background">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground truncate">
                {activeId ? (files.find((f) => f.id === activeId)?.name || "Unknown") : "Ready."}
              </div>
            </div>
            <div className="relative w-full md:w-[26rem] md:max-w-[60vw]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={activeId ? "Search in this file…" : "Open a file to search…"}
                value={infileQuery}
                onChange={(e) => setInfileQuery(e.target.value)}
                className="pl-8 pr-28"
                disabled={!activeId || !canSearchInFile}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if ((e as any).shiftKey) gotoPrev();
                    else gotoNext();
                  }
                }}
              />
              {/* Match counter */}
              <div className="absolute right-24 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground select-none">
                {infileQuery.trim() && canSearchInFile ? (
                  matchCount > 0 ? `${infileIdx + 1}/${matchCount}` : "0/0"
                ) : ""}
              </div>
              {/* Controls */}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  className="p-1 rounded hover:bg-muted disabled:opacity-50"
                  title="Previous match (Shift+Enter)"
                  onClick={gotoPrev}
                  disabled={!canSearchInFile || matchCount === 0}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  className="p-1 rounded hover:bg-muted disabled:opacity-50"
                  title="Next match (Enter)"
                  onClick={gotoNext}
                  disabled={!canSearchInFile || matchCount === 0}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  className="p-1 rounded hover:bg-muted"
                  title="Clear search"
                  onClick={clearInfile}
                  disabled={!infileQuery}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setMetaOpen(true)} disabled={!activeId} title="View file metadata">
              <Info className="h-4 w-4" />
              <span className="ml-1.5 hidden sm:inline">Metadata</span>
            </Button>
          </div>

          {/* Viewer */}
          <div className="flex-1 min-h-0 overflow-auto p-2 md:p-4">
            <div className="rounded-lg border bg-background shadow-sm p-4">
              {activeId ? (
                <FileViewer payload={content[activeId]} file={files.find((f) => f.id === activeId) || null} searchTerm={infileQuery} selectedIndex={matchCount > 0 ? infileIdx : -1} />
              ) : (
                <EmptyState onUploadClick={onPick} onBrowseClick={isMobile ? () => setMobileExplorerOpen(true) : undefined} />
              )}
            </div>
          </div>

          {/* Status bar */}
          <div className="hidden md:flex h-8 border-t text-xs px-3 items-center justify-between text-muted-foreground bg-muted/10">
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
              {fileToDelete ? `This will permanently delete \"${fileToDelete.name}\". You can't undo this action.` : "This will permanently delete the file."}
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

      {/* New folder modal */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Create a folder{newFolderParent ? ` inside ${newFolderParent}` : " in Root"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {newFolderParent ? (
              <div className="text-xs text-muted-foreground">
                Parent: <span className="font-mono">{newFolderParent}</span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Parent: <span className="font-mono">Root</span>
              </div>
            )}
            <Input
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doCreateFolder();
              }}
              disabled={newFolderBusy}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)} disabled={newFolderBusy}>
              Cancel
            </Button>
            <Button onClick={() => void doCreateFolder()} disabled={newFolderBusy}>
              {newFolderBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className={cn(newFolderBusy ? "ml-2" : "")}>Create</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename modal */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>
              Renaming keeps the file in the same folder. Use “Move to…” to change folders.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {fileToRename && (
              <div className="text-xs text-muted-foreground">
                Current: <span className="font-mono break-all">{fileToRename.name}</span>
              </div>
            )}
            <Input
              autoFocus
              placeholder="New filename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doRename();
              }}
              disabled={renameBusy}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={renameBusy}>
              Cancel
            </Button>
            <Button onClick={() => void doRename()} disabled={renameBusy}>
              {renameBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className={cn(renameBusy ? "ml-2" : "")}>Rename</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move modal */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move file</DialogTitle>
            <DialogDescription>
              Move the file to another folder. Leave blank for Root.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {fileToMove && (
              <div className="text-xs text-muted-foreground">
                File: <span className="font-mono break-all">{fileToMove.name}</span>
              </div>
            )}
            <Input
              autoFocus
              placeholder="Destination folder (blank = Root)"
              value={moveTargetFolder}
              onChange={(e) => setMoveTargetFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doMove();
              }}
              list="lbp-folder-options"
              disabled={moveBusy}
            />
            <datalist id="lbp-folder-options">
              {folders.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)} disabled={moveBusy}>
              Cancel
            </Button>
            <Button onClick={() => void doMove()} disabled={moveBusy}>
              {moveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className={cn(moveBusy ? "ml-2" : "")}>Move</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload tracker floating panel */}
      {/* Mobile explorer */}
      <Dialog open={mobileExplorerOpen} onOpenChange={setMobileExplorerOpen}>
        <DialogContent className="md:hidden p-0 gap-0 w-[calc(100vw-1rem)] max-w-none h-[calc(100vh-1rem)] flex flex-col">
          <div className="px-3 py-2 border-b flex items-center gap-2">
            <div className="text-sm font-medium">Explorer</div>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={refresh} disabled={busy} title="Refresh">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button size="sm" onClick={() => onPick("")} disabled={uploading} title="Upload">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMobileExplorerOpen(false)} title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="px-3 py-2 border-b">
            <div className="relative">
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
          </div>

          <div className="flex-1 overflow-auto px-1 py-2 bg-muted/10">
            <FileTree
              loading={busy && (!tree || files.length === 0)}
              node={filteredTree}
              onOpen={(f) => openFile(f)}
              onDelete={(f) => requestDelete(f)}
              onRequestRename={(f) => requestRename(f)}
              onRequestMove={(f) => requestMove(f)}
              onMoveToFolder={(fileId, folderPath) => moveFileToFolder(fileId, folderPath)}
              onUploadToFolder={(folderPath) => onPick(folderPath)}
              onUploadFilesToFolder={(fs, folderPath) => void handleFiles(fs, folderPath)}
              onCreateFolder={(parentPath) => requestNewFolder(parentPath)}
              onClearGlobalDragActive={clearGlobalDrag}
            />
          </div>
        </DialogContent>
      </Dialog>

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
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-[12rem]">
        <ContextMenuItem onClick={() => onPick("")}> 
          <Upload className="h-4 w-4" /> Upload…
        </ContextMenuItem>
        <ContextMenuItem onClick={() => requestNewFolder("")}> 
          <FolderPlus className="h-4 w-4" /> New folder…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={refresh} disabled={busy}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
