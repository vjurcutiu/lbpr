import type {
  CSSProperties,
  DragEventHandler,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  ReactNode,
} from "react";
import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { flushSync } from "react-dom";
import {
  Clipboard,
  Copy,
  Download,
  Folder,
  FolderPlus,
  GripVertical,
  Loader2,
  Pencil,
  Scissors,
  Trash2,
  Upload,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import { fileDownloadUrl, type FileItem } from "../api";
import {
  fileDndId,
  folderDndId,
  folderDragData,
  folderDropData,
  folderDropDndId,
  isExternalFilesDrag,
  normalizeFolderPath,
} from "../utils/dnd";
import { fmtSize } from "../utils/formatters";
import type { TreeNode } from "../utils/fileTree";
import { ctxEvtSummary, ctxLog, safeAction } from "../utils/contextMenuDebug";
import { FileIconByName } from "./FileIconByName";


function formatFileType(file: FileItem) {
  const contentType = (file.content_type || "").split(";")[0].trim().toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (contentType.includes("pdf") || ext === "pdf") return "PDF";
  if (contentType.includes("word") || ["doc", "docx"].includes(ext)) return "Word";
  if (contentType.includes("markdown") || ["md", "markdown"].includes(ext)) return "Markdown";
  if (contentType.startsWith("text/") || ["txt", "csv", "json", "xml", "yaml", "yml"].includes(ext)) {
    if (ext === "csv") return "CSV";
    if (ext === "json") return "JSON";
    if (["yaml", "yml"].includes(ext)) return "YAML";
    return "Text";
  }
  if (contentType.startsWith("image/")) return "Image";
  if (contentType.startsWith("audio/")) return "Audio";
  return ext ? ext.toUpperCase() : "File";
}

function formatCreatedAt(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function typeChip(label: string) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-primary/10 bg-primary/5 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="truncate">{label}</span>
    </span>
  );
}

type SharedRowProps = {
  onBeforeMenuOpen?: () => void;
  canPaste: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPasteHere: () => void;
};

type CurrentFolderDropProps = {
  folderPath: string;
  className?: string;
  children: ReactNode;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
};

