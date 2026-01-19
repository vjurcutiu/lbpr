import { Download, MoreVertical, Trash2, ChevronRight, Folder, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TreeNode } from "../utils/fileTree";
import type { FileItem } from "../api";
import { fileDownloadUrl } from "../api";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { FileIconByName } from "./FileIconByName";

export function FileTree({
  node,
  onOpen,
  onDelete,
  loading = false,
}: {
  node: TreeNode | null | undefined;
  onOpen: (f: FileItem) => void;
  onDelete: (f: FileItem) => void;
  /** When true and no data yet, show a friendly loading state */
  loading?: boolean;
}) {
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
  const caretClass = cn("h-4 w-4 transition-transform", open ? "rotate-90" : "rotate-0");

  return (
    <div className="mb-0.5">
      <button
        className="w-full flex items-center gap-1.5 px-2 py-2 hover:bg-muted/40 rounded text-left"
        onClick={() => setOpen((v) => !v)}
        title={node.path}
      >
        <ChevronRight className={caretClass} />
        <Folder className="h-4 w-4" />
        <span className="font-medium">{node.name || "root"}</span>
        {node.children && node.children.length > 0 && (
          <span className="ml-2 text-[11px] text-muted-foreground">({node.children.length})</span>
        )}
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
  node: TreeNode;
  onOpen: (f: FileItem) => void;
  onDelete: (f: FileItem) => void;
}) {
  const f = node.file!;
  const href = fileDownloadUrl(f.id);
  return (
    <div className="group flex items-center justify-between rounded hover:bg-muted/40">
      {/* LEFT: clickable filename - ensure truncation */}
      <button
        className="min-w-0 flex-1 flex items-center gap-2 px-2 py-2 rounded text-left"
        title={`${f.name}`}
        onClick={() => onOpen(f)}
      >
        <FileIconByName name={node.name} className="h-4 w-4 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>

      {/* RIGHT: actions - always visible and fixed-area so text never overlaps */}
      <div className="shrink-0 w-[4.25rem] flex items-center justify-end gap-0.5 pr-1">
        <a
          href={href}
          title="Download"
          className="p-2 rounded hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            console.debug("[files] click sidebar download", { id: f.id, href });
          }}
        >
          <Download className="h-4 w-4" />
        </a>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-2 rounded hover:bg-muted" title="More">
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
              className="text-destructive focus:text-destructive"
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
