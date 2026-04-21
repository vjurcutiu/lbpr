import { normalizeFolderPath } from "./dnd";

export type UploadTargetFile = {
  file: File;
  destinationFolder: string;
  relativePath: string;
};

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (success: (file: File) => void, error?: (err: DOMException) => void) => void;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (err: DOMException) => void) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike;
};

type FileSystemHandleLike = {
  kind: "file" | "directory";
  name: string;
};

type FileSystemFileHandleLike = FileSystemHandleLike & {
  getFile: () => Promise<File>;
};

type FileSystemDirectoryHandleLike = FileSystemHandleLike & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandleLike]>;
};

type DataTransferItemLike = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
  getAsFileSystemHandle?: () => Promise<FileSystemHandleLike>;
};

function normalizeRelativePath(relativePath: string, fallbackName: string): string {
  const raw = (relativePath || fallbackName || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => !!segment && segment !== "." && segment !== "..")
    .join("/");
  return raw || fallbackName || "file";
}

function joinRelativePath(parent: string, child: string): string {
  return normalizeRelativePath([parent, child].filter(Boolean).join("/"), child || "file");
}

function getParentFolder(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath, "");
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function dedupeFiles(items: UploadTargetFile[]): UploadTargetFile[] {
  const seen = new Set<string>();
  const out: UploadTargetFile[] = [];
  for (const item of items) {
    const key = [
      item.relativePath,
      item.file.name,
      item.file.size,
      item.file.lastModified,
      item.destinationFolder,
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sortFiles(items: UploadTargetFile[]): UploadTargetFile[] {
  return [...items].sort((a, b) => {
    const folderCmp = a.destinationFolder.localeCompare(b.destinationFolder);
    if (folderCmp !== 0) return folderCmp;
    return a.relativePath.localeCompare(b.relativePath);
  });
}

async function readFileEntry(entry: FileSystemFileEntryLike, parentPath: string): Promise<UploadTargetFile[]> {
  const file = await new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
  const relativePath = joinRelativePath(parentPath, file.name || entry.name || "file");
  return [
    {
      file,
      relativePath,
      destinationFolder: "",
    },
  ];
}

async function readAllDirectoryEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  const entries: FileSystemEntryLike[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

async function readWebkitEntry(entry: FileSystemEntryLike, parentPath = ""): Promise<UploadTargetFile[]> {
  if (entry.isFile) {
    return readFileEntry(entry as FileSystemFileEntryLike, parentPath);
  }
  if (!entry.isDirectory) return [];
  const dir = entry as FileSystemDirectoryEntryLike;
  const nextParent = joinRelativePath(parentPath, entry.name || "folder");
  const children = await readAllDirectoryEntries(dir.createReader());
  const nested = await Promise.all(children.map((child) => readWebkitEntry(child, nextParent)));
  return nested.flat();
}

async function readFileHandle(handle: FileSystemFileHandleLike, parentPath: string): Promise<UploadTargetFile[]> {
  const file = await handle.getFile();
  const relativePath = joinRelativePath(parentPath, file.name || handle.name || "file");
  return [
    {
      file,
      relativePath,
      destinationFolder: "",
    },
  ];
}

async function readFileSystemHandle(handle: FileSystemHandleLike, parentPath = ""): Promise<UploadTargetFile[]> {
  if (handle.kind === "file") {
    return readFileHandle(handle as FileSystemFileHandleLike, parentPath);
  }
  const directoryHandle = handle as FileSystemDirectoryHandleLike;
  const nextParent = joinRelativePath(parentPath, handle.name || "folder");
  const nested: UploadTargetFile[] = [];
  for await (const [, childHandle] of directoryHandle.entries()) {
    nested.push(...(await readFileSystemHandle(childHandle, nextParent)));
  }
  return nested;
}

function buildFallbackFiles(dt: DataTransfer): UploadTargetFile[] {
  return Array.from(dt.files || []).map((file) => {
    const rawRelative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return {
      file,
      relativePath: normalizeRelativePath(rawRelative, file.name),
      destinationFolder: "",
    };
  });
}

export function mapDroppedFilesToFolders(baseFolder: string, files: UploadTargetFile[]): UploadTargetFile[] {
  const normalizedBase = normalizeFolderPath(baseFolder);
  const mapped = files.map((item) => {
    const relativePath = normalizeRelativePath(item.relativePath, item.file.name);
    const relativeFolder = getParentFolder(relativePath);
    const destinationFolder = normalizeFolderPath([normalizedBase, relativeFolder].filter(Boolean).join("/"));
    return {
      ...item,
      relativePath,
      destinationFolder,
    };
  });
  return sortFiles(dedupeFiles(mapped));
}

export async function extractExternalDropFiles(dt: DataTransfer | null, baseFolder = ""): Promise<UploadTargetFile[]> {
  if (!dt) return [];

  const items = Array.from((dt.items || []) as ArrayLike<DataTransferItemLike>).filter((item) => item.kind === "file");

  let extracted: UploadTargetFile[] = [];

  if (items.length) {
    const handleReads = items
      .filter((item) => typeof item.getAsFileSystemHandle === "function")
      .map(async (item) => {
        try {
          const handle = await item.getAsFileSystemHandle!();
          return await readFileSystemHandle(handle);
        } catch {
          return [] as UploadTargetFile[];
        }
      });

    const handleResults = handleReads.length ? (await Promise.all(handleReads)).flat() : [];
    if (handleResults.length) {
      extracted = handleResults;
    } else {
      const entryReads = items
        .map((item) => {
          try {
            return item.webkitGetAsEntry?.() || null;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is FileSystemEntryLike => !!entry)
        .map((entry) => readWebkitEntry(entry));
      const entryResults = entryReads.length ? (await Promise.all(entryReads)).flat() : [];
      if (entryResults.length) extracted = entryResults;
    }
  }

  if (!extracted.length) {
    extracted = buildFallbackFiles(dt);
  }

  return mapDroppedFilesToFolders(baseFolder, extracted);
}

export function describeDropTargets(files: UploadTargetFile[]): { folderCount: number; primaryFolder: string } {
  const folders = new Set(files.map((item) => normalizeFolderPath(item.destinationFolder)));
  const primaryFolder = files[0]?.destinationFolder || "";
  return { folderCount: folders.size, primaryFolder };
}