export function CurrentFolderDrop({ folderPath, className, children, onDragOver, onDrop }: CurrentFolderDropProps) {
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  const { setNodeRef, isOver } = useDroppable({
    id: folderDropDndId("current", normalizedFolderPath),
    data: folderDropData("current", normalizedFolderPath),
  });

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

type FolderRowProps = SharedRowProps & {
  node: TreeNode;
  selected: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onOpen: () => void;
  onRename: () => void;
  onUploadHere: () => void;
  onNewFolderHere: () => void;
  onMoveFilesTo?: (fileIds: string[]) => void;
  onDropFilesHere: (dataTransfer: DataTransfer) => void;
  suppressClickUntilRef: MutableRefObject<number>;
  dragGroupActive?: boolean;
  dragGroupCount?: number;
  pending?: boolean;
};

export function FolderRow({
  node,
  selected,
  onSelect,
  onOpen,
  onBeforeMenuOpen,
  onRename,
  canPaste,
  onCopy,
  onCut,
  onPasteHere,
  onUploadHere,
  onNewFolderHere,
  onMoveFilesTo: _onMoveFilesTo,
  onDropFilesHere,
  suppressClickUntilRef,
  dragGroupActive,
  dragGroupCount,
  pending = false,
}: FolderRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuKey, setMenuKey] = useState(0);

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: folderDndId("list-row", node.path),
    data: folderDragData("list-row", node.path),
    disabled: pending,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: folderDropDndId("list-row", node.path),
    data: folderDropData("list-row", node.path),
    disabled: pending,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
  } as CSSProperties;
  const multiDrag = (dragGroupCount || 0) > 1;
  const inDragGroup = !!dragGroupActive && multiDrag;

  return (
    <ContextMenu
      open={menuOpen}
      onOpenChange={(open) => {
        ctxLog("FolderRow.onOpenChange", { open, path: node.path });
        if (pending) {
          setMenuOpen(false);
          return;
        }
        if (open) onBeforeMenuOpen?.();
        setMenuOpen(open);
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={setDropRef}
          className={cn("rounded", isOver && "ring-2 ring-primary/40 ring-inset bg-primary/5")}
          onContextMenuCapture={(event) => {
            ctxLog("FolderRow.onContextMenuCapture", ctxEvtSummary(event));
            if (menuOpen) {
              flushSync(() => {
                setMenuOpen(false);
                setMenuKey((value) => value + 1);
              });
            } else {
              setMenuKey((value) => value + 1);
            }
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (pending || Date.now() < suppressClickUntilRef.current) return;
            onOpen();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (pending || Date.now() < suppressClickUntilRef.current) return;
            onSelect(event);
          }}
          onContextMenu={(event) => {
            event.stopPropagation();
            if (pending || Date.now() < suppressClickUntilRef.current) return;
            if (!selected) onSelect(event);
          }}
          onDragOver={(event) => {
            if (pending || !isExternalFilesDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          data-folder-row
          data-folder-path={node.path}
          onDrop={(event) => {
            if (pending || !isExternalFilesDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            onDropFilesHere(event.dataTransfer);
          }}
        >
          <div
            ref={setDragRef}
            style={style}
            className={cn(
              "group grid grid-cols-[1.5rem_minmax(12rem,1fr)_8rem_9rem_10rem] gap-3 px-4 py-3 text-sm cursor-default select-none",
              "hover:bg-primary/5",
              selected && "bg-primary/10 text-primary",
              "transition-opacity",
              pending && "opacity-60 cursor-wait",
              isDragging && (multiDrag ? "opacity-0" : "opacity-60"),
              isDragging && "pointer-events-none",
              !isDragging && inDragGroup && "opacity-40"
            )}
          >
            <div className="flex items-center justify-center">
              <button
                ref={setActivatorNodeRef}
                type="button"
                aria-label="Drag folder"
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded",
                  "text-muted-foreground/45 opacity-60 hover:text-foreground hover:bg-muted/60 group-hover:opacity-100",
                  pending ? "cursor-wait" : "cursor-grab active:cursor-grabbing touch-none select-none"
                )}
                disabled={pending}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-4 w-4" />
              </button>
            </div>

            <div className="min-w-0 flex items-center gap-2">
              {pending ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" /> : <Folder className="h-5 w-5 shrink-0 text-primary/80" />}
              <span className="truncate font-medium text-foreground group-hover:text-primary">{node.name}</span>
              {pending ? <span className="shrink-0 text-xs text-muted-foreground">Moving…</span> : null}
            </div>

            <div className="text-right text-muted-foreground">—</div>
            <div>{typeChip("Folder")}</div>
            <div className="text-muted-foreground">—</div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent
        key={menuKey}
        className="min-w-[12rem]"
        onOpenAutoFocus={(event) => ctxLog("FolderRow.menu.openAutoFocus", ctxEvtSummary(event))}
        onPointerDownCapture={(event) => ctxLog("FolderRow.menu.pointerDownCapture", ctxEvtSummary(event))}
        onClickCapture={(event) => ctxLog("FolderRow.menu.clickCapture", ctxEvtSummary(event))}
      >
        <ContextMenuItem onSelect={safeAction("Folder: Open", () => onOpen())}>
          <Folder className="h-4 w-4" /> Open
        </ContextMenuItem>

        <ContextMenuItem
          onSelect={safeAction("Folder: Rename", (event) => {
            event?.preventDefault?.();
            setMenuOpen(false);
            onRename();
          })}
        >
          <Pencil className="h-4 w-4" /> Rename folder…
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={safeAction("Folder: Copy", () => onCopy())}>
          <Copy className="h-4 w-4" /> Copy
        </ContextMenuItem>

        <ContextMenuItem onSelect={safeAction("Folder: Cut", () => onCut())}>
          <Scissors className="h-4 w-4" /> Cut
        </ContextMenuItem>

        <ContextMenuItem disabled={!canPaste} onSelect={safeAction("Folder: Paste", () => onPasteHere())}>
          <Clipboard className="h-4 w-4" /> Paste
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={safeAction("Folder: Upload here", () => onUploadHere())}>
          <Upload className="h-4 w-4" /> Upload here
        </ContextMenuItem>

        <ContextMenuItem onSelect={safeAction("Folder: New folder", () => onNewFolderHere())}>
          <FolderPlus className="h-4 w-4" /> New folder…
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onSelect={safeAction("Folder: Copy path", async () => {
            const path = node.path || "";
            if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(path);
          })}
        >
          <Copy className="h-4 w-4" /> Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

type FileRowProps = SharedRowProps & {
  node: TreeNode;
  selected: boolean;
  onSelect: (event: ReactMouseEvent) => void;
  onOpen: () => void;
  onDelete: () => void;
  onRename: () => void;
  onMove: () => void;
  dragGroupActive?: boolean;
  dragGroupCount?: number;
  pending?: boolean;
};

export function FileRow({
  node,
  selected,
  onSelect,
  onOpen,
  onBeforeMenuOpen,
  canPaste,
  onCopy,
  onCut,
  onPasteHere,
  onDelete,
  onRename,
  onMove,
  dragGroupActive,
  dragGroupCount,
  pending = false,
}: FileRowProps) {
  const file = node.file as FileItem | undefined;
  if (!file) return null;

  const downloadHref = fileDownloadUrl(file.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuKey, setMenuKey] = useState(0);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: fileDndId(file.id),
    data: { type: "file", fileId: file.id },
    disabled: pending,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
  } as CSSProperties;
  const multiDrag = (dragGroupCount || 0) > 1;
  const inDragGroup = !!dragGroupActive && multiDrag;

  return (
    <ContextMenu
      open={menuOpen}
      onOpenChange={(open) => {
        ctxLog("FileRow.onOpenChange", { open, id: file.id });
        if (pending) {
          setMenuOpen(false);
          return;
        }
        if (open) onBeforeMenuOpen?.();
        setMenuOpen(open);
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "group grid grid-cols-[1.5rem_minmax(12rem,1fr)_8rem_9rem_10rem] gap-3 px-4 py-3 text-sm cursor-default select-none",
            "hover:bg-primary/5",
            selected && "bg-primary/10 text-primary",
            "transition-opacity",
              pending && "opacity-60 cursor-wait",
            isDragging && (multiDrag ? "opacity-0" : "opacity-60"),
            isDragging && "pointer-events-none",
            !isDragging && inDragGroup && "opacity-40"
          )}
          onContextMenuCapture={(event) => {
            ctxLog("FileRow.onContextMenuCapture", ctxEvtSummary(event));
            if (menuOpen) {
              flushSync(() => {
                setMenuOpen(false);
                setMenuKey((value) => value + 1);
              });
            } else {
              setMenuKey((value) => value + 1);
            }
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (pending) return;
            onOpen();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (pending) return;
            onSelect(event);
          }}
          onContextMenu={(event) => {
            event.stopPropagation();
            if (pending) return;
            if (!selected) onSelect(event);
          }}
          data-file-row
          data-file-id={file.id}
          title={file.name}
        >
          <div className="flex items-center justify-center">
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label="Drag file"
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded",
                "text-muted-foreground/45 opacity-60 hover:text-foreground hover:bg-muted/60 group-hover:opacity-100",
                pending ? "cursor-wait" : "cursor-grab active:cursor-grabbing touch-none select-none"
              )}
              disabled={pending}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </div>

          <div className="min-w-0 flex items-center gap-2">
            <FileIconByName name={node.name} className="h-5 w-5 shrink-0 text-primary/80" />
            <span className="truncate font-medium text-foreground group-hover:text-primary">{node.name}</span>
          </div>

          <div className="text-right text-muted-foreground">{fmtSize(file.size || 0)}</div>
          <div className="min-w-0">{typeChip(formatFileType(file))}</div>
          <div className="truncate text-muted-foreground">{formatCreatedAt(file.created_at)}</div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent
        key={menuKey}
        className="min-w-[12rem]"
        onOpenAutoFocus={(event) => ctxLog("FileRow.menu.openAutoFocus", ctxEvtSummary(event))}
        onPointerDownCapture={(event) => ctxLog("FileRow.menu.pointerDownCapture", ctxEvtSummary(event))}
        onClickCapture={(event) => ctxLog("FileRow.menu.clickCapture", ctxEvtSummary(event))}
      >
        <ContextMenuItem onSelect={safeAction("File: Open", () => onOpen())}>
          <Folder className="h-4 w-4" /> Open
        </ContextMenuItem>

        <ContextMenuItem
          onSelect={safeAction("File: Download", () => {
            window.open(downloadHref, "_self");
          })}
        >
          <Download className="h-4 w-4" /> Download
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={safeAction("File: Copy", () => onCopy())}>
          <Copy className="h-4 w-4" /> Copy
        </ContextMenuItem>

        <ContextMenuItem onSelect={safeAction("File: Cut", () => onCut())}>
          <Scissors className="h-4 w-4" /> Cut
        </ContextMenuItem>

        <ContextMenuItem disabled={!canPaste} onSelect={safeAction("File: Paste", () => onPasteHere())}>
          <Clipboard className="h-4 w-4" /> Paste
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onSelect={safeAction("File: Rename", (event) => {
            event?.preventDefault?.();
            setMenuOpen(false);
            onRename();
          })}
        >
          <Pencil className="h-4 w-4" /> Rename…
        </ContextMenuItem>

        <ContextMenuItem
          onSelect={safeAction("File: Move", (event) => {
            event?.preventDefault?.();
            setMenuOpen(false);
            onMove();
          })}
        >
          <Folder className="h-4 w-4" /> Move…
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onSelect={safeAction("File: Delete", () => onDelete())}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
