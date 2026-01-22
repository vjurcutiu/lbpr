import { useMemo, useState } from "react";
import {
  ChevronRight,
  Download,
  Folder,
  Loader2,
  Pencil,
  Trash2,
  ArrowRightLeft,
  Copy,
  Upload,
  FolderPlus,
} from "lucide-react";
import type { TreeNode } from "../utils/fileTree";
import type { FileItem } from "../api";
import { fileDownloadUrl } from "../api";
import { cn } from "@/lib/utils";
import { FileIconByName } from "./FileIconByName";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const DND_FILE_ID = "application/x-lbp-file-id";

type Props = {
  node: TreeNode | null | undefined;
  onOpen: (f: FileItem) => void;
  onDelete: (f: FileItem) => void;
  loading?: boolean;

  // Context menu actions
  onRequestRename?: (f: FileItem) => void;
  onRequestMove?: (f: FileItem) => void;

  // Drag/drop + folder actions
  onMoveToFolder?: (fileId: string, folderPath: string) => void;
  onUploadToFolder?: (folderPath: string) => void;
  onUploadFilesToFolder?: (files: File[], folderPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onClearGlobalDragActive?: () => void;
};

export function FileTree({
  node,
  onOpen,
  onDelete,
  loading = false,
  onRequestRename,
  onRequestMove,
  onMoveToFolder,
  onUploadToFolder,
  onUploadFilesToFolder,
  onCreateFolder,
  onClearGlobalDragActive,
}: Props) {
  if (loading) {
    return (
      <div className="text-sm text-muted-foreground p-3 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading files…</span>
      </div>
    );
  }
  if (!node) return <div className="text-sm text-muted-foreground p-2">No files.</div>;

  return (
    <div className="text-sm">
      <RootRow
        onUploadToFolder={onUploadToFolder}
        onUploadFilesToFolder={onUploadFilesToFolder}
        onCreateFolder={onCreateFolder}
        onMoveToFolder={onMoveToFolder}
        onClearGlobalDragActive={onClearGlobalDragActive}
      />

      {(node.children || []).map((child) =>
        child.type === "folder" ? (
          <FolderRow
            key={child.path}
            node={child}
            onOpen={onOpen}
            onDelete={onDelete}
            onRequestRename={onRequestRename}
            onRequestMove={onRequestMove}
            onMoveToFolder={onMoveToFolder}
            onUploadToFolder={onUploadToFolder}
            onUploadFilesToFolder={onUploadFilesToFolder}
            onCreateFolder={onCreateFolder}
            onClearGlobalDragActive={onClearGlobalDragActive}
          />
        ) : (
          <FileRow
            key={child.path}
            node={child}
            onOpen={onOpen}
            onDelete={onDelete}
            onRequestRename={onRequestRename}
            onRequestMove={onRequestMove}
          />
        )
      )}
    </div>
  );
}

function RootRow({
  onUploadToFolder,
  onUploadFilesToFolder,
  onCreateFolder,
  onMoveToFolder,
  onClearGlobalDragActive,
}: {
  onUploadToFolder?: (folderPath: string) => void;
  onUploadFilesToFolder?: (files: File[], folderPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onMoveToFolder?: (fileId: string, folderPath: string) => void;
  onClearGlobalDragActive?: () => void;
}) {
  const [over, setOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClearGlobalDragActive?.();
    setOver(false);

    const dt = e.dataTransfer;
    const internalId = dt.getData(DND_FILE_ID);
    if (internalId && onMoveToFolder) {
      onMoveToFolder(internalId, "");
      return;
    }

    if (dt.files && dt.files.length && onUploadFilesToFolder) {
      onUploadFilesToFolder(Array.from(dt.files), "");
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "mb-1 flex items-center gap-2 px-2 py-2 rounded text-left select-none",
            "hover:bg-muted/40",
            over && "bg-muted/60"
          )}
          title="root"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClearGlobalDragActive?.();
            setOver(true);
            if (e.dataTransfer.types.includes(DND_FILE_ID)) e.dataTransfer.dropEffect = "move";
          }}
          onDragLeave={() => setOver(false)}
          onDrop={handleDrop}
        >
          <Folder className="h-4 w-4" />
          <span className="font-medium">Root</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[12rem]">
        <ContextMenuItem onClick={() => onUploadToFolder?.("")}> 
          <Upload className="h-4 w-4" /> Upload here
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCreateFolder?.("")}> 
          <FolderPlus className="h-4 w-4" /> New folder…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FolderRow({
  node,
  onOpen,
  onDelete,
  onRequestRename,
  onRequestMove,
  onMoveToFolder,
  onUploadToFolder,
  onUploadFilesToFolder,
  onCreateFolder,
  onClearGlobalDragActive,
}: {
  node: TreeNode;
  onOpen: (f: FileItem) => void;
  onDelete: (f: FileItem) => void;
  onRequestRename?: (f: FileItem) => void;
  onRequestMove?: (f: FileItem) => void;
  onMoveToFolder?: (fileId: string, folderPath: string) => void;
  onUploadToFolder?: (folderPath: string) => void;
  onUploadFilesToFolder?: (files: File[], folderPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onClearGlobalDragActive?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [over, setOver] = useState(false);

  const caretClass = cn("h-4 w-4 transition-transform", open ? "rotate-90" : "rotate-0");

  const childCount = useMemo(() => (node.children ? node.children.length : 0), [node.children]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClearGlobalDragActive?.();
    setOver(false);

    const dt = e.dataTransfer;

    // Internal file move
    const internalId = dt.getData(DND_FILE_ID);
    if (internalId && onMoveToFolder) {
      onMoveToFolder(internalId, node.path);
      return;
    }

    // OS file drop => upload into this folder
    if (dt.files && dt.files.length && onUploadFilesToFolder) {
      onUploadFilesToFolder(Array.from(dt.files), node.path);
      return;
    }
  };

  return (
    <div className="mb-0.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            className={cn(
              "w-full flex items-center gap-1.5 px-2 py-2 rounded text-left",
              "hover:bg-muted/40",
              over && "bg-muted/60"
            )}
            onClick={() => setOpen((v) => !v)}
            title={node.path}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClearGlobalDragActive?.();
              setOver(true);
              if (e.dataTransfer.types.includes(DND_FILE_ID)) e.dataTransfer.dropEffect = "move";
              else if (Array.from(e.dataTransfer.types).includes("Files")) e.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={() => setOver(false)}
            onDrop={handleDrop}
          >
            <ChevronRight className={caretClass} />
            <Folder className="h-4 w-4" />
            <span className="font-medium">{node.name || "root"}</span>
            {childCount > 0 && <span className="ml-2 text-[11px] text-muted-foreground">({childCount})</span>}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[12rem]">
          <ContextMenuItem onClick={() => onUploadToFolder?.(node.path)}>
            <Upload className="h-4 w-4" /> Upload here
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCreateFolder?.(node.path)}>
            <FolderPlus className="h-4 w-4" /> New folder…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(node.path);
              } catch {
                // ignore
              }
            }}
          >
            <Copy className="h-4 w-4" /> Copy path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {open && (
        <div className="ml-5">
          {(node.children || []).map((child) =>
            child.type === "folder" ? (
              <FolderRow
                key={child.path}
                node={child}
                onOpen={onOpen}
                onDelete={onDelete}
                onRequestRename={onRequestRename}
                onRequestMove={onRequestMove}
                onMoveToFolder={onMoveToFolder}
                onUploadToFolder={onUploadToFolder}
                onUploadFilesToFolder={onUploadFilesToFolder}
                onCreateFolder={onCreateFolder}
                onClearGlobalDragActive={onClearGlobalDragActive}
              />
            ) : (
              <FileRow
                key={child.path}
                node={child}
                onOpen={onOpen}
                onDelete={onDelete}
                onRequestRename={onRequestRename}
                onRequestMove={onRequestMove}
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
  onOpen,
  onDelete,
  onRequestRename,
  onRequestMove,
}: {
  node: TreeNode;
  onOpen: (f: FileItem) => void;
  onDelete: (f: FileItem) => void;
  onRequestRename?: (f: FileItem) => void;
  onRequestMove?: (f: FileItem) => void;
}) {
  const f = node.file!;
  const href = fileDownloadUrl(f.id);

  const displayName = node.name;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex items-center justify-between rounded hover:bg-muted/40"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_FILE_ID, f.id);
            e.dataTransfer.effectAllowed = "move";
            try {
              e.dataTransfer.setData("text/plain", f.name);
            } catch {
              // ignore
            }
          }}
        >
          <button
            className="min-w-0 flex-1 flex items-center gap-2 px-2 py-2 rounded text-left"
            title={f.name}
            onClick={() => onOpen(f)}
          >
            <FileIconByName name={displayName} className="h-4 w-4 shrink-0" />
            <span className="truncate">{displayName}</span>
          </button>

          <div className="shrink-0 w-[2.25rem] flex items-center justify-end pr-1">
            <a
              href={href}
              title="Download"
              className="p-2 rounded hover:bg-muted"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-[13rem]">
        <ContextMenuItem onClick={() => onOpen(f)}>
          <ArrowRightLeft className="h-4 w-4" /> Open
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            window.open(href, "_self");
          }}
        >
          <Download className="h-4 w-4" /> Download
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onRequestRename?.(f)}>
          <Pencil className="h-4 w-4" /> Rename…
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRequestMove?.(f)}>
          <ArrowRightLeft className="h-4 w-4" /> Move to…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(f.name);
            } catch {
              // ignore
            }
          }}
        >
          <Copy className="h-4 w-4" /> Copy path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(f)}>
          <Trash2 className="h-4 w-4" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
