import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronRight, Folder, Loader2, Upload, FolderPlus, Copy } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";

import { cn } from "@/lib/utils";
import type { TreeNode } from "../utils/fileTree";
import { folderDndId, isExternalFilesDrag } from "../utils/dnd";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function FileTree({
  node,
  loading = false,
  selectedPath,
  suppressClickUntilRef,
  onSelectFolder,
  onUploadTo,
  onNewFolder,
  onMoveFilesTo,
  onDropFilesTo,
}: {
  node: TreeNode | null | undefined;
  loading?: boolean;
  selectedPath: string;
  suppressClickUntilRef?: React.MutableRefObject<number>;
  onSelectFolder: (path: string) => void;
  onUploadTo: (path: string) => void;
  onNewFolder: (parentPath: string) => void;
  onMoveFilesTo: (fileIds: string[], folderPath: string) => void;
  onDropFilesTo: (folderPath: string, files: File[]) => void;
}) {
  const children = useMemo(() => {
    const kids = (node?.children || []).filter((c) => c.type === "folder");
    return kids;
  }, [node]);

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground p-3 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading folders…</span>
      </div>
    );
  }

  return (
    <div className="text-sm">
      <FolderRow
        node={{ type: "folder", name: "Files", path: "", children }}
        isRoot
        selectedPath={selectedPath}
        suppressClickUntilRef={suppressClickUntilRef}
        onSelectFolder={onSelectFolder}
        onUploadTo={onUploadTo}
        onNewFolder={onNewFolder}
        onMoveFilesTo={onMoveFilesTo}
        onDropFilesTo={onDropFilesTo}
      />
    </div>
  );
}

function FolderRow({
  node,
  isRoot = false,
  depth = 0,
  selectedPath,
  suppressClickUntilRef,
  onSelectFolder,
  onUploadTo,
  onNewFolder,
  onMoveFilesTo,
  onDropFilesTo,
}: {
  node: TreeNode;
  isRoot?: boolean;
  depth?: number;
  selectedPath: string;
  suppressClickUntilRef?: React.MutableRefObject<number>;
  onSelectFolder: (path: string) => void;
  onUploadTo: (path: string) => void;
  onNewFolder: (parentPath: string) => void;
  onMoveFilesTo: (fileIds: string[], folderPath: string) => void;
  onDropFilesTo: (folderPath: string, files: File[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuKey, setMenuKey] = useState(0);
  const folderChildren = (node.children || []).filter((c) => c.type === "folder");

  const { setNodeRef, isOver } = useDroppable({ id: folderDndId(node.path) });

  const caretClass = cn(
    "h-4 w-4 transition-transform opacity-80",
    open ? "rotate-90" : "rotate-0",
    folderChildren.length === 0 && "opacity-0"
  );

  const selected = (selectedPath || "") === (node.path || "");

  const ignoreClick = () => {
    const until = suppressClickUntilRef?.current ?? 0;
    return Date.now() < until;
  };

  return (
    <div className="mb-0.5">
      <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <ContextMenuTrigger asChild>
          <button
            ref={setNodeRef}
            className={cn(
              "w-full flex items-center gap-1.5 px-2 py-2 rounded text-left",
              "hover:bg-muted/40",
              selected && "bg-muted/50",
              isOver && "ring-2 ring-primary/40 ring-inset bg-primary/5"
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
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
            onClick={(e) => {
              e.stopPropagation();
              if (ignoreClick()) return;
              onSelectFolder(node.path);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (ignoreClick()) return;
              if (folderChildren.length > 0) setOpen((v) => !v);
            }}
            onContextMenu={(e) => {
              e.stopPropagation();
              if (ignoreClick()) return;
              onSelectFolder(node.path);
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
            <ChevronRight className={caretClass} />
            <Folder className="h-4 w-4" />
            <span className={cn("truncate", isRoot && "font-medium")}>{node.name || "Root"}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent key={menuKey} className="min-w-[12rem]">
          <ContextMenuItem onSelect={() => onUploadTo(node.path)}>
            <Upload className="h-4 w-4" /> Upload here
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onNewFolder(node.path)}>
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

      {open && folderChildren.length > 0 && (
        <div>
          {folderChildren.map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              suppressClickUntilRef={suppressClickUntilRef}
              onSelectFolder={onSelectFolder}
              onUploadTo={onUploadTo}
              onNewFolder={onNewFolder}
              onMoveFilesTo={onMoveFilesTo}
              onDropFilesTo={onDropFilesTo}
            />
          ))}
        </div>
      )}
    </div>
  );
}
