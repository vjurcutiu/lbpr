import type { FileItem } from "../api";

export type TreeNode = {
  type: "folder" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
  file?: FileItem;
};

function ensureFolder(root: TreeNode, folderPath: string): TreeNode {
  const parts = (folderPath || "").split("/").filter(Boolean);
  let cur = root;
  for (const part of parts) {
    let next = cur.children?.find((c) => c.type === "folder" && c.name === part);
    if (!next) {
      next = {
        type: "folder",
        name: part,
        path: (cur.path ? cur.path + "/" : "") + part,
        children: [],
      };
      (cur.children ||= []).push(next);
    }
    cur = next;
  }
  return cur;
}

export function buildTree(files: FileItem[], folders: string[] = []): TreeNode {
  const root: TreeNode = { type: "folder", name: "", path: "", children: [] };

  // 1) Explicit folders (so empty folders appear)
  for (const raw of folders || []) {
    const p = (raw || "")
      .trim()
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\/{2,}/g, "/");
    if (!p) continue;
    ensureFolder(root, p);
  }

  // 2) Implicit folders + files from file paths
  for (const f of files) {
    const parts = (f.name || "").split("/").filter(Boolean);
    if (parts.length === 0) continue;

    // Ensure parent folder nodes exist
    if (parts.length > 1) {
      ensureFolder(root, parts.slice(0, -1).join("/"));
    }

    const base = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const parent = ensureFolder(root, parentPath);
    (parent.children ||= []).push({
      type: "file",
      name: base,
      path: (parent.path ? parent.path + "/" : "") + base,
      file: f,
    });
  }

  function sort(node: TreeNode) {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sort);
  }
  sort(root);
  return root;
}
