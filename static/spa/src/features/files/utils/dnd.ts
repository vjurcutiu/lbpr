// Shared dnd identifiers/helpers for the Files explorer.
// Internal drag & drop uses dnd-kit (pointer-based). External OS file drops use native HTML5 DnD.

export type DndKind = "file" | "folder";
export type FolderDragSource = "tree" | "list-row";
export type FolderDropKind = "tree" | "list-row" | "current";

export type FolderDragData = {
  type: "folder";
  source: FolderDragSource;
  folderPath: string;
};

export type FolderDropData = {
  type: "folder-drop";
  kind: FolderDropKind;
  folderPath: string;
};

export function normalizeFolderPath(path?: string | null): string {
  // Root folder is represented as empty string.
  return (path || "").split("/").filter(Boolean).join("/");
}

export function fileDndId(fileId: string): string {
  return `file:${fileId}`;
}

export function folderDndId(source: FolderDragSource, folderPath?: string | null): string {
  return `folder:${source}:${normalizeFolderPath(folderPath)}`;
}

export function folderDragData(source: FolderDragSource, folderPath?: string | null): FolderDragData {
  return {
    type: "folder",
    source,
    folderPath: normalizeFolderPath(folderPath),
  };
}

export function folderDropDndId(kind: FolderDropKind, folderPath?: string | null): string {
  return `folder-drop:${kind}:${normalizeFolderPath(folderPath)}`;
}

export function folderDropData(kind: FolderDropKind, folderPath?: string | null): FolderDropData {
  return {
    type: "folder-drop",
    kind,
    folderPath: normalizeFolderPath(folderPath),
  };
}

export function parseFolderDropDndId(id: unknown): { kind: FolderDropKind; value: string } | null {
  if (typeof id !== "string") return null;
  const prefix = "folder-drop:";
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  const idx = rest.indexOf(":");
  if (idx <= 0) return null;
  const kind = rest.slice(0, idx) as FolderDropKind;
  if (kind !== "tree" && kind !== "list-row" && kind !== "current") return null;
  return { kind, value: rest.slice(idx + 1) };
}

export function parseDndId(id: unknown): { kind: DndKind; value: string; source?: FolderDragSource } | null {
  if (typeof id !== "string") return null;
  if (id.startsWith("file:")) {
    return { kind: "file", value: id.slice("file:".length) };
  }
  if (!id.startsWith("folder:")) return null;

  const rest = id.slice("folder:".length);
  const separator = rest.indexOf(":");
  if (separator > 0) {
    const maybeSource = rest.slice(0, separator) as FolderDragSource;
    if (maybeSource === "tree" || maybeSource === "list-row") {
      return { kind: "folder", source: maybeSource, value: rest.slice(separator + 1) };
    }
  }

  // Backward-compatible parsing for any stale drag ids from older builds.
  return { kind: "folder", value: rest };
}

export function isExternalFilesDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  try {
    const types = Array.from((dt.types as any) || []);
    return types.includes("Files");
  } catch {
    return false;
  }
}
