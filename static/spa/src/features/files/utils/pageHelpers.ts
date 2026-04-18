import type { FileItem } from "../api";
import type { TreeNode } from "./fileTree";
import { normalizeFolderPath } from "./dnd";

export const DT_INTERNAL_FILE = "application/x-lbpr-file";

export type ClipboardState = {
  op: "copy" | "move";
  folders: string[];
  files: string[];
};

export function basename(path: string) {
  const parts = (path || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function parentPath(path: string) {
  const parts = (path || "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function collectFolderPaths(root: TreeNode | null | undefined): string[] {
  const out: string[] = [];
  const walk = (node: TreeNode | null | undefined) => {
    if (!node) return;
    if (node.type === "folder") out.push(node.path);
    for (const child of node.children || []) {
      if (child.type === "folder") walk(child);
    }
  };
  walk(root);
  return out;
}

export function readInternalFileIds(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];
  const raw = dataTransfer.getData(DT_INTERNAL_FILE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.ids)) {
      return parsed.ids.filter((value: unknown): value is string => typeof value === "string" && !!value);
    }
    const id = parsed?.id;
    return typeof id === "string" && id ? [id] : [];
  } catch {
    return [];
  }
}

export function uniqStrings(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((value) => typeof value === "string" && value)));
}

export function isDescendantPath(ancestor: string, maybeDescendant: string): boolean {
  const normalizedAncestor = (ancestor || "").split("/").filter(Boolean).join("/");
  const normalizedDescendant = (maybeDescendant || "").split("/").filter(Boolean).join("/");
  if (!normalizedAncestor || !normalizedDescendant) return false;
  if (normalizedAncestor === normalizedDescendant) return false;
  return normalizedDescendant.startsWith(normalizedAncestor + "/");
}

export function pickTopLevelFolders(paths: string[]): string[] {
  const normalized = uniqStrings(paths.map((path) => (path || "").split("/").filter(Boolean).join("/"))).filter(Boolean);
  normalized.sort((left, right) => left.length - right.length);

  const out: string[] = [];
  for (const path of normalized) {
    if (out.some((ancestor) => isDescendantPath(ancestor, path))) continue;
    out.push(path);
  }
  return out;
}

export function reduceNestedFolderPaths(paths: string[]): string[] {
  const normalized = uniqStrings(paths.map(normalizeFolderPath));
  normalized.sort((left, right) => left.length - right.length);

  const out: string[] = [];
  for (const path of normalized) {
    if (!path) continue;
    if (out.some((existing) => path === existing || path.startsWith(existing + "/"))) continue;
    out.push(path);
  }
  return out;
}

export function fileParentFolder(files: FileItem[], id: string): string {
  const file = files.find((item) => item.id === id);
  if (!file) return "";
  return parentPath(file.name || "");
}

export function filterFileIdsNotUnderFolders(files: FileItem[], fileIds: string[], folderPaths: string[]): string[] {
  const ids = uniqStrings(fileIds);
  if (!folderPaths.length) return ids;

  const topLevelFolders = reduceNestedFolderPaths(folderPaths);
  if (!topLevelFolders.length) return ids;

  const out: string[] = [];
  for (const id of ids) {
    const parentFolder = normalizeFolderPath(fileParentFolder(files, id));
    if (topLevelFolders.some((folderPath) => parentFolder === folderPath || parentFolder.startsWith(folderPath + "/"))) {
      continue;
    }
    out.push(id);
  }
  return out;
}
