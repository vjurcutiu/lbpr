import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronRight, Folder, Loader2, Upload, FolderPlus, Copy, Scissors, Clipboard, Trash2, Pencil, GripVertical } from "lucide-react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import type { FileItem } from "../api";
import type { TreeNode } from "../utils/fileTree";
import { folderDndId, isExternalFilesDrag } from "../utils/dnd";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { FileIconByName } from "./FileIconByName";

const folderKey = (path: string) => `d:${path || ""}`;
const fileKey = (id: string) => `f:${id || ""}`;

// Tree indent styling
// - BASE_LEFT_PX must match the paddingLeft base used for rows.
// - INDENT_PX controls the depth step and should match the existing indentation.
//
// VSCode-ish guides: faint vertical lines per depth + a small elbow into each row.
// Implemented via background layers so it can't interfere with clicks / DnD.
const BASE_LEFT_PX = 8;
const INDENT_PX = 14;
const GUIDE_COLOR = "hsl(var(--muted-foreground) / 0.16)";

function treeGuidesStyle(depth: number): React.CSSProperties {
  if (depth <= 0) return {};

  const images: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];
  const repeats: string[] = [];

  // Vertical guides for each indent level.
  for (let i = 1; i <= depth; i++) {
    const x = BASE_LEFT_PX + (i - 0.5) * INDENT_PX;
    images.push(`linear-gradient(${GUIDE_COLOR}, ${GUIDE_COLOR})`);
    sizes.push("1px 100%");
    positions.push(`${x}px 0`);
    repeats.push("no-repeat");
  }

  // Elbow into the row at the current depth.
  const elbowX = BASE_LEFT_PX + (depth - 0.5) * INDENT_PX;
  images.push(`linear-gradient(${GUIDE_COLOR}, ${GUIDE_COLOR})`);
  sizes.push(`${INDENT_PX / 2}px 1px`);
  positions.push(`${elbowX}px 50%`);
  repeats.push("no-repeat");

  return {
    backgroundImage: images.join(","),
    backgroundSize: sizes.join(","),
    backgroundPosition: positions.join(","),
    backgroundRepeat: repeats.join(","),
  };
}

function normPath(p: string) {
  return (p || "").split("/").filter(Boolean).join("/");
}

function folderPrefixes(p: string) {
  const norm = normPath(p);
  if (!norm) return [""];
  const parts = norm.split("/");
  const out: string[] = [""];
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    out.push(cur);
  }
  return out;
}

export function FileTree({
  node,
  loading = false,
  selectedKey,
  revealPaths,
  suppressClickUntilRef,
  openFolderOnClick = false,
  onSelectFolder,
  onOpenFolder,
  onSelectFile,
  onOpenFile,
  onUploadTo,
  onNewFolder,
  onRenameFolder,
  canPaste = false,
  onCopyFolder,
  onCutFolder,
  onPasteInto,
  onDeleteFolder,
  onMoveFilesTo,
  onDropFilesTo,
}: {
  node: TreeNode | null | undefined;
  loading?: boolean;
  selectedKey: string;
  revealPaths?: string[];
  suppressClickUntilRef?: React.MutableRefObject<number>;
  /** Useful for mobile (no double-click). */
  openFolderOnClick?: boolean;
  onSelectFolder: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onSelectFile: (file: FileItem) => void;
  onOpenFile: (file: FileItem) => void;
  onUploadTo: (path: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRenameFolder?: (path: string) => void;
  canPaste?: boolean;
  onCopyFolder?: (path: string) => void;
  onCutFolder?: (path: string) => void;
  onPasteInto?: (path: string) => void;
  onDeleteFolder?: (path: string) => void;
  onMoveFilesTo: (fileIds: string[], folderPath: string) => void;
  onDropFilesTo: (folderPath: string, files: File[]) => void;
}) {
  const children = useMemo(() => (node?.children || []) as TreeNode[], [node]);

  // Track which folders are expanded.
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set([""]));

  useEffect(() => {
    const paths = (revealPaths || []).filter(Boolean).map(normPath);
    if (!paths.length) return;
    setOpenPaths((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        // Open ancestors so the target node is visible, but do not force-open the folder itself.
        // This keeps "arrow click" expansion independent from selection.
        const prefs = folderPrefixes(p);
        prefs.pop();
        for (const pref of prefs) next.add(pref);
      }
      return next;
    });
  }, [revealPaths?.join("|")]);

  const toggleOpen = (path: string) => {
    const p = normPath(path);
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground p-3 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <div className="text-sm">
      <FolderRow
        node={{ type: "folder", name: "Files", path: "", children }}
        isRoot
        depth={0}
        selectedKey={selectedKey}
        openPaths={openPaths}
        toggleOpen={toggleOpen}
        suppressClickUntilRef={suppressClickUntilRef}
        openFolderOnClick={openFolderOnClick}
        onSelectFolder={onSelectFolder}
        onOpenFolder={onOpenFolder}
        onSelectFile={onSelectFile}
        onOpenFile={onOpenFile}
        onUploadTo={onUploadTo}
        onNewFolder={onNewFolder}
        onRenameFolder={onRenameFolder}
        canPaste={canPaste}
        onCopyFolder={onCopyFolder}
        onCutFolder={onCutFolder}
        onPasteInto={onPasteInto}
        onDeleteFolder={onDeleteFolder}
        onMoveFilesTo={onMoveFilesTo}
        onDropFilesTo={onDropFilesTo}
      />
    </div>
  );
}

