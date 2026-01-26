import { useMemo, useState } from "react";
import { ChevronRight, Folder, Loader2, Upload, FolderPlus, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeNode } from "../utils/fileTree";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const DT_INTERNAL_FILE = "application/x-lbpr-file";

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

export function FileTree({
  node,
  loading = false,
  selectedPath,
  onSelectFolder,
  onUploadTo,
  onNewFolder,
  onMoveFilesTo,
  onDropFilesTo,
}: {
  node: TreeNode | null | undefined;
  loading?: boolean;
  selectedPath: string;
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
  onSelectFolder: (path: string) => void;
  onUploadTo: (path: string) => void;
  onNewFolder: (parentPath: string) => void;
  onMoveFilesTo: (fileIds: string[], folderPath: string) => void;
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

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 1) Internal move
    const movedIds = readInternalFileIds(e.dataTransfer);
    if (movedIds.length) {
      onMoveFilesTo(movedIds, node.path);
      return;
    }

    // 2) External OS files
    const fs = Array.from(e.dataTransfer.files || []);
    if (fs.length) onDropFilesTo(node.path, fs);
  };

  return (
    <div className="mb-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            className={cn(
              "w-full flex items-center gap-1.5 px-2 py-2 rounded text-left",
              "hover:bg-muted/40",
              selected && "bg-muted/50"
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectFolder(node.path);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (folderChildren.length > 0) setOpen((v) => !v);
            }}
            onDragOver={(e) => {
              // Allow drop for move/upload
              e.preventDefault();
              e.dataTransfer.dropEffect = readInternalFileIds(e.dataTransfer).length ? "move" : "copy";
            }}
            onDrop={onDrop}
            title={node.path || "Root"}
          >
            <ChevronRight className={caretClass} />
            <Folder className="h-4 w-4" />
            <span className={cn("truncate", isRoot && "font-medium")}>{node.name || "Root"}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[12rem]">
          <ContextMenuItem
            onSelect={() => onUploadTo(node.path)}
          >
            <Upload className="h-4 w-4" /> Upload here
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => onNewFolder(node.path)}
          >
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
              onMoveFilesTo={onMoveFilesTo}
              onDropFilesTo={onDropFilesTo}
            />
          ))}
        </div>
      )}
    </div>
  );
}
