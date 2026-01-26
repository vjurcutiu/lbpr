// Shared dnd identifiers/helpers for the Files explorer.
// Internal drag & drop uses dnd-kit (pointer-based). External OS file drops use native HTML5 DnD.

export type DndKind = "file" | "folder";

export function normalizeFolderPath(path?: string | null): string {
  // Root folder is represented as empty string.
  return (path || "").split("/").filter(Boolean).join("/");
}

export function fileDndId(fileId: string): string {
  return `file:${fileId}`;
}

export function folderDndId(folderPath?: string | null): string {
  return `folder:${normalizeFolderPath(folderPath)}`;
}

export function parseDndId(id: unknown): { kind: DndKind; value: string } | null {
  if (typeof id !== "string") return null;
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const kind = id.slice(0, idx) as DndKind;
  const value = id.slice(idx + 1);
  if (kind !== "file" && kind !== "folder") return null;
  return { kind, value };
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