function FolderRow({
  node,
  isRoot,
  depth,
  selectedKey,
  openPaths,
  toggleOpen,
  suppressClickUntilRef,
  openFolderOnClick,
  onSelectFolder,
  onOpenFolder,
  onSelectFile,
  onOpenFile,
  onUploadTo,
  onNewFolder,
  onRenameFolder,
  canPaste,
  onCopyFolder,
  onCutFolder,
  onPasteInto,
  onDeleteFolder,
  onMoveFilesTo,
  onDropFilesTo,
}: {
  node: TreeNode;
  isRoot: boolean;
  depth: number;
  selectedKey: string;
  openPaths: Set<string>;
  toggleOpen: (path: string) => void;
  suppressClickUntilRef?: React.MutableRefObject<number>;
  openFolderOnClick: boolean;
  onSelectFolder: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onSelectFile: (file: FileItem) => void;
  onOpenFile: (file: FileItem) => void;
  onUploadTo: (path: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRenameFolder?: (path: string) => void;
  canPaste?: boolean;
  onCopyFolder?: (path: string) => void;
  onCutFolder?: (path: string) => void;
  onPasteInto?: (path: string) => void;
  onDeleteFolder?: (path: string) => void;
  onMoveFilesTo: (fileIds: string[], folderPath: string) => void;
  onDropFilesTo: (folderPath: string, files: File[]) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuKey, setMenuKey] = useState(0);

  const open = openPaths.has(normPath(node.path));
  const children = (node.children || []) as TreeNode[];
  const hasChildren = children.length > 0;
  const selected = selectedKey === folderKey(node.path);

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: folderDndId(node.path), disabled: isRoot });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: folderDndId(node.path) });

  const style = {
    transform: CSS.Translate.toString(transform),
  } as React.CSSProperties;

  const rowStyle = {
    ...style,
    paddingLeft: BASE_LEFT_PX + depth * INDENT_PX,
    ...treeGuidesStyle(depth),
  } as React.CSSProperties;

  const ignoreClick = () => {
    const until = suppressClickUntilRef?.current ?? 0;
    return Date.now() < until;
  };

  const caretClass = cn(
    "h-4 w-4 transition-transform opacity-80",
    open ? "rotate-90" : "rotate-0",
    !hasChildren && "opacity-0"
  );

  return (
    <div className="mb-0.5">
      <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <ContextMenuTrigger asChild>
          <div
            ref={setDropRef}
            className={cn(
              "rounded",
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
            onContextMenu={(e) => {
              e.stopPropagation();
              if (ignoreClick()) return;
              onSelectFolder(node.path);
              if (openFolderOnClick) onOpenFolder(node.path);
            }}
            onDragOver={(e) => {
              // Allow external OS file drops only (upload)
              if (!isExternalFilesDrag(e.dataTransfer)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              // External OS file drops only (upload)
              if (!isExternalFilesDrag(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              const fs = Array.from(e.dataTransfer.files || []);
              if (fs.length) onDropFilesTo(node.path, fs);
            }}
            title={node.path || "Root"}
          >
            <div
              ref={setDragRef}
              style={rowStyle}
              className={cn(
                "w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left",
                "hover:bg-muted/40",
                selected && "bg-muted/50",
                isDragging && "opacity-60"
              )}
            >
              {/* Drag handle (dnd-kit activator). Keeps clicks/context menus stable. */}
              {isRoot ? (
                <span className="h-5 w-5" />
              ) : (
                <button
                  ref={setActivatorNodeRef}
                  type="button"
                  aria-label="Drag folder"
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded",
                    "text-muted-foreground/70 hover:text-foreground hover:bg-muted/60",
                    "cursor-grab active:cursor-grabbing touch-none select-none"
                  )}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  {...attributes}
                  {...listeners}
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              )}
            <button
              type="button"
              className={cn(
                "p-0.5 rounded hover:bg-muted/60",
                !hasChildren && "opacity-0 pointer-events-none"
              )}
              aria-label={open ? "Collapse" : "Expand"}
              onClick={(e) => {
                e.stopPropagation();
                if (ignoreClick()) return;
                if (!hasChildren) return;
                toggleOpen(node.path);
              }}
            >
              <ChevronRight className={caretClass} />
            </button>

            <button
              type="button"
              className="flex items-center gap-1.5 min-w-0 flex-1 text-left py-0.5"
              onClick={(e) => {
                e.stopPropagation();
                if (ignoreClick()) return;
                onSelectFolder(node.path);
                if (openFolderOnClick) onOpenFolder(node.path);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (ignoreClick()) return;
                onSelectFolder(node.path);
                // VSCode-ish: double-click toggles the tree open/closed,
                // while also "opening" the folder in the main view.
                if (hasChildren) toggleOpen(node.path);
                onOpenFolder(node.path);
              }}
            >
              <Folder className="h-4 w-4 shrink-0" />
              <span className={cn("truncate", isRoot && "font-medium")}>{node.name || "Root"}</span>
            </button>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent key={menuKey} className="min-w-[12rem]">
          <ContextMenuItem onSelect={() => onUploadTo(node.path)}>
            <Upload className="h-4 w-4" /> Upload here
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onNewFolder(node.path)}>
            <FolderPlus className="h-4 w-4" /> New folder…
          </ContextMenuItem>
          {onRenameFolder && !isRoot && !!normPath(node.path) && (
            <ContextMenuItem
              onSelect={(e) => {
                // NOTE: Radix context-menu + modal open can be finicky unless we
                // prevent the default selection behavior and close the menu ourselves.
                e.preventDefault();
                setMenuOpen(false);
                onRenameFolder(node.path);
              }}
            >
              <Pencil className="h-4 w-4" /> Rename…
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />

          <ContextMenuItem disabled={isRoot} onSelect={() => onCopyFolder?.(node.path)}
          >
            <Copy className="h-4 w-4" /> Copy
          </ContextMenuItem>
          <ContextMenuItem disabled={isRoot} onSelect={() => onCutFolder?.(node.path)}
          >
            <Scissors className="h-4 w-4" /> Cut
          </ContextMenuItem>
          <ContextMenuItem disabled={!canPaste} onSelect={() => onPasteInto?.(node.path)}
          >
            <Clipboard className="h-4 w-4" /> Paste
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

          {onDeleteFolder && !isRoot && node.path ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => onDeleteFolder(node.path)}>
                <Trash2 className="h-4 w-4" /> Delete folder…
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>

      {open && hasChildren && (
        <div>
          {children.map((child) =>
            child.type === "folder" ? (
              <FolderRow
                key={`d:${child.path}`}
                node={child}
                isRoot={false}
                depth={depth + 1}
                selectedKey={selectedKey}
                openPaths={openPaths}
                toggleOpen={toggleOpen}
                suppressClickUntilRef={suppressClickUntilRef}
                openFolderOnClick={openFolderOnClick}
                onSelectFolder={onSelectFolder}
                onOpenFolder={onOpenFolder}
                onSelectFile={onSelectFile}
                onOpenFile={onOpenFile}
                onUploadTo={onUploadTo}
                onNewFolder={onNewFolder}
                onRenameFolder={onRenameFolder}
                canPaste={canPaste}
                onCopyFolder={onCopyFolder}
                onCutFolder={onCutFolder}
                onPasteInto={onPasteInto}
                onDeleteFolder={onDeleteFolder}
                onMoveFilesTo={onMoveFilesTo}
                onDropFilesTo={onDropFilesTo}
              />
            ) : (
              <FileRow
                key={`f:${child.file?.id || child.path}`}
                node={child}
                depth={depth + 1}
                selectedKey={selectedKey}
                suppressClickUntilRef={suppressClickUntilRef}
                onSelectFile={onSelectFile}
                onOpenFile={onOpenFile}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({
  node,
  depth,
  selectedKey,
  suppressClickUntilRef,
  onSelectFile,
  onOpenFile,
}: {
  node: TreeNode;
  depth: number;
  selectedKey: string;
  suppressClickUntilRef?: React.MutableRefObject<number>;
  onSelectFile: (file: FileItem) => void;
  onOpenFile: (file: FileItem) => void;
}) {
  const file = node.file;
  if (!file) return null;
  const selected = selectedKey === fileKey(file.id);

  const ignoreClick = () => {
    const until = suppressClickUntilRef?.current ?? 0;
    return Date.now() < until;
  };

  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left",
        "hover:bg-muted/40",
        selected && "bg-muted/50"
      )}
      style={{ paddingLeft: BASE_LEFT_PX + depth * INDENT_PX, ...treeGuidesStyle(depth) }}
      onClick={(e) => {
        e.stopPropagation();
        if (ignoreClick()) return;
        onSelectFile(file);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (ignoreClick()) return;
        onSelectFile(file);
        onOpenFile(file);
      }}
      title={file.name}
    >
      <span className="h-5 w-5 opacity-0" />
      <span className="h-4 w-4 opacity-0" />
      <FileIconByName name={file.name} className="h-4 w-4" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
