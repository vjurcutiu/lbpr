import { useMemo, useRef, useState } from "react";
import { useDndMonitor, useDroppable } from "@dnd-kit/core";
import { ChevronRight, Folder, Loader2, Upload, FolderPlus, Copy } from "lucide-react";
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
  onSelectFolder,
  onUploadTo,
  onNewFolder,
  onDropFilesTo,
}: {
  node: TreeNode | null | undefined;
  loading?: boolean;
  selectedPath: string;
  onSelectFolder: (path: string) => void;
  onUploadTo: (path: string) => void;
  onNewFolder: (parentPath: string) => void;
  onDropFilesTo: (folderPath: string, files: File[]) => void;
}) {
  const children = useMemo(() => {
    return (node?.children || []).filter((c) => c.type === "folder");
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
        onSelectFolder={onSelectFolder}
        onUploadTo={onUploadTo}
        onNewFolder={onNewFolder}
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
  onSelectFolder,
  onUploadTo,
  onNewFolder,
  onDropFilesTo,
}: {
  node: TreeNode;
  isRoot?: boolean;
  depth?: number;
  selectedPath: string;
  onSelectFolder: (path: string) => void;
  onUploadTo: (path: string) => void;
  onNewFolder: (parentPath: string) => void;
  onDropFilesTo: (folderPath: string, files: File[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const folderChildren = (node.children || []).filter((c) => c.type === "folder");
  const caretClass = cn(
    "h-4 w-4 transition-transform opacity-80",
    open ? "rotate-90" : "rotate-0",
    folderChildren.length === 0 && "opacity-0"
  );

  const selected = (selectedPath || "") === (node.path || "");

  const droppableId = folderDndId(node.path);

  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
  });

  const justDroppedRef = useRef(0);
  useDndMonitor({
    onDragEnd(event) {
      if (event.over?.id === droppableId) {
        justDroppedRef.current = Date.now();
      }
    },
  });

  const onDrop = (e: React.DragEvent) => {
    // External OS files only (internal moves are handled by dnd-kit)
    const fs = Array.from(e.dataTransfer.files || []);
    if (!fs.length) return;

    e.preventDefault();
    e.stopPropagation();
    onDropFilesTo(node.path, fs);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!isExternalFilesDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  return (
    <div className="mb-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={setNodeRef}
            className={cn(
              "w-full flex items-center gap-1.5 px-2 py-2 rounded text-left",
              "hover:bg-muted/40",
              selected && "bg-muted/50",
              isOver && "bg-muted/60"
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={(e) => {
              e.stopPropagation();
              if (Date.now() - justDroppedRef.current < 250) return;
              onSelectFolder(node.path);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (Date.now() - justDroppedRef.current < 250) return;
              if (folderChildren.length > 0) setOpen((v) => !v);
            }}
            onDragOver={onDragOver}
            onDrop={onDrop}
            title={node.path || "Root"}
          >
            <ChevronRight className={caretClass} />
            <Folder className="h-4 w-4" />
            <span className={cn("truncate", isRoot && "font-medium")}>{node.name || "Root"}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[12rem]">
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
              onSelectFolder={onSelectFolder}
              onUploadTo={onUploadTo}
              onNewFolder={onNewFolder}
              onDropFilesTo={onDropFilesTo}
            />
          ))}
        </div>
      )}
    </div>
  );
}
