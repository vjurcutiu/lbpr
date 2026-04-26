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

function joinFolder(parent: string, child: string) {
  const p = normalizeFolderPath(parent);
  const c = normalizeFolderPath(child);
  if (!p) return c;
  if (!c) return p;
  return `${p}/${c}`;
}

export function isSameOrDescendantPath(ancestor: string, maybeDescendant: string): boolean {
  const normalizedAncestor = normalizeFolderPath(ancestor);
  const normalizedDescendant = normalizeFolderPath(maybeDescendant);
  if (!normalizedAncestor || !normalizedDescendant) return false;
  return normalizedAncestor === normalizedDescendant || normalizedDescendant.startsWith(normalizedAncestor + "/");
}

function remapSubtreePath(path: string, sourceRoot: string, destinationRoot: string) {
  const current = normalizeFolderPath(path);
  const source = normalizeFolderPath(sourceRoot);
  const destination = normalizeFolderPath(destinationRoot);
  if (!source || !isSameOrDescendantPath(source, current)) return current;
  if (current === source) return destination;
  const relative = current.slice(source.length + 1);
  return joinFolder(destination, relative);
}


export type OptimisticFileMoveResult = {
  files: FileItem[];
  movedFileIds: string[];
};

export function applyOptimisticFileMoveState({
  files,
  fileIds,
  destination,
}: {
  files: FileItem[];
  fileIds: string[];
  destination: string;
}): OptimisticFileMoveResult {
  const dest = normalizeFolderPath(destination);
  const idSet = new Set(uniqStrings(fileIds));
  const movedFileIds: string[] = [];

  const nextFiles = files.map((file) => {
    if (!idSet.has(file.id)) return file;
    const currentFolder = normalizeFolderPath(file.folder_path || "");
    if (currentFolder === dest) return file;
    movedFileIds.push(file.id);
    return {
      ...file,
      folder_path: dest || null,
    };
  });

  return {
    files: nextFiles,
    movedFileIds: uniqStrings(movedFileIds),
  };
}

export type OptimisticFolderMoveResult = {
  files: FileItem[];
  folderPaths: string[];
  movedRootPaths: string[];
  mapPath: (path: string) => string;
};

export function applyOptimisticFolderMoveState({
  files,
  folderPaths,
  movingFolderPaths,
  destination,
  movingFileIds = [],
}: {
  files: FileItem[];
  folderPaths: string[];
  movingFolderPaths: string[];
  destination: string;
  movingFileIds?: string[];
}): OptimisticFolderMoveResult {
  const roots = pickTopLevelFolders(movingFolderPaths);
  const dest = normalizeFolderPath(destination);
  const fileIdSet = new Set(movingFileIds.filter(Boolean));

  const rootMoves = roots.map((source) => ({
    source,
    destination: joinFolder(dest, basename(source)),
  }));

  const mapPath = (path: string) => {
    let next = normalizeFolderPath(path);
    for (const move of rootMoves) {
      next = remapSubtreePath(next, move.source, move.destination);
    }
    return next;
  };

  const movedRootPaths = uniqStrings(rootMoves.map((move) => move.destination).filter(Boolean));

  const nextFiles = files.map((file) => {
    const currentFolder = normalizeFolderPath(file.folder_path || "");
    const remappedFolder = mapPath(currentFolder);
    const movedByFolder = remappedFolder !== currentFolder;
    const nextFolder = movedByFolder || fileIdSet.has(file.id) ? (movedByFolder ? remappedFolder : dest) : currentFolder;

    if (nextFolder === currentFolder) return file;
    return {
      ...file,
      folder_path: nextFolder || null,
    };
  });

  const nextFolderSet = new Set<string>();
  for (const folderPath of folderPaths) {
    const mapped = mapPath(folderPath);
    if (mapped) nextFolderSet.add(mapped);
  }
  for (const movedRootPath of movedRootPaths) {
    if (movedRootPath) nextFolderSet.add(movedRootPath);
  }
  if (dest) nextFolderSet.add(dest);

  return {
    files: nextFiles,
    folderPaths: Array.from(nextFolderSet).sort((a, b) => a.localeCompare(b)),
    movedRootPaths,
    mapPath,
  };
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
  return isSameOrDescendantPath(ancestor, maybeDescendant) && normalizeFolderPath(ancestor) !== normalizeFolderPath(maybeDescendant);
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
  return normalizeFolderPath(file.folder_path || parentPath(file.name || ""));
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
