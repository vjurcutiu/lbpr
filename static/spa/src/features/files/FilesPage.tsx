import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { flushSync } from "react-dom";
import {
  Upload,
  Loader2,
  RefreshCw,
  Trash2,
  Search,
  Activity,
  Folder,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Download,
  FolderPlus,
  Copy,
  ArrowUp,
  Mic,
  ScanText,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { cn } from "@/lib/utils";
import {
  listFiles,
  listFolders,
  createFolder,
  updateFile,
  uploadFileToFolder,
  uploadFilesToFolder,
  deleteFile,
  fileDownloadUrl,
  getFileContent,
  type FileItem,
} from "./api";

import { transcribeAudio, type TranscribeResponse } from "@/features/transcription/api";
import { runOcr, type OcrResponse, type OcrMode } from "@/features/ocr/api";

import { buildTree, findNode, type TreeNode } from "./utils/fileTree";
import { fileDndId, folderDndId, normalizeFolderPath, parseDndId, isExternalFilesDrag } from "./utils/dnd";
import { fmtSize, parseErr } from "./utils/formatters";
import { FileTree } from "./components/FileTree";
import { FileViewer } from "./components/FileViewer";
import { FileIconByName } from "./components/FileIconByName";
import { UploadTrackerPanel } from "./components/UploadTracker";
import { listUploadJobs, type UploadJob } from "./uploadTrackerApi";
import { getJSON } from "@/shared/api";
import { loadBool, saveBool, loadJSON, saveJSON } from "@/shared/persist";
import "./styles.css";

const LS_TRACKER_OPEN = "files:trackerOpen";
const LS_OPTIMISTIC = "files:optimisticJobs";
const LS_BATCH = "files:batchFilenames";
const LS_LAST_FOLDER = "files:lastFolder";

const LS_OCR_LANGUAGES = "files:ocrLanguages";
const LS_OCR_DOCMODE = "files:ocrDocMode";

const DT_INTERNAL_FILE = "application/x-lbpr-file";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
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

function basename(p: string) {
  const parts = (p || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function parentPath(p: string) {
  const parts = (p || "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function collectFolderPaths(root: TreeNode | null | undefined): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode | null | undefined) => {
    if (!n) return;
    if (n.type === "folder") out.push(n.path);
    for (const c of n.children || []) {
      if (c.type === "folder") walk(c);
    }
  };
  walk(root);
  return out;
}

function readInternalFileIds(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const raw = dt.getData(DT_INTERNAL_FILE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // New shape: { ids: string[] }
    if (Array.isArray(parsed?.ids)) {
      return parsed.ids.filter((x: any) => typeof x === "string" && x);
    }
    // Back-compat: { id: string }
    const id = parsed?.id;
    return typeof id === "string" && id ? [id] : [];
  } catch {
    return [];
  }
}

function uniqStrings(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((x) => typeof x === "string" && x)));
}

export default function FilesPage() {
  const isMobile = useMediaQuery("(max-width: 767px)");

  // Data
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);

  // Navigation
  const [selectedFolder, setSelectedFolder] = useState<string>(() => {
    return loadJSON<string>(LS_LAST_FOLDER, "") || "";
  });

  // LEFT TREE selection (separate from opened folder)
  const [treeSelectedKey, setTreeSelectedKey] = useState<string>(() => {
    const p = loadJSON<string>(LS_LAST_FOLDER, "") || "";
    return `d:${p}`;
  });

  // When selecting a file in the tree, we may navigate to its parent folder but keep file selection.
  const suppressNavClearRef = useRef<boolean>(false);

  // Selection (right panel)
  const [selectedFolderRowPaths, setSelectedFolderRowPaths] = useState<string[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const selectedFileSet = useMemo(() => new Set(selectedFileIds), [selectedFileIds]);
  const selectedFolderRowSet = useMemo(() => new Set(selectedFolderRowPaths), [selectedFolderRowPaths]);

// Internal drag (dnd-kit)
const suppressClickUntilRef = useRef<number>(0);
// After a marquee drag ends, browsers may still emit a synthetic `click` on the viewport.
// Use this to prevent the "background click clears selection" handler from immediately wiping
// the marquee selection.
const suppressBgClearUntilRef = useRef<number>(0);
const [activeInternalDrag, setActiveInternalDrag] = useState<{ count: number; label: string } | null>(null);
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  })
);


  // UI
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);

  // Background context menu (right-click in files tab)
  const [bgContextOpen, setBgContextOpen] = useState(false);
  const [bgContextKey, setBgContextKey] = useState(0);
  const resizeRef = useRef<HTMLDivElement>(null);

  // File input
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string>("");

  // Universal uploader: preview how selected files will affect quotas
  type LimitsResp = {
    plan: "FREE" | "PRO";
    window: string;
    caps: { messages: number; upload_tokens: number; transcribe_seconds: number; ocr_images: number };
    usage: { messages: number; upload_tokens: number; transcribe_seconds: number; ocr_images: number };
    remaining: { messages: number; upload_tokens: number; transcribe_seconds: number; ocr_images: number };
  };
  type PendingAction = "upload" | "ocr" | "transcribe";
  type PendingFile = { file: File; action: PendingAction; estTokens: number; estSeconds: number; estImages: number };

  const [limits, setLimits] = useState<LimitsResp | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);

  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<string>("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingComputing, setPendingComputing] = useState(false);
  const [pendingSummary, setPendingSummary] = useState<{ upload: number; ocr: number; transcribe: number }>({
    upload: 0,
    ocr: 0,
    transcribe: 0,
  });

  // Transcription input + modal
  const transcribeInputRef = useRef<HTMLInputElement>(null);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [transcribeFile, setTranscribeFile] = useState<File | null>(null);
  const [transcribeText, setTranscribeText] = useState<string>("");
  const [transcribeSegments, setTranscribeSegments] = useState<string[]>([]);
  const [transcribeDetected, setTranscribeDetected] = useState<string[]>([]);
  const [transcribeBilledSeconds, setTranscribeBilledSeconds] = useState<number | null>(null);
  const [transcribeMeta, setTranscribeMeta] = useState<Pick<TranscribeResponse, "model" | "location"> | null>(null);
  const [transcribeErr, setTranscribeErr] = useState<string | null>(null);
  const [transcribeLanguages, setTranscribeLanguages] = useState<string>("en-US,cs-CZ,it-IT");
  const [transcribeDiarization, setTranscribeDiarization] = useState<boolean>(false);
  const [transcribeModel, setTranscribeModel] = useState<string>("");
  const [savingTranscript, setSavingTranscript] = useState(false);

  // OCR input + modal
  const ocrInputRef = useRef<HTMLInputElement>(null);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrText, setOcrText] = useState<string>("");
  const [ocrErr, setOcrErr] = useState<string | null>(null);
  const [ocrLanguages, setOcrLanguages] = useState<string>(() => loadJSON<string>(LS_OCR_LANGUAGES, "en,cs,it"));
  const [ocrDocMode, setOcrDocMode] = useState<boolean>(() => loadBool(LS_OCR_DOCMODE, true));
  const [ocrMeta, setOcrMeta] = useState<Pick<OcrResponse, "mode" | "language_hints" | "images_charged"> | null>(null);
  const [savingOcr, setSavingOcr] = useState(false);

  // Drag overlay (OS files only)
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Delete modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);

  // Create folder modal
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState("");

  // Move modal
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);
  const [moveDest, setMoveDest] = useState<string>("");

  // Rename modal
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  // Viewer modal (with search + metadata)
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, Awaited<ReturnType<typeof getFileContent>>>>({});
  const [infileQuery, setInfileQuery] = useState("");
  const [infileIdx, setInfileIdx] = useState(0);

  // Mobile folders drawer
  const [mobileFoldersOpen, setMobileFoldersOpen] = useState(false);

  // Upload tracker panel
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [trackerRefreshKey, setTrackerRefreshKey] = useState<number>(0);
  const [optimisticJobs, setOptimisticJobs] = useState<UploadJob[]>([]);
  const [batchFilenames, setBatchFilenames] = useState<string[]>([]);
  const [seedFetched, setSeedFetched] = useState<UploadJob[]>([]);

  // Close mobile folders drawer automatically on desktop
  useEffect(() => {
    if (!isMobile) setMobileFoldersOpen(false);
  }, [isMobile]);

  useEffect(() => {
    saveJSON(LS_LAST_FOLDER, selectedFolder || "");
  }, [selectedFolder]);

  // Clear selection when navigating between folders
  useEffect(() => {
    if (suppressNavClearRef.current) {
      suppressNavClearRef.current = false;
      return;
    }
    setSelectedFileIds([]);
    setSelectedFolderRowPaths([]);
    selectionAnchorRef.current = null;
  }, [selectedFolder]);

  // Rehydrate tracker state
  useEffect(() => {
    const open = loadBool(LS_TRACKER_OPEN, false);
    setTrackerOpen(open);
    const opt = loadJSON<UploadJob[]>(LS_OPTIMISTIC, []);
    if (opt.length) setOptimisticJobs(opt);
    const bf = loadJSON<string[]>(LS_BATCH, []);
    if (bf.length) setBatchFilenames(bf);
    if (open) {
      listUploadJobs().then(setSeedFetched).catch(() => {});
      setTrackerRefreshKey(Date.now());
    }
  }, []);
  useEffect(() => saveBool(LS_TRACKER_OPEN, trackerOpen), [trackerOpen]);
  useEffect(() => saveJSON(LS_OPTIMISTIC, optimisticJobs), [optimisticJobs]);
  useEffect(() => saveJSON(LS_BATCH, batchFilenames), [batchFilenames]);

  const handleTrackerCleared = useCallback((scope: "done" | "all") => {
    if (scope === "all") {
      setOptimisticJobs([]);
      setBatchFilenames([]);
      setSeedFetched([]);
      return;
    }

    // "done": keep any running optimistic items, drop completed/error.
    setOptimisticJobs((prev) => prev.filter((j) => j.status === "running"));
    setSeedFetched((prev) => prev.filter((j) => j.status === "running"));
  }, []);

  // Persist OCR settings
  useEffect(() => saveJSON(LS_OCR_LANGUAGES, ocrLanguages), [ocrLanguages]);
  useEffect(() => saveBool(LS_OCR_DOCMODE, ocrDocMode), [ocrDocMode]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [fs, folders] = await Promise.all([listFiles(), listFolders()]);
      setFiles(fs);
      setFolderPaths(folders);
      const nextTree = buildTree(fs, folders);
      setTree(nextTree);
      // If selected folder no longer exists, fallback to root
      if (selectedFolder && !findNode(nextTree, selectedFolder)) setSelectedFolder("");
    } catch (err) {
      console.error("[files] refresh error", err);
      toast.error("Failed to load files", { description: parseErr(err) });
    } finally {
      setBusy(false);
    }
  }, [selectedFolder]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Resize (desktop)
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

  // -----------------------------
  // Universal uploader helpers
  // NOTE: Must be declared before any hook/effect that references them
  // (e.g. drag-and-drop effect) to avoid TDZ runtime errors.
  // -----------------------------

  const refreshLimits = useCallback(async () => {
    setLimitsLoading(true);
    try {
      const lim = await getJSON<LimitsResp>("/limits/me");
      setLimits(lim);
    } catch {
      // Limits are best-effort; user may be signed out or backend unreachable.
      setLimits(null);
    } finally {
      setLimitsLoading(false);
    }
  }, []);

  const estimateTokensFromText = (text: string): number => {
    // Conservative heuristic: tokens ~= chars/4 (typical English). Keep it simple.
    const chars = (text || "").length;
    return Math.max(0, Math.round(chars / 4));
  };

  const getAudioDurationSeconds = async (file: File): Promise<number> => {
    // Uses browser decoding; best-effort (some formats may fail).
    return await new Promise<number>((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        audio.preload = "metadata";
        audio.src = url;
        const cleanup = () => {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        };
        audio.onloadedmetadata = () => {
          const d = Number.isFinite(audio.duration) ? audio.duration : 0;
          cleanup();
          resolve(Math.max(0, d));
        };
        audio.onerror = () => {
          cleanup();
          resolve(0);
        };
      } catch {
        resolve(0);
      }
    });
  };

  const classifyFile = (f: File): PendingAction => {
    const ct = (f.type || "").toLowerCase();
    if (ct.startsWith("image/")) return "ocr";
    if (ct.startsWith("audio/")) return "transcribe";
    return "upload";
  };

  const preparePending = useCallback(
    async (fs: File[], folder: string) => {
      if (!fs.length) return;
      setPendingComputing(true);
      setPendingFolder(folder || "");
      setPendingFiles([]);
      setPendingSummary({ upload: 0, ocr: 0, transcribe: 0 });

      // Refresh limits right before showing the prompt
      refreshLimits();

      const out: PendingFile[] = [];
      for (const f of fs) {
        const action = classifyFile(f);
        let estTokens = 0;
        let estSeconds = 0;
        let estImages = 0;

        if (action === "upload") {
          // If it's a text file, read a bit more accurately; otherwise fall back to size heuristic.
          const ct = (f.type || "").toLowerCase();
          if (ct.startsWith("text/") || /\.(txt|md|markdown|csv|json|xml|yaml|yml)$/i.test(f.name)) {
            try {
              const t = await f.text();
              estTokens = estimateTokensFromText(t);
            } catch {
              estTokens = Math.max(1, Math.round(f.size / 4));
            }
          } else {
            estTokens = Math.max(1, Math.round(f.size / 4));
          }
        } else if (action === "ocr") {
          // OCR quota is measured in images. Most image uploads will count as 1.
          estImages = 1;
          // Also estimate upload tokens for the produced .ocr.txt (very rough).
          estTokens = 500;
        } else if (action === "transcribe") {
          estSeconds = Math.round(await getAudioDurationSeconds(f));
          // Very rough transcript token estimate: ~3.25 tokens/sec (150 wpm-ish).
          estTokens = Math.max(0, Math.round(estSeconds * 3.25));
        }

        out.push({ file: f, action, estTokens, estSeconds, estImages });
      }

      setPendingFiles(out);
      setPendingSummary({
        upload: out.filter((p) => p.action === "upload").length,
        ocr: out.filter((p) => p.action === "ocr").length,
        transcribe: out.filter((p) => p.action === "transcribe").length,
      });

      setPendingComputing(false);
      setUploadConfirmOpen(true);
    },
    [refreshLimits]
  );

  // Drag overlay (OS files only, within Files tab)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        setDragActive(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragActive(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      // only hide when leaving the root container entirely
      if ((e as any).relatedTarget === null) return;
      if (!el.contains((e as any).relatedTarget)) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        const fs = Array.from(e.dataTransfer.files || []);
        setDragActive(false);
        preparePending(fs, selectedFolder);
      }
    };

    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [selectedFolder, preparePending]);

  const totalSize = useMemo(() => files.reduce((acc, f) => acc + (f.size || 0), 0), [files]);
  const runningUploads = useMemo(() => optimisticJobs.some((j) => j.status === "running"), [optimisticJobs]);

  const treeForFolders = useMemo(() => {
    if (!tree) return null;
    // tree already includes folders+files; FileTree filters to folders
    return tree;
  }, [tree]);

  const treeRevealPaths = useMemo(() => {
    if (!treeSelectedKey) return [] as string[];
    if (treeSelectedKey.startsWith("d:")) {
      // Reveal the selected folder (expand its ancestors, but not the folder itself).
      return [treeSelectedKey.slice(2)];
    }
    if (treeSelectedKey.startsWith("f:")) {
      const id = treeSelectedKey.slice(2);
      const f = files.find((x) => x.id === id);
      if (!f) return [];
      // Reveal the file by expanding all ancestor folders.
      return [f.name];
    }
    return [];
  }, [treeSelectedKey, files]);

  const derivedFolderPaths = useMemo(() => {
    // union explicit folder paths + derived from tree to populate move targets
    const fromTree = collectFolderPaths(tree);
    const set = new Set<string>([...folderPaths, ...fromTree].map((p) => (p || "").split("/").filter(Boolean).join("/")));
    set.add("");
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [folderPaths, tree]);

  const currentNode = useMemo(() => findNode(tree, selectedFolder) || tree, [tree, selectedFolder]);
  const currentFolders = useMemo(() => (currentNode?.children || []).filter((c) => c.type === "folder"), [currentNode]);
  const currentFiles = useMemo(() => (currentNode?.children || []).filter((c) => c.type === "file"), [currentNode]);

  // Global index for search (folders + files). Used when the search box has a query.
  const allFolders = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      if (n.type === "folder") {
        if (n.path) out.push(n); // skip the synthetic root
        for (const c of n.children || []) walk(c);
      }
    };
    if (tree) walk(tree);
    return out;
  }, [tree]);

  const allFiles = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      if (n.type === "file") out.push(n);
      else for (const c of n.children || []) walk(c);
    };
    if (tree) walk(tree);
    return out;
  }, [tree]);

  const filteredCurrentFolders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return currentFolders;
    return allFolders
      // Match against the folder's own name only.
      // If we match against the full path, searching for "test" would also match
      // any descendant like "test/1" and "test/2".
      .filter((c) => (c.name || "").toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [currentFolders, allFolders, filter]);
  const filteredCurrentFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return currentFiles;
    return allFiles
      .filter((c) => {
        const n = (c.name || "").toLowerCase();
        const full = ((c.file?.name || "") as string).toLowerCase();
        // Same reasoning as folders: match against the file's own name only.
        // Otherwise, searching a folder name would pull in unrelated descendants.
        return n.includes(q) || full.includes(q);
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [currentFiles, allFiles, filter]);

  const visibleItemKeyOrder = useMemo(() => {
    const keys: string[] = [];
    for (const f of filteredCurrentFolders) keys.push(`d:${f.path}`);
    for (const n of filteredCurrentFiles) {
      const id = n.file?.id;
      if (id) keys.push(`f:${id}`);
    }
    return keys;
  }, [filteredCurrentFiles, filteredCurrentFolders]);

  const visibleIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    visibleItemKeyOrder.forEach((k, idx) => m.set(k, idx));
    return m;
  }, [visibleItemKeyOrder]);

  const clearSelection = useCallback(() => {
    setSelectedFileIds([]);
    setSelectedFolderRowPaths([]);
    selectionAnchorRef.current = null;
  }, []);

  const applySelectionFromKeys = useCallback(
    (keys: string[], mode: "replace" | "union", base?: { files: Set<string>; folders: Set<string> }) => {
      const files = new Set<string>(mode === "union" && base ? base.files : []);
      const folders = new Set<string>(mode === "union" && base ? base.folders : []);
      for (const k of keys) {
        if (k.startsWith("f:")) files.add(k.slice(2));
        else if (k.startsWith("d:")) folders.add(k.slice(2));
      }
      setSelectedFileIds(Array.from(files));
      setSelectedFolderRowPaths(Array.from(folders));
    },
    []
  );

  const selectByKey = useCallback(
    (key: string, e: React.MouseEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;
      const anchorKey = selectionAnchorRef.current;

      // Shift range select across folders + files in the visible list
      if (isShift && anchorKey && anchorKey !== key) {
        const a = visibleIndexByKey.get(anchorKey);
        const b = visibleIndexByKey.get(key);
        if (a !== undefined && b !== undefined) {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const range = visibleItemKeyOrder.slice(lo, hi + 1);
          applySelectionFromKeys(range, isMeta ? "union" : "replace", {
            files: new Set(selectedFileIds),
            folders: new Set(selectedFolderRowPaths),
          });
          selectionAnchorRef.current = key;
          return;
        }
        // If anchor/click not in list, fall through to single/toggle
      }

      if (isMeta) {
        if (key.startsWith("f:")) {
          const fileId = key.slice(2);
          setSelectedFileIds((prev) => {
            const set = new Set(prev);
            if (set.has(fileId)) set.delete(fileId);
            else set.add(fileId);
            return Array.from(set);
          });
        } else if (key.startsWith("d:")) {
          const path = key.slice(2);
          setSelectedFolderRowPaths((prev) => {
            const set = new Set(prev);
            if (set.has(path)) set.delete(path);
            else set.add(path);
            return Array.from(set);
          });
        }
        selectionAnchorRef.current = key;
        return;
      }

      // Replace selection
      if (key.startsWith("f:")) {
        setSelectedFileIds([key.slice(2)]);
        setSelectedFolderRowPaths([]);
      } else {
        setSelectedFolderRowPaths([key.slice(2)]);
        setSelectedFileIds([]);
      }
      selectionAnchorRef.current = key;
    },
    [applySelectionFromKeys, selectedFileIds, selectedFolderRowPaths, visibleIndexByKey, visibleItemKeyOrder]
  );

  const selectFile = useCallback(
    (fileId: string, e: React.MouseEvent) => {
      selectByKey(`f:${fileId}`, e);
    },
    [selectByKey]
  );

  const selectFolderRow = useCallback(
    (folderPath: string, e: React.MouseEvent) => {
      selectByKey(`d:${folderPath}`, e);
    },
    [selectByKey]
  );

  // --- Marquee (drag-box) selection in the right panel
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listBoxRef = useRef<HTMLDivElement>(null);
  // Viewport that covers the whole right-panel list area (including empty space below items).
  // We attach pointer handlers here so marquee works even when the bordered list doesn't fill the scroll height.
  const listViewportRef = useRef<HTMLDivElement>(null);
  const marqueeBoxRef = useRef<HTMLDivElement>(null);
  const [marqueeActive, setMarqueeActive] = useState(false);
  // While the pointer is down on empty space (potential marquee), suppress text selection.
  // This prevents the browser from selecting/highlighting UI text during drag gestures.
  const [marqueeDown, setMarqueeDown] = useState(false);
  const marqueeRafRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const marqueeLastSigRef = useRef<string>("");
  const marqueeStateRef = useRef<
    | null
    | {
        pointerId: number;
        startX: number;
        startY: number;
        lastX: number;
        lastY: number;
        downAt: number;
        started: boolean;
        moved: boolean;
        cleared: boolean;
        mode: "replace" | "union";
        base: { files: Set<string>; folders: Set<string> };
      }
  >(null);
  const bodyStyleRef = useRef<{ userSelect: string; cursor: string }>({ userSelect: "", cursor: "" });

  // Marquee UX tuning:
  // - Start only after the pointer has moved a bit (prevents "click-to-deselect" from flashing the drag-box)
  // - Add a tiny delay so quick clicks don’t feel like they trigger marquee instantly
  const MARQUEE_START_DIST_PX = 6;
  const MARQUEE_START_DELAY_MS = 90;
  const MARQUEE_START_DIST_NO_DELAY_PX = 14;


  useEffect(() => {
    return () => {
      if (marqueeRafRef.current) cancelAnimationFrame(marqueeRafRef.current);
      if (autoScrollRafRef.current) cancelAnimationFrame(autoScrollRafRef.current);
      // best-effort restore
      if (typeof document !== "undefined") {
        document.body.style.userSelect = bodyStyleRef.current.userSelect;
        document.body.style.cursor = bodyStyleRef.current.cursor;
      }
    };
  }, []);

  const setMarqueeBox = useCallback((rect: { left: number; top: number; width: number; height: number } | null) => {
    const el = marqueeBoxRef.current;
    if (!el) return;
    if (!rect) {
      el.style.transform = "translate(-99999px,-99999px)";
      el.style.width = "0px";
      el.style.height = "0px";
      return;
    }
    el.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }, []);

  const computeAndApplyMarquee = useCallback(() => {
    const st = marqueeStateRef.current;
    const viewport = listViewportRef.current || listBoxRef.current;
    const queryRoot = listScrollRef.current || listBoxRef.current;
    if (!st || !viewport || !queryRoot) return;

    const boxRect = viewport.getBoundingClientRect();
    const sx = st.startX;
    const sy = st.startY;
    const cx = st.lastX;
    const cy = st.lastY;

    const rawLeft = Math.min(sx, cx);
    const rawRight = Math.max(sx, cx);
    const rawTop = Math.min(sy, cy);
    const rawBottom = Math.max(sy, cy);

    const left = Math.max(boxRect.left, Math.min(rawLeft, boxRect.right));
    const right = Math.max(boxRect.left, Math.min(rawRight, boxRect.right));
    const top = Math.max(boxRect.top, Math.min(rawTop, boxRect.bottom));
    const bottom = Math.max(boxRect.top, Math.min(rawBottom, boxRect.bottom));

    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);

    // Track whether user actually dragged (vs click)
    const moved = Math.hypot(cx - sx, cy - sy) >= MARQUEE_START_DIST_PX;
    if (moved && !st.moved) st.moved = true;

    // Render box (coords relative to the list box)
    if (st.moved) {
      setMarqueeBox({ left: left - boxRect.left, top: top - boxRect.top, width: w, height: h });
    } else {
      setMarqueeBox(null);
    }

    // If the box is too small, don't apply selection yet
    if (!st.moved || w < 2 || h < 2) return;

    // Collect hit keys
    const hitKeys: string[] = [];
    const rows = queryRoot.querySelectorAll<HTMLElement>("[data-file-row],[data-folder-row]");
    for (const row of Array.from(rows)) {
      const r = row.getBoundingClientRect();
      const intersects = left <= r.right && right >= r.left && top <= r.bottom && bottom >= r.top;
      if (!intersects) continue;
      const fileId = (row as any).dataset?.fileId as string | undefined;
      if (fileId) {
        hitKeys.push(`f:${fileId}`);
        continue;
      }
      const folderPath = (row as any).dataset?.folderPath as string | undefined;
      if (folderPath) hitKeys.push(`d:${folderPath}`);
    }

    const files = new Set<string>(st.mode === "union" ? st.base.files : []);
    const folders = new Set<string>(st.mode === "union" ? st.base.folders : []);
    for (const k of hitKeys) {
      if (k.startsWith("f:")) files.add(k.slice(2));
      else if (k.startsWith("d:")) folders.add(k.slice(2));
    }

    // Avoid re-render spam when selection hasn't changed
    const nextSig = `${Array.from(files).sort().join("\n")}::${Array.from(folders).sort().join("\n")}`;
    if (nextSig === marqueeLastSigRef.current) return;
    marqueeLastSigRef.current = nextSig;

    setSelectedFileIds(Array.from(files));
    setSelectedFolderRowPaths(Array.from(folders));
  }, [setMarqueeBox]);

  const scheduleMarqueeUpdate = useCallback(() => {
    if (marqueeRafRef.current != null) return;
    marqueeRafRef.current = requestAnimationFrame(() => {
      marqueeRafRef.current = null;
      computeAndApplyMarquee();
    });
  }, [computeAndApplyMarquee]);

  const startAutoScrollLoop = useCallback(() => {
    if (autoScrollRafRef.current != null) return;
    const loop = () => {
      autoScrollRafRef.current = null;
      const st = marqueeStateRef.current;
      const scrollEl = listScrollRef.current;
      if (!st || !scrollEl) return;

      const r = scrollEl.getBoundingClientRect();
      const zone = 48;
      const speed = 18;
      let dy = 0;
      if (st.lastY < r.top + zone) dy = -speed;
      else if (st.lastY > r.bottom - zone) dy = speed;

      if (dy !== 0) {
        scrollEl.scrollTop += dy;
        // scrolling changes item rects; recompute selection even if pointer doesn't move
        scheduleMarqueeUpdate();
      }

      // Continue while active
      if (marqueeStateRef.current) autoScrollRafRef.current = requestAnimationFrame(loop);
    };
    autoScrollRafRef.current = requestAnimationFrame(loop);
  }, [scheduleMarqueeUpdate]);

  const endMarquee = useCallback(() => {
    const st = marqueeStateRef.current;
    marqueeStateRef.current = null;
    if (marqueeRafRef.current) {
      cancelAnimationFrame(marqueeRafRef.current);
      marqueeRafRef.current = null;
    }
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    setMarqueeBox(null);
    setMarqueeActive(false);
    setMarqueeDown(false);
    marqueeLastSigRef.current = "";
    if (typeof document !== "undefined") {
      document.body.style.userSelect = bodyStyleRef.current.userSelect;
      document.body.style.cursor = bodyStyleRef.current.cursor;
    }
    return st;
  }, [setMarqueeBox]);

  const breadcrumb = useMemo(() => {
    const parts = (selectedFolder || "").split("/").filter(Boolean);
    const items: Array<{ label: string; path: string }> = [{ label: "Files", path: "" }];
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      items.push({ label: p, path: cur });
    }
    return items;
  }, [selectedFolder]);

  const pendingTotals = useMemo(() => {
    const totals = { tokens: 0, seconds: 0, images: 0 };
    for (const p of pendingFiles) {
      totals.tokens += p.estTokens || 0;
      totals.seconds += p.estSeconds || 0;
      totals.images += p.estImages || 0;
    }
    return totals;
  }, [pendingFiles]);

  // --- Upload helpers
  const makeTempJob = (file: File, dataset: string = "default"): UploadJob => {
    const now = Math.floor(Date.now() / 1000);
    const tempId = `temp:${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))}`;
    return {
      job_id: tempId,
      uid: "me",
      filename: file.name,
      dataset,
      total_bytes: file.size,
      bytes: 0,
      phase: "receive",
      pct: 0,
      status: "running",
      error: null,
      created_at: now,
      updated_at: now,
    };
  };

  const handleFiles = useCallback(
    async (fs: File[], folder: string) => {
      if (fs.length === 0) return;
      setUploading(true);
      try {
        // Prefetch existing jobs so the tracker opens populated
        try {
          const existing = await listUploadJobs();
          setSeedFetched(existing);
        } catch {}

        // optimistic entries
        const temps = fs.map(makeTempJob);
        setOptimisticJobs(temps);
        setBatchFilenames(fs.map((f) => f.name));

        setTrackerOpen(true);
        toast.message("Uploads started", {
          description: folder ? `Uploading into “${folder}”` : "Uploading into Root",
        });

        // kick uploads
        if (fs.length === 1) {
          const { job_id } = await uploadFileToFolder(fs[0], folder || undefined);
          const tempId = temps[0].job_id;
          const now = Math.floor(Date.now() / 1000);
          setOptimisticJobs((list) => list.map((j) => (j.job_id === tempId ? { ...j, job_id, updated_at: now } : j)));
        } else {
          const { jobs } = await uploadFilesToFolder(fs, folder || undefined);
          const now = Math.floor(Date.now() / 1000);
          const idMap = new Map<string, string>();
          for (let i = 0; i < temps.length; i++) {
            if (jobs[i]) idMap.set(temps[i].job_id, jobs[i]);
          }
          setOptimisticJobs((list) => list.map((j) => (idMap.has(j.job_id) ? { ...j, job_id: idMap.get(j.job_id)!, updated_at: now } : j)));
        }

        setTrackerRefreshKey(Date.now());
        await refresh();
      } catch (err) {
        console.error(err);
        toast.error("Upload failed", { description: parseErr(err) });
        const now = Math.floor(Date.now() / 1000);
        const tempIds = new Set(optimisticJobs.map((t) => t.job_id));
        setOptimisticJobs((list) =>
          list.map((j) => (tempIds.has(j.job_id) ? { ...j, status: "error", phase: "error", updated_at: now, error: "Failed to start upload" } : j))
        );
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [optimisticJobs, refresh]
  );

  const startUploadTo = (folder: string) => {
    uploadTargetRef.current = folder || "";
    inputRef.current?.click();
  };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = Array.from(e.target.files || []);
    const folder = uploadTargetRef.current || selectedFolder || "";
    await preparePending(fs, folder);
    // Reset so picking the same file again triggers onChange
    if (inputRef.current) inputRef.current.value = "";
  };

  const executePending = useCallback(async () => {
    if (!pendingFiles.length) {
      setUploadConfirmOpen(false);
      return;
    }

    setUploadConfirmOpen(false);

    const folder = pendingFolder || "";
    const uploads = pendingFiles.filter((p) => p.action === "upload").map((p) => p.file);
    const images = pendingFiles.filter((p) => p.action === "ocr").map((p) => p.file);
    const audios = pendingFiles.filter((p) => p.action === "transcribe").map((p) => p.file);

    // 1) Regular file uploads
    if (uploads.length) {
      await handleFiles(uploads, folder);
    }

    // 2) OCR images -> save extracted text into files
    for (const img of images) {
      try {
        const mode: OcrMode = ocrDocMode ? "document" : "text";
        const resp = await runOcr(img, { languages: parseLanguageCodes(ocrLanguages), mode });
        const base = img.name.replace(/\.[^/.]+$/, "") || "ocr";
        const filename = `${base}.ocr.txt`;
        const blob = new Blob([resp.text || ""], { type: "text/plain;charset=utf-8" });
        const out = new File([blob], filename, { type: "text/plain" });
        await uploadFileToFolder(out, folder || undefined);
        toast.success("OCR saved", {
          description: folder ? `Saved ${filename} into “${folder}”.` : `Saved ${filename} into Root.`,
        });
      } catch (e) {
        toast.error("OCR failed", { description: parseErr(e) });
      }
    }

    // 3) Transcribe audio -> save transcript into files
    for (const au of audios) {
      try {
        const resp = await transcribeAudio(au, {
          languages: parseLanguageCodes(transcribeLanguages),
          diarization: transcribeDiarization,
          model: (transcribeModel || "").trim() || undefined,
        });
        const base = au.name.replace(/\.[^/.]+$/, "") || "transcript";
        const filename = `${base}.transcript.txt`;
        const blob = new Blob([resp.text || ""], { type: "text/plain;charset=utf-8" });
        const out = new File([blob], filename, { type: "text/plain" });
        await uploadFileToFolder(out, folder || undefined);
        toast.success("Transcript saved", {
          description:
            typeof resp.billed_seconds === "number"
              ? `Saved ${filename}. Billed ${Math.max(0, Math.round(resp.billed_seconds))}s.`
              : `Saved ${filename}.`,
        });
      } catch (e) {
        toast.error("Transcription failed", { description: parseErr(e) });
      }
    }

    // refresh file list + limits after batch
    setTrackerRefreshKey(Date.now());
    await refresh();
    refreshLimits();
    setPendingFiles([]);
  }, [
    pendingFiles,
    pendingFolder,
    handleFiles,
    ocrDocMode,
    ocrLanguages,
    transcribeLanguages,
    transcribeDiarization,
    transcribeModel,
    refresh,
    refreshLimits,
  ]);

  // --- Transcription helpers
  const parseLanguageCodes = (raw: string): string[] => {
    const parts = (raw || "")
      .split(/[,\s]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
    // de-dup while preserving order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      if (!seen.has(p)) {
        out.push(p);
        seen.add(p);
      }
    }
    return out;
  };

  const pickTranscribeFile = () => {
    transcribeInputRef.current?.click();
  };

  const onPickTranscribeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f) {
      setTranscribeFile(f);
      setTranscribeErr(null);
    }
    // reset input so picking the same file again triggers onChange
    if (transcribeInputRef.current) transcribeInputRef.current.value = "";
  };

  const runTranscription = async () => {
    if (!transcribeFile || transcribeBusy) return;
    setTranscribeBusy(true);
    setTranscribeErr(null);
    setTranscribeText("");
    setTranscribeSegments([]);
    setTranscribeDetected([]);
    setTranscribeBilledSeconds(null);
    setTranscribeMeta(null);

    const temp = makeTempJob(transcribeFile, "transcription");
    try {
      // Prefetch existing jobs so the tracker opens populated
      try {
        const existing = await listUploadJobs();
        setSeedFetched(existing);
      } catch {}

      setOptimisticJobs((list) => [temp, ...list]);
      setBatchFilenames([transcribeFile.name]);
      setTrackerOpen(true);
      setTrackerRefreshKey(Date.now());

      const resp = await transcribeAudio(transcribeFile, {
        languages: parseLanguageCodes(transcribeLanguages),
        diarization: transcribeDiarization,
        model: (transcribeModel || "").trim() || undefined,
      });

      setTranscribeText(resp.text || "");
      setTranscribeSegments(resp.segments || []);
      setTranscribeDetected(resp.detected_languages || []);
      setTranscribeBilledSeconds(typeof resp.billed_seconds === "number" ? resp.billed_seconds : null);
      setTranscribeMeta({ model: resp.model, location: resp.location });

      const now = Math.floor(Date.now() / 1000);
      setOptimisticJobs((list) =>
        list.map((j) =>
          j.job_id === temp.job_id
            ? {
                ...j,
                job_id: resp.job_id || j.job_id,
                status: "done",
                phase: "complete",
                pct: 100,
                bytes: j.total_bytes,
                updated_at: now,
              }
            : j
        )
      );

      toast.success("Transcription ready", {
        description:
          typeof resp.billed_seconds === "number"
            ? `Billed ${Math.max(0, Math.round(resp.billed_seconds))}s.`
            : "",
      });

      setTrackerRefreshKey(Date.now());
    } catch (err) {
      console.error(err);
      const msg = parseErr(err);
      setTranscribeErr(msg);
      const now = Math.floor(Date.now() / 1000);
      setOptimisticJobs((list) =>
        list.map((j) => (j.job_id === temp.job_id ? { ...j, status: "error", phase: "error", updated_at: now, error: msg } : j))
      );
      toast.error("Transcription failed", { description: msg });
    } finally {
      setTranscribeBusy(false);
    }
  };

  const saveTranscriptToFiles = async () => {
    if (!transcribeFile || !transcribeText.trim() || savingTranscript) return;
    setSavingTranscript(true);
    try {
      const base = transcribeFile.name.replace(/\.[^/.]+$/, "") || "transcript";
      const filename = `${base}.transcript.txt`;
      const blob = new Blob([transcribeText], { type: "text/plain;charset=utf-8" });
      const out = new File([blob], filename, { type: "text/plain" });
      await uploadFileToFolder(out, selectedFolder || undefined);
      toast.success("Saved transcript", {
        description: selectedFolder ? `Saved into “${selectedFolder}”.` : "Saved into Root.",
      });
      setTrackerRefreshKey(Date.now());
      await refresh();
    } catch (e) {
      toast.error("Save failed", { description: parseErr(e) });
    } finally {
      setSavingTranscript(false);
    }
  };

  // --- OCR helpers
  const pickOcrFile = () => {
    ocrInputRef.current?.click();
  };

  const onPickOcrFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f) {
      setOcrFile(f);
      setOcrErr(null);
      setOcrText("");
      setOcrMeta(null);
    }
    // reset input so picking the same file again triggers onChange
    if (ocrInputRef.current) ocrInputRef.current.value = "";
  };

  const runOcrWithFile = async (file: File) => {
    if (!file || ocrBusy) return;
    setOcrBusy(true);
    setOcrErr(null);
    setOcrText("");
    setOcrMeta(null);
    setOcrFile(file);
    setOcrOpen(true);

    const tempBase = makeTempJob(file, "ocr");
    const temp: UploadJob = { ...tempBase, phase: "ocr" };

    try {
      // Prefetch existing jobs so the tracker opens populated
      try {
        const existing = await listUploadJobs();
        setSeedFetched(existing);
      } catch {}

      setOptimisticJobs((list) => [temp, ...list]);
      setBatchFilenames([file.name]);
      setTrackerOpen(true);
      setTrackerRefreshKey(Date.now());

      const mode: OcrMode = ocrDocMode ? "document" : "text";
      const resp = await runOcr(file, {
        languages: parseLanguageCodes(ocrLanguages),
        mode,
      });

      setOcrText(resp.text || "");
      setOcrMeta({ mode: resp.mode, language_hints: resp.language_hints, images_charged: resp.images_charged });

      const now = Math.floor(Date.now() / 1000);
      setOptimisticJobs((list) =>
        list.map((j) =>
          j.job_id === temp.job_id
            ? {
                ...j,
                job_id: resp.job_id || j.job_id,
                status: "done",
                phase: "complete",
                pct: 100,
                bytes: j.total_bytes,
                updated_at: now,
              }
            : j
        )
      );

      toast.success("OCR ready", {
        description:
          typeof resp.images_charged === "number"
            ? `Charged ${Math.max(0, resp.images_charged)} image${resp.images_charged === 1 ? "" : "s"}.`
            : "",
      });

      setTrackerRefreshKey(Date.now());
    } catch (err) {
      console.error(err);
      const msg = parseErr(err);
      setOcrErr(msg);
      const now = Math.floor(Date.now() / 1000);
      setOptimisticJobs((list) =>
        list.map((j) => (j.job_id === temp.job_id ? { ...j, status: "error", phase: "error", updated_at: now, error: msg } : j))
      );
      toast.error("OCR failed", { description: msg });
    } finally {
      setOcrBusy(false);
    }
  };

  const runOcrFromPicker = async () => {
    if (!ocrFile || ocrBusy) return;
    await runOcrWithFile(ocrFile);
  };

  const saveOcrToFiles = async () => {
    if (!ocrFile || !ocrText.trim() || savingOcr) return;
    setSavingOcr(true);
    try {
      const base = ocrFile.name.replace(/\.[^/.]+$/, "") || "ocr";
      const filename = `${base}.ocr.txt`;
      const blob = new Blob([ocrText], { type: "text/plain;charset=utf-8" });
      const out = new File([blob], filename, { type: "text/plain" });
      await uploadFileToFolder(out, selectedFolder || undefined);
      toast.success("Saved OCR text", {
        description: selectedFolder ? `Saved into “${selectedFolder}”.` : "Saved into Root.",
      });
      setTrackerRefreshKey(Date.now());
      await refresh();
    } catch (e) {
      toast.error("Save failed", { description: parseErr(e) });
    } finally {
      setSavingOcr(false);
    }
  };

  // --- Folder & file actions
  const requestDelete = (file: FileItem) => {
    setFileToDelete(file);
    setConfirmOpen(true);
  };

  const performDelete = async () => {
    if (!fileToDelete) return;
    setDeleting(true);
    try {
      await deleteFile(fileToDelete.id);
      toast.success("File deleted", { description: `“${basename(fileToDelete.name)}” removed.` });
      if (viewerId === fileToDelete.id) {
        setViewerOpen(false);
        setViewerId(null);
      }
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

  const requestNewFolder = (parent: string) => {
    setNewFolderParent(parent || "");
    setNewFolderName("");
    setNewFolderOpen(true);
  };

  const performNewFolder = async () => {
    const name = (newFolderName || "").trim().replace(/^\/+|\/+$/g, "");
    if (!name) return;
    const path = newFolderParent ? `${newFolderParent}/${name}` : name;
    try {
      await createFolder(path);
      toast.success("Folder created", { description: `“${path}”` });
      setNewFolderOpen(false);
      await refresh();
      setSelectedFolder(newFolderParent || "");
    } catch (err) {
      toast.error("Create folder failed", { description: parseErr(err) });
    }
  };

  const moveFilesToFolder = async (fileIds: string[], folder: string) => {
    const ids = uniqStrings(fileIds);
    if (ids.length === 0) return;
    const dest = (folder || "").split("/").filter(Boolean).join("/");

    try {
      const results = await Promise.allSettled(
        ids.map((id) => updateFile(id, { folder: dest ? dest : null }))
      );
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      if (failed.length) {
        const first = failed[0]?.reason;
        toast.error("Move failed", {
          description: failed.length === 1
            ? parseErr(first)
            : `${failed.length} of ${ids.length} failed. ${parseErr(first)}`,
        });
      } else {
        toast.success("Moved", {
          description:
            ids.length === 1
              ? dest ? `Moved into “${dest}”` : "Moved to Root"
              : dest ? `Moved ${ids.length} files into “${dest}”` : `Moved ${ids.length} files to Root`,
        });
      }

      setSelectedFileIds([]);
      setSelectedFolderRowPaths([]);
      selectionAnchorRef.current = null;
      await refresh();
    } catch (err) {
      toast.error("Move failed", { description: parseErr(err) });
    }
  };

  const moveFileToFolder = async (fileId: string, folder: string) => {
    return moveFilesToFolder([fileId], folder);
  };

  const requestMove = (file: FileItem) => {
    setMoveFile(file);
    setMoveDest(parentPath(file.name));
    setMoveOpen(true);
  };

  const performMove = async () => {
    if (!moveFile) return;
    await moveFileToFolder(moveFile.id, (moveDest || "").split("/").filter(Boolean).join("/"));
    setMoveOpen(false);
    setMoveFile(null);
  };

  const requestRename = (file: FileItem) => {
    setRenameFile(file);
    setRenameValue(basename(file.name));
    setRenameOpen(true);
  };

  const performRename = async () => {
    if (!renameFile) return;
    const newName = (renameValue || "").trim().replace(/^\/+|\/+$/g, "");
    if (!newName) return;
    const folder = parentPath(renameFile.name);
    try {
      await updateFile(renameFile.id, { folder: folder ? folder : null, name: newName });
      toast.success("Renamed", { description: `“${newName}”` });
      setRenameOpen(false);
      setRenameFile(null);
      await refresh();
    } catch (err) {
      toast.error("Rename failed", { description: parseErr(err) });
    }
  };

  // --- Viewer modal
  const viewerFile = useMemo(() => (viewerId ? files.find((f) => f.id === viewerId) || null : null), [viewerId, files]);
  const viewerPayload = viewerId ? content[viewerId] : undefined;
  const canSearchInFile = viewerPayload?.kind === "text";

  const matchCount = useMemo(() => {
    if (!canSearchInFile) return 0;
    const q = (infileQuery || "").trim();
    if (!q) return 0;
    const text = (viewerPayload as any)?.text || "";
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    let cnt = 0;
    while (re.exec(text)) cnt++;
    return cnt;
  }, [canSearchInFile, infileQuery, viewerPayload]);

  useEffect(() => {
    setInfileIdx(0);
  }, [infileQuery, viewerId]);

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

  const openViewer = async (file: FileItem) => {
    setViewerId(file.id);
    setViewerOpen(true);
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
  // --- Right panel drop target (external OS file drops into current folder)
  const onDropIntoCurrent = (e: React.DragEvent) => {
    if (!isExternalFilesDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    const fs = Array.from(e.dataTransfer.files || []);
    if (fs.length) preparePending(fs, selectedFolder);
  };

  // --- Background context menu actions
  const bgUpload = () => startUploadTo(selectedFolder);
  const bgNewFolder = () => requestNewFolder(selectedFolder);
  const bgRefresh = () => refresh();

  return (
    <div ref={rootRef} className="h-full min-h-0 flex flex-col relative">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button
          variant="outline"
          size="sm"
          className="md:hidden"
          onClick={() => setMobileFoldersOpen(true)}
          title="Browse folders"
        >
          <Folder className="h-4 w-4" />
          <span className="ml-1.5">Folders</span>
        </Button>

        <Button onClick={() => startUploadTo(selectedFolder)} disabled={uploading} size="sm">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span className="ml-1.5">{uploading ? "Uploading…" : "Upload"}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => requestNewFolder(selectedFolder)} title="New folder">
          <FolderPlus className="h-4 w-4" />
          <span className="ml-1.5 hidden sm:inline">New folder</span>
        </Button>
        <Input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={onChange}
          multiple
          accept="image/*,audio/*,text/*,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.pdf,.doc,.docx"
        />
        <Input ref={transcribeInputRef} type="file" accept="audio/*,video/*" className="hidden" onChange={onPickTranscribeFile} />
        <Input ref={ocrInputRef} type="file" accept="image/*" className="hidden" onChange={onPickOcrFile} />

        <div className="relative w-full md:max-w-sm md:w-full md:order-none order-last">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search folders & files…"
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
<DndContext
  sensors={sensors}
  onDragStart={(evt: DragStartEvent) => {
    const a = parseDndId(evt.active.id);
    if (!a || a.kind !== "file") return;
    const fileId = a.value;
    const alreadySelected = selectedFileSet.has(fileId);
    const ids = alreadySelected ? selectedFileIds : [fileId];
    if (!alreadySelected) {
      setSelectedFileIds([fileId]);
      setSelectedFolderRowPaths([]);
      selectionAnchorRef.current = `f:${fileId}`;
    }
    const name = files.find((f) => f.id === fileId)?.name || "File";
    setActiveInternalDrag({
      count: ids.length,
      label: ids.length > 1 ? `${ids.length} items` : name,
    });
  }}
  onDragEnd={(evt: DragEndEvent) => {
    setActiveInternalDrag(null);
    const a = parseDndId(evt.active.id);
    const o = parseDndId(evt.over?.id);
    if (!a || a.kind !== "file" || !o || o.kind !== "folder") return;
    const fileId = a.value;
    const dest = normalizeFolderPath(o.value);
    const ids = selectedFileSet.has(fileId) ? selectedFileIds : [fileId];
    if (!ids.length) return;
    suppressClickUntilRef.current = Date.now() + 250;
    moveFilesToFolder(ids, dest);
  }}
  onDragCancel={() => setActiveInternalDrag(null)}
>
      <ContextMenu open={bgContextOpen} onOpenChange={setBgContextOpen}>
        <ContextMenuTrigger asChild>
          <div
            className="flex min-h-0 flex-1"
            onContextMenuCapture={() => {
              if (bgContextOpen) {
                flushSync(() => {
                  setBgContextOpen(false);
                  setBgContextKey((k) => k + 1);
                });
              } else {
                setBgContextKey((k) => k + 1);
              }
            }}
          >
            {/* LEFT: folders */}
            <aside className="hidden md:block shrink-0 overflow-hidden border-r bg-muted/20" style={{ width: sidebarWidth }}>
              <div className="h-full overflow-auto px-1 py-2">
                <FileTree
                  loading={busy && (!tree || files.length === 0)}
                  node={treeForFolders}
                  selectedKey={treeSelectedKey}
                  revealPaths={treeRevealPaths}
                  suppressClickUntilRef={suppressClickUntilRef}
                  onSelectFolder={(p) => setTreeSelectedKey(`d:${p}`)}
                  onOpenFolder={(p) => {
                    setTreeSelectedKey(`d:${p}`);
                    setSelectedFolder(p);
                  }}
                  onSelectFile={(file) => {
                    setTreeSelectedKey(`f:${file.id}`);
                    const folder = parentPath(file.name);
                    if (folder !== selectedFolder) {
                      suppressNavClearRef.current = true;
                      setSelectedFolder(folder);
                    }
                    setSelectedFileIds([file.id]);
                    setSelectedFolderRowPaths([]);
                    selectionAnchorRef.current = `f:${file.id}`;
                  }}
                  onOpenFile={(file) => {
                    setTreeSelectedKey(`f:${file.id}`);
                    const folder = parentPath(file.name);
                    if (folder !== selectedFolder) {
                      suppressNavClearRef.current = true;
                      setSelectedFolder(folder);
                    }
                    setSelectedFileIds([file.id]);
                    setSelectedFolderRowPaths([]);
                    selectionAnchorRef.current = `f:${file.id}`;
                    openViewer(file);
                  }}
                  onUploadTo={(p) => startUploadTo(p)}
                  onNewFolder={(p) => requestNewFolder(p)}
                  onMoveFilesTo={(fileIds, folderPath) => moveFilesToFolder(fileIds, folderPath)}
                  onDropFilesTo={(folderPath, fs) => preparePending(fs, folderPath)}
                />
              </div>
            </aside>

            {/* RESIZE HANDLE */}
            <div
              ref={resizeRef}
              onMouseDown={() => setIsResizing(true)}
              className={cn(
                "hidden md:block w-1 cursor-col-resize bg-transparent hover:bg-primary/20 transition-colors",
                isResizing && "bg-primary/30"
              )}
              title="Drag to resize"
            />

            {/* RIGHT: explorer list */}
<CurrentFolderDrop
  folderPath={selectedFolder}
  className="flex-1 min-w-0 flex flex-col"
  onDragOver={(e) => {
    if (!isExternalFilesDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }}
  onDrop={onDropIntoCurrent}
>
  {/* Breadcrumb row */}

              <div className="h-10 border-b bg-background flex items-center gap-2 px-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedFolder(parentPath(selectedFolder))}
                  disabled={!selectedFolder}
                  title="Up"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex items-center gap-1 text-sm">
                  {breadcrumb.map((b, idx) => (
                    <div key={b.path || "root"} className="flex items-center min-w-0">
                      <button
                        className={cn(
                          "truncate max-w-[22vw] md:max-w-[18rem] hover:underline",
                          idx === breadcrumb.length - 1 && "font-medium"
                        )}
                        onClick={() => setSelectedFolder(b.path)}
                        title={b.path || "Root"}
                      >
                        {b.label}
                      </button>
                      {idx < breadcrumb.length - 1 && <ChevronRight className="h-4 w-4 opacity-60 mx-1" />}
                    </div>
                  ))}
                </div>
                <div className="flex-1" />
                <div className="text-xs text-muted-foreground hidden sm:block">
                  {filteredCurrentFolders.length} folder{filteredCurrentFolders.length === 1 ? "" : "s"} • {filteredCurrentFiles.length} file{filteredCurrentFiles.length === 1 ? "" : "s"}
                </div>
              </div>

              {/* List */}
              <div
                ref={listViewportRef}
                className={cn("flex-1 min-h-0 relative", marqueeDown && "select-none")}
                onContextMenu={(e) => {
                  const el = e.target as HTMLElement | null;
                  if (el && (el.closest("[data-file-row]") || el.closest("[data-folder-row]"))) return;
                  // If we just completed a marquee selection, ignore the synthetic contextmenu.
                  if (Date.now() < suppressBgClearUntilRef.current) return;
                  clearSelection();
                }}
                onClick={(e) => {
                  const el = e.target as HTMLElement | null;
                  if (el && (el.closest("[data-file-row]") || el.closest("[data-folder-row]"))) return;
                  if ((e as any).metaKey || (e as any).ctrlKey) return;
                  // Browsers may emit a click after a drag; avoid clearing marquee selection.
                  if (Date.now() < suppressBgClearUntilRef.current) return;
                  if (Date.now() < suppressClickUntilRef.current) return;
                  clearSelection();
                }}
                onPointerDown={(e) => {
                  // Disable for touch; allow on narrow windows (isMobile) if a mouse is used.
                  if (e.pointerType === "touch") return;
                  if (e.button !== 0) return;
                  const el = e.target as HTMLElement | null;
                  if (el && (el.closest("[data-file-row]") || el.closest("[data-folder-row]"))) return;
                  // If we just completed a dnd move, suppress background drag-box start.
                  if (Date.now() < suppressClickUntilRef.current) return;

                  // Don't start marquee when the user is grabbing the scrollbar.
                  const scrollEl = listScrollRef.current;
                  if (scrollEl) {
                    const r = scrollEl.getBoundingClientRect();
                    const sbW = Math.max(0, scrollEl.offsetWidth - scrollEl.clientWidth);
                    const sbH = Math.max(0, scrollEl.offsetHeight - scrollEl.clientHeight);
                    if (sbW > 0 && e.clientX >= r.right - sbW) return;
                    if (sbH > 0 && e.clientY >= r.bottom - sbH) return;
                  }

                  const mode: "replace" | "union" = e.metaKey || e.ctrlKey ? "union" : "replace";
                  marqueeLastSigRef.current = "";
                  marqueeStateRef.current = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    lastX: e.clientX,
                    lastY: e.clientY,
                    downAt: Date.now(),
                    started: false,
                    moved: false,
                    cleared: false,
                    mode,
                    base: {
                      files: new Set(selectedFileIds),
                      folders: new Set(selectedFolderRowPaths),
                    },
                  };

                  // We'll only show the box / apply styles once the user actually moves far enough.
                  if (typeof document !== "undefined") {
                    bodyStyleRef.current = {
                      userSelect: document.body.style.userSelect,
                      cursor: document.body.style.cursor,
                    };
                    // Immediately suppress text selection on background-drag gestures.
                    // (Without this, the browser may highlight lots of UI text while dragging.)
                    document.body.style.userSelect = "none";
                  }

                  setMarqueeDown(true);

                  // Prevent native text selection / drag behaviors from starting.
                  e.preventDefault();

                  try {
                    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                  } catch {}
                }}
                onPointerMove={(e) => {
                  const st = marqueeStateRef.current;
                  if (!st || st.pointerId !== e.pointerId) return;
                  // Prevent the browser from selecting text while the pointer is down.
                  e.preventDefault();
                  st.lastX = e.clientX;
                  st.lastY = e.clientY;

                  // Start marquee only after a small movement + slight delay (prevents "click-to-deselect" from feeling like it triggers the box).
                  if (!st.started) {
                    const dist = Math.hypot(st.lastX - st.startX, st.lastY - st.startY);
                    const elapsed = Date.now() - st.downAt;

                    if (dist < MARQUEE_START_DIST_PX) return;
                    if (elapsed < MARQUEE_START_DELAY_MS && dist < MARQUEE_START_DIST_NO_DELAY_PX) return;

                    st.started = true;
                    st.moved = true;

                    // Explorer-like: dragging on empty space without Ctrl replaces selection (clear once, when we truly start dragging).
                    if (st.mode === "replace" && !st.cleared) {
                      setSelectedFileIds([]);
                      setSelectedFolderRowPaths([]);
                      st.cleared = true;
                    }

                    // Prevent text selection while dragging (keep cursor unchanged)
                    if (typeof document !== "undefined") {
                      document.body.style.userSelect = "none";
                    }

                    setMarqueeActive(true);
                    startAutoScrollLoop();
                  }

                  scheduleMarqueeUpdate();
                }}
                
                onPointerUp={(e) => {
                  const st = marqueeStateRef.current;
                  if (!st || st.pointerId !== e.pointerId) return;
                  st.lastX = e.clientX;
                  st.lastY = e.clientY;

                  // Only apply marquee selection if we actually started dragging.
                  if (st.started) computeAndApplyMarquee();

                  const finished = endMarquee();
                  if (finished?.started) {
                    // Prevent the follow-up synthetic click from clearing the selection.
                    suppressBgClearUntilRef.current = Date.now() + 250;
                  }
                  try {
                    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
                  } catch {}
                  // Click on empty space (no drag) clears selection unless Ctrl/Cmd was held.
                  if (finished && !finished.started && finished.mode === "replace") clearSelection();
                  e.preventDefault();
                }}
                
                onPointerCancel={(e) => {
                  const st = marqueeStateRef.current;
                  if (!st || st.pointerId !== e.pointerId) return;
                  const finished = endMarquee();
                  if (finished?.started) suppressBgClearUntilRef.current = Date.now() + 250;
                  try {
                    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
                  } catch {}
                  e.preventDefault();
                }}
              >
                <div ref={listScrollRef} className="absolute inset-0 overflow-auto">
                  <div className="px-2 py-2">
                    {/* Header */}
                    <div className="hidden md:grid grid-cols-[minmax(12rem,1fr)_8rem_9rem_10rem] gap-2 px-2 py-1 text-xs text-muted-foreground">
                      <div>Name</div>
                      <div className="text-right">Size</div>
                      <div>Type</div>
                      <div>Created</div>
                    </div>
                    <div ref={listBoxRef} className="border rounded-md overflow-hidden relative">
                    {filteredCurrentFolders.length === 0 && filteredCurrentFiles.length === 0 ? (
                      <div className="p-6 text-sm text-muted-foreground">
                        {filter.trim()
                          ? <>No results for <span className="font-medium">“{filter.trim()}”</span>.</>
                          : <>This folder is empty. Right-click to create a folder or upload files.</>}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {filteredCurrentFolders.map((n) => (
                          <FolderRow
                            key={n.path}
                            node={n}
                            selected={selectedFolderRowSet.has(n.path)}
                            suppressClickUntilRef={suppressClickUntilRef}
                            onSelect={(e) => selectFolderRow(n.path, e)}
                            onOpen={() => setSelectedFolder(n.path)}
                            onUploadHere={() => startUploadTo(n.path)}
                            onNewFolderHere={() => requestNewFolder(n.path)}
                            onMoveFilesTo={(fileIds) => moveFilesToFolder(fileIds, n.path)}
                            onDropFilesHere={(fs) => handleFiles(fs, n.path)}
                          />
                        ))}
                        {filteredCurrentFiles.map((n) => (
                          <FileRow
                            key={n.file?.id || n.path}
                            node={n}
                            selected={!!(n.file?.id && selectedFileSet.has(n.file.id))}
                            onSelect={(e) => n.file && selectFile(n.file.id, e)}
                            onOpen={() => n.file && openViewer(n.file)}
                            onDelete={() => n.file && requestDelete(n.file)}
                            onRename={() => n.file && requestRename(n.file)}
                            onMove={() => n.file && requestMove(n.file)}
                          />
                        ))}
                      </div>
                    )}
                    </div>
                  </div>
                </div>

                {/* Drag-box selection overlay (covers the whole viewport so it works over empty space too) */}
                {marqueeActive && (
                  <div className="pointer-events-none absolute inset-0 z-20">
                    <div
                      ref={marqueeBoxRef}
                      className="absolute border border-primary bg-primary/10 rounded-sm"
                      style={{ transform: "translate(-99999px,-99999px)", width: 0, height: 0 }}
                    />
                  </div>
                )}
              </div>
            </CurrentFolderDrop>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent key={bgContextKey} className="min-w-[13rem]">
          <ContextMenuItem onSelect={bgUpload}>
            <Upload className="h-4 w-4" /> Upload
          </ContextMenuItem>
          <ContextMenuItem onSelect={bgNewFolder}>
            <FolderPlus className="h-4 w-4" /> New folder…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={bgRefresh}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </ContextMenuItem>
        </ContextMenuContent>
</ContextMenu>

<DragOverlay>
  {activeInternalDrag ? (
    <div className="rounded-lg border bg-background shadow-lg px-4 py-2 text-sm">
      Moving {activeInternalDrag.count} item{activeInternalDrag.count === 1 ? "" : "s"}
    </div>
  ) : null}
</DragOverlay>

</DndContext>

{/* Drag overlay */}
      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-20 grid place-items-center bg-background/80 backdrop-blur border-2 border-dashed border-primary">
          <div className="pointer-events-auto rounded-xl border bg-background shadow-lg px-6 py-4 text-center">
            <div className="text-sm font-medium">Drop files to upload</div>
            <div className="text-xs text-muted-foreground mt-1">
              Uploading into {selectedFolder ? `“${selectedFolder}”` : "Root"}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <span className="font-medium">{fileToDelete?.name}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={performDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New folder */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Create a folder in {newFolderParent ? `“${newFolderParent}”` : "Root"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") performNewFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={performNewFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move file</DialogTitle>
            <DialogDescription>
              Choose a destination folder for <span className="font-medium">{moveFile ? basename(moveFile.name) : ""}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              placeholder="Destination folder (blank = Root)"
              value={moveDest}
              onChange={(e) => setMoveDest(e.target.value)}
              list="folder-options"
              onKeyDown={(e) => {
                if (e.key === "Enter") performMove();
              }}
            />
            <datalist id="folder-options">
              {derivedFolderPaths.filter((p) => p).map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <div className="text-xs text-muted-foreground">Tip: right-click folders to upload or create subfolders.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={performMove} disabled={!moveFile}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>Rename the file (folder stays the same).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="New name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") performRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={performRename} disabled={!renameValue.trim() || !renameFile}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Universal upload: quota preview */}
      <AlertDialog open={uploadConfirmOpen} onOpenChange={setUploadConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm upload</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingComputing ? (
                "Preparing quota preview…"
              ) : (
                <span>
                  This action will upload files to {pendingFolder ? `“${pendingFolder}”` : "Root"}. Images will be OCR’d and saved as <span className="font-mono">.ocr.txt</span>. Audio will be transcribed and saved as <span className="font-mono">.transcript.txt</span>.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {!pendingComputing && (
            <div className="space-y-3">
              <div className="text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  {pendingSummary.upload > 0 && <span>Upload: <span className="text-foreground font-medium">{pendingSummary.upload}</span></span>}
                  {pendingSummary.ocr > 0 && <span>OCR: <span className="text-foreground font-medium">{pendingSummary.ocr}</span></span>}
                  {pendingSummary.transcribe > 0 && <span>Transcribe: <span className="text-foreground font-medium">{pendingSummary.transcribe}</span></span>}
                </div>
              </div>

              <div className="rounded-md border p-3 text-sm space-y-2">
                <div className="font-medium">Quota impact (estimates)</div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-sm">
                  <div className="text-muted-foreground">Upload tokens</div>
                  <div className="text-muted-foreground">+{new Intl.NumberFormat().format(pendingTotals.tokens)}</div>
                  <div className="text-muted-foreground">
                    {limits ? `Remaining after: ${new Intl.NumberFormat().format(Math.max(0, (limits.caps.upload_tokens || 0) - (limits.usage.upload_tokens || 0) - pendingTotals.tokens))} / ${new Intl.NumberFormat().format(limits.caps.upload_tokens || 0)}` : "Remaining after: —"}
                  </div>

                  <div className="text-muted-foreground">Transcribe seconds</div>
                  <div className="text-muted-foreground">+{new Intl.NumberFormat().format(pendingTotals.seconds)}</div>
                  <div className="text-muted-foreground">
                    {limits ? `Remaining after: ${new Intl.NumberFormat().format(Math.max(0, (limits.caps.transcribe_seconds || 0) - (limits.usage.transcribe_seconds || 0) - pendingTotals.seconds))} / ${new Intl.NumberFormat().format(limits.caps.transcribe_seconds || 0)}` : "Remaining after: —"}
                  </div>

                  <div className="text-muted-foreground">OCR images</div>
                  <div className="text-muted-foreground">+{new Intl.NumberFormat().format(pendingTotals.images)}</div>
                  <div className="text-muted-foreground">
                    {limits ? `Remaining after: ${new Intl.NumberFormat().format(Math.max(0, (limits.caps.ocr_images || 0) - (limits.usage.ocr_images || 0) - pendingTotals.images))} / ${new Intl.NumberFormat().format(limits.caps.ocr_images || 0)}` : "Remaining after: —"}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground pt-2">
                  Note: upload token usage is based on extracted text. Audio billing may round seconds. If you exceed your plan limits, the backend may reject some items.
                </div>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingComputing || uploading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executePending} disabled={pendingComputing || uploading || limitsLoading}>
              {limitsLoading ? "Checking…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mobile folders drawer */}
      <Dialog open={mobileFoldersOpen} onOpenChange={setMobileFoldersOpen}>
        <DialogContent className="md:hidden p-0 gap-0 w-[calc(100vw-1rem)] max-w-none h-[calc(100vh-1rem)] flex flex-col">
          <div className="px-3 py-2 border-b flex items-center gap-2">
            <div className="text-sm font-medium">Folders</div>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={refresh} disabled={busy} title="Refresh">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button size="sm" onClick={() => startUploadTo(selectedFolder)} disabled={uploading} title="Upload">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMobileFoldersOpen(false)} title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto px-1 py-2 bg-muted/10">
            <FileTree
              loading={busy && (!tree || files.length === 0)}
              node={treeForFolders}
              selectedKey={treeSelectedKey}
              revealPaths={treeRevealPaths}
              openFolderOnClick={true}
              suppressClickUntilRef={suppressClickUntilRef}
              onSelectFolder={(p) => setTreeSelectedKey(`d:${p}`)}
              onOpenFolder={(p) => {
                setTreeSelectedKey(`d:${p}`);
                setSelectedFolder(p);
                setMobileFoldersOpen(false);
              }}
              onSelectFile={(file) => {
                // On mobile, open files on tap.
                setTreeSelectedKey(`f:${file.id}`);
                const folder = parentPath(file.name);
                if (folder !== selectedFolder) {
                  suppressNavClearRef.current = true;
                  setSelectedFolder(folder);
                }
                setSelectedFileIds([file.id]);
                setSelectedFolderRowPaths([]);
                selectionAnchorRef.current = `f:${file.id}`;
                openViewer(file);
                setMobileFoldersOpen(false);
              }}
              onOpenFile={(file) => {
                setTreeSelectedKey(`f:${file.id}`);
                const folder = parentPath(file.name);
                if (folder !== selectedFolder) {
                  suppressNavClearRef.current = true;
                  setSelectedFolder(folder);
                }
                setSelectedFileIds([file.id]);
                setSelectedFolderRowPaths([]);
                selectionAnchorRef.current = `f:${file.id}`;
                openViewer(file);
                setMobileFoldersOpen(false);
              }}
              onUploadTo={(p) => startUploadTo(p)}
              onNewFolder={(p) => requestNewFolder(p)}
              onMoveFilesTo={(fileIds, folderPath) => moveFilesToFolder(fileIds, folderPath)}
              onDropFilesTo={(folderPath, fs) => preparePending(fs, folderPath)}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Transcription modal */}
      <Dialog
        open={transcribeOpen}
        onOpenChange={(open) => {
          setTranscribeOpen(open);
          if (!open) {
            setTranscribeBusy(false);
            setTranscribeFile(null);
            setTranscribeText("");
            setTranscribeSegments([]);
            setTranscribeDetected([]);
            setTranscribeBilledSeconds(null);
            setTranscribeMeta(null);
            setTranscribeErr(null);
            setSavingTranscript(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Transcribe audio</DialogTitle>
            <DialogDescription>
              Upload an audio/video file and generate a text transcript. You can optionally save the transcript back into this folder.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={pickTranscribeFile} disabled={transcribeBusy}>
                Choose file
              </Button>
              <div className="min-w-0 text-sm">
                {transcribeFile ? (
                  <div className="truncate">
                    <span className="font-medium">{transcribeFile.name}</span>
                    <span className="ml-2 text-muted-foreground">({fmtSize(transcribeFile.size)})</span>
                  </div>
                ) : (
                  <div className="text-muted-foreground">No file selected.</div>
                )}
              </div>
              <div className="flex-1" />
              <Button
                onClick={runTranscription}
                disabled={!transcribeFile || transcribeBusy}
                size="sm"
              >
                {transcribeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                <span className="ml-1.5">{transcribeBusy ? "Transcribing…" : transcribeText ? "Re-transcribe" : "Transcribe"}</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Languages (comma-separated)</Label>
                <Input
                  value={transcribeLanguages}
                  onChange={(e) => setTranscribeLanguages(e.target.value)}
                  placeholder="en-US,cs-CZ,it-IT"
                  disabled={transcribeBusy}
                />
                <div className="text-xs text-muted-foreground">
                  Tip: include the most likely languages for better accuracy.
                </div>
              </div>

              <div className="space-y-1">
                <Label>Model (optional)</Label>
                <Input
                  value={transcribeModel}
                  onChange={(e) => setTranscribeModel(e.target.value)}
                  placeholder="gpt-4o-mini-transcribe"
                  disabled={transcribeBusy}
                />
                <div className="text-xs text-muted-foreground">Leave empty to use the server default.</div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Speaker diarization</div>
                <div className="text-xs text-muted-foreground">Attempt to label different speakers (best effort).</div>
              </div>
              <Switch checked={transcribeDiarization} onCheckedChange={setTranscribeDiarization} disabled={transcribeBusy} />
            </div>

            {transcribeErr && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="font-medium text-destructive">Error</div>
                <div className="text-muted-foreground mt-1 break-words">{transcribeErr}</div>
              </div>
            )}

            {transcribeText && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium">Transcript</div>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(transcribeText);
                        toast.success("Copied");
                      } catch {
                        toast.error("Copy failed");
                      }
                    }}
                    disabled={!transcribeText}
                    title="Copy to clipboard"
                  >
                    <Copy className="h-4 w-4" />
                    <span className="ml-1.5">Copy</span>
                  </Button>
                  <Button size="sm" onClick={saveTranscriptToFiles} disabled={savingTranscript || !transcribeText.trim()}>
                    {savingTranscript ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    <span className="ml-1.5">Save to files</span>
                  </Button>
                </div>

                <Textarea value={transcribeText} readOnly className="min-h-[16rem] resize-none" />

                <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                  {transcribeDetected.length > 0 && <span>Detected: {transcribeDetected.join(", ")}</span>}
                  {transcribeBilledSeconds != null && <span>• Billed: {Math.max(0, Math.round(transcribeBilledSeconds))}s</span>}
                  {transcribeMeta && <span>• Model: {transcribeMeta.model} ({transcribeMeta.location})</span>}
                </div>

                {transcribeSegments.length > 1 && (
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Segments</div>
                    <ScrollArea className="h-40 rounded-md border p-2">
                      <div className="space-y-1 text-sm">
                        {transcribeSegments.map((s, i) => (
                          <div key={i} className="whitespace-pre-wrap break-words">
                            {s}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTranscribeOpen(false)} disabled={transcribeBusy}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OCR modal */}
      <Dialog
        open={ocrOpen}
        onOpenChange={(open) => {
          setOcrOpen(open);
          if (!open) {
            setOcrBusy(false);
            setOcrFile(null);
            setOcrText("");
            setOcrMeta(null);
            setOcrErr(null);
            setSavingOcr(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>OCR (image → text)</DialogTitle>
            <DialogDescription>
              Choose an image and extract its text using Google OCR. You can copy the result or save it back into this folder.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={pickOcrFile} disabled={ocrBusy}>
                Choose image
              </Button>
              <div className="min-w-0 text-sm">
                {ocrFile ? (
                  <div className="truncate">
                    <span className="font-medium">{ocrFile.name}</span>
                    <span className="ml-2 text-muted-foreground">({fmtSize(ocrFile.size)})</span>
                  </div>
                ) : (
                  <div className="text-muted-foreground">No image selected.</div>
                )}
              </div>
              <div className="flex-1" />
              <Button onClick={runOcrFromPicker} disabled={!ocrFile || ocrBusy} size="sm">
                {ocrBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
                <span className="ml-1.5">{ocrBusy ? "Running…" : ocrText ? "Re-run OCR" : "Run OCR"}</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Language hints (comma-separated)</Label>
                <Input
                  value={ocrLanguages}
                  onChange={(e) => setOcrLanguages(e.target.value)}
                  placeholder="en,cs,it"
                  disabled={ocrBusy}
                />
                <div className="text-xs text-muted-foreground">Tip: include likely languages for better accuracy.</div>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Document mode</div>
                  <div className="text-xs text-muted-foreground">Better for dense documents; off is faster for short snippets.</div>
                </div>
                <Switch checked={ocrDocMode} onCheckedChange={setOcrDocMode} disabled={ocrBusy} />
              </div>
            </div>

            {ocrErr && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="font-medium text-destructive">Error</div>
                <div className="text-muted-foreground mt-1 break-words">{ocrErr}</div>
              </div>
            )}

            {ocrText && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium">Extracted text</div>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(ocrText);
                        toast.success("Copied");
                      } catch {
                        toast.error("Copy failed");
                      }
                    }}
                    disabled={!ocrText}
                    title="Copy to clipboard"
                  >
                    <Copy className="h-4 w-4" />
                    <span className="ml-1.5">Copy</span>
                  </Button>
                  <Button size="sm" onClick={saveOcrToFiles} disabled={savingOcr || !ocrText.trim()}>
                    {savingOcr ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    <span className="ml-1.5">Save to files</span>
                  </Button>
                </div>

                <Textarea value={ocrText} readOnly className="min-h-[16rem] resize-none" />

                <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                  {ocrMeta?.language_hints?.length ? <span>Hints: {ocrMeta.language_hints.join(", ")}</span> : null}
                  {typeof ocrMeta?.images_charged === "number" ? <span>• Charged: {Math.max(0, ocrMeta.images_charged)}</span> : null}
                  {ocrMeta?.mode ? <span>• Mode: {ocrMeta.mode}</span> : null}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOcrOpen(false)} disabled={ocrBusy}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File viewer modal */}
            <Dialog
        open={viewerOpen}
        onOpenChange={(open) => {
          setViewerOpen(open);
          if (!open) {
            setViewerId(null);
            setInfileQuery("");
            setInfileIdx(0);
          }
        }}
      >
        <DialogContent className="p-0 w-[84rem] max-w-[96vw] h-[calc(100vh-2rem)] sm:h-[calc(100vh-4rem)] flex flex-col">
          {/* Title + search + download */}
          <div className="px-3 sm:px-4 py-2 border-b bg-background">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 sm:max-w-[22rem]">
                <div className="font-medium truncate" title={viewerFile ? viewerFile.name : ""}>
                  {viewerFile ? basename(viewerFile.name) : ""}
                </div>
              </div>

              {/* In-file search */}
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={canSearchInFile ? "Search…" : "Search available for text files"}
                  value={infileQuery}
                  onChange={(e) => setInfileQuery(e.target.value)}
                  className="pl-8 pr-24"
                  disabled={!viewerFile || !canSearchInFile}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if ((e as any).shiftKey) gotoPrev();
                      else gotoNext();
                    }
                  }}
                />
                <div className="absolute right-24 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground select-none hidden sm:block">
                  {infileQuery.trim() && canSearchInFile ? (matchCount > 0 ? `${infileIdx + 1}/${matchCount}` : "0/0") : ""}
                </div>
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
                    className="p-1 rounded hover:bg-muted disabled:opacity-50"
                    title="Clear search"
                    onClick={clearInfile}
                    disabled={!infileQuery}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Download */}
              {viewerFile && (
                <a
                  className="inline-flex shrink-0"
                  href={fileDownloadUrl(viewerFile.id)}
                  title="Download"
                  onClick={() => console.debug("[files] viewer download", { id: viewerFile.id })}
                >
                  <Button variant="outline" size="icon" aria-label="Download">
                    <Download className="h-4 w-4" />
                  </Button>
                </a>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="h-full overflow-auto p-3 sm:p-4">
              <div className="h-full w-full">
                <FileViewer
                  payload={viewerId ? content[viewerId] : undefined}
                  file={viewerFile}
                  searchTerm={infileQuery}
                  selectedIndex={matchCount > 0 ? infileIdx : -1}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <UploadTrackerPanel
        open={trackerOpen}
        onClose={() => setTrackerOpen(false)}
        refreshKey={trackerRefreshKey}
        onAnyComplete={refresh}
        onCleared={handleTrackerCleared}
        optimistic={optimisticJobs}
        batchFilenames={batchFilenames}
        showHistory={true}
        seedFetched={seedFetched}
      />
    </div>
  );
}

function CurrentFolderDrop({
  folderPath,
  className,
  children,
  onDragOver,
  onDrop,
}: {
  folderPath: string;
  className?: string;
  children: React.ReactNode;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: folderDndId(folderPath) });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && "ring-2 ring-primary/40 ring-inset")}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}

function FolderRow({
  node,
  selected,
  onSelect,
  onOpen,
  onUploadHere,
  onNewFolderHere,
  onMoveFilesTo,
  onDropFilesHere,
  suppressClickUntilRef,
}: {
  node: TreeNode;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onUploadHere: () => void;
  onNewFolderHere: () => void;
  onMoveFilesTo: (fileIds: string[]) => void;
  onDropFilesHere: (files: File[]) => void;
  suppressClickUntilRef: React.MutableRefObject<number>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuKey, setMenuKey] = useState(0);

  const { setNodeRef, isOver } = useDroppable({ id: folderDndId(node.path) });

  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          className={cn(
            "grid grid-cols-[minmax(12rem,1fr)_8rem_9rem_10rem] gap-2 px-2 py-2 text-sm cursor-default",
            "hover:bg-muted/40",
            selected && "bg-muted/60",
            isOver && "ring-2 ring-primary/40 ring-inset bg-primary/5"
          )}
          onContextMenuCapture={() => {
            if (menuOpen) {
              flushSync(() => {
                setMenuOpen(false);
                setMenuKey((k) => k + 1);
              });
            } else {
              setMenuKey((k) => k + 1);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (Date.now() < suppressClickUntilRef.current) return;
            onOpen();
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (Date.now() < suppressClickUntilRef.current) return;
            onSelect(e);
          }}
          onContextMenu={(e) => {
            e.stopPropagation();
            if (Date.now() < suppressClickUntilRef.current) return;
            // Right-click selects the folder if it isn't already selected
            if (!selected) onSelect(e);
          }}
          onDragOver={(e) => {
            // External OS file drop only
            if (!isExternalFilesDrag(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          data-folder-row
          data-folder-path={node.path}
          onDrop={(e) => {
            // External OS file drop only
            if (!isExternalFilesDrag(e.dataTransfer)) return;
            e.preventDefault();
            e.stopPropagation();
            const fs = Array.from(e.dataTransfer.files || []);
            if (fs.length) onDropFilesHere(fs);
          }}
        >
          <div className="min-w-0 flex items-center gap-2">
            <Folder className="h-4 w-4 shrink-0" />
            <span className="truncate font-medium">{node.name}</span>
          </div>
          <div className="text-right text-muted-foreground">—</div>
          <div className="text-muted-foreground">Folder</div>
          <div className="text-muted-foreground">—</div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent key={menuKey} className="min-w-[12rem]">
        <ContextMenuItem onSelect={onOpen}>
          <Folder className="h-4 w-4" /> Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onUploadHere}>
          <Upload className="h-4 w-4" /> Upload here
        </ContextMenuItem>
        <ContextMenuItem onSelect={onNewFolderHere}>
          <FolderPlus className="h-4 w-4" /> New folder…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            const p = node.path || "";
            if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(p);
          }}
        >
          <Copy className="h-4 w-4" /> Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileRow({
  node,
  selected,
  onSelect,
  onOpen,
  onDelete,
  onRename,
  onMove,
  onDragStart,
}: {
  node: TreeNode;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onDelete: () => void;
  onRename: () => void;
  onMove: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  const f = node.file;
  if (!f) return null;
  const href = fileDownloadUrl(f.id);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuKey, setMenuKey] = useState(0);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: fileDndId(f.id) });
  const style = {
    transform: CSS.Translate.toString(transform),
  } as React.CSSProperties;

  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "grid grid-cols-[minmax(12rem,1fr)_8rem_9rem_10rem] gap-2 px-2 py-2 text-sm cursor-default",
            "hover:bg-muted/40",
            selected && "bg-muted/60",
            isDragging && "opacity-60"
          )}
          onContextMenuCapture={() => {
            if (menuOpen) {
              flushSync(() => {
                setMenuOpen(false);
                setMenuKey((k) => k + 1);
              });
            } else {
              setMenuKey((k) => k + 1);
            }
          }}
          onDoubleClick={onOpen}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(e);
          }}
          onContextMenu={(e) => {
            e.stopPropagation();
            // Right-click selects the file if it isn't already selected
            if (!selected) onSelect(e);
          }}
          // dnd-kit
          {...attributes}
          {...listeners}
          data-file-row
          data-file-id={f.id}
          title={f.name}
        >
          <div className="min-w-0 flex items-center gap-2">
            <FileIconByName name={node.name} className="h-4 w-4 shrink-0" />
            <span className="truncate">{node.name}</span>
          </div>
          <div className="text-right text-muted-foreground">{fmtSize(f.size || 0)}</div>
          <div className="text-muted-foreground truncate">{(f.content_type || "").split(";")[0] || "File"}</div>
          <div className="text-muted-foreground truncate">{f.created_at ? new Date(f.created_at).toLocaleString() : "—"}</div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent key={menuKey} className="min-w-[12rem]">
        <ContextMenuItem onSelect={onOpen}>
          <Folder className="h-4 w-4" /> Open
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            window.open(href, "_self");
          }}
        >
          <Download className="h-4 w-4" /> Download
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onRename}>
          <Copy className="h-4 w-4" /> Rename…
        </ContextMenuItem>
        <ContextMenuItem onSelect={onMove}>
          <Folder className="h-4 w-4" /> Move…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
