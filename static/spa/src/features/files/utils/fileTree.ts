import type { FileItem } from "../api";

export type TreeNode = {
  type: "folder" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
  file?: FileItem;
};

export function buildTree(files: FileItem[], folders: string[] = []): TreeNode {
  const root: TreeNode = { type: "folder", name: "", path: "", children: [] };

  // 1) Explicit folders (so empty folders can exist)
  for (const fp of folders) {
    const parts = (fp || "").split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
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
  }

  // 2) Files (and their implicit parents)
  for (const f of files) {
    const folderParts = (f.folder_path || "").split("/").filter(Boolean);
    const rawName = (f.original_name || f.name || "").split("/").filter(Boolean).pop() || f.name || "Untitled";
    let cur = root;

    for (const part of folderParts) {
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

    (cur.children ||= []).push({
      type: "file",
      name: rawName,
      path: (cur.path ? cur.path + "/" : "") + rawName,
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

export function findNode(root: TreeNode | null | undefined, path: string): TreeNode | null {
  if (!root) return null;
  const norm = (path || "").split("/").filter(Boolean).join("/");
  if (!norm) return root;
  const parts = norm.split("/");
  let cur: TreeNode = root;
  for (const part of parts) {
    const next = (cur.children || []).find((c) => c.type === "folder" && c.name === part);
    if (!next) return null;
    cur = next;
  }
  return cur;
}
