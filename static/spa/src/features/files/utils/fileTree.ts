import type { FileItem } from "../api";

export type TreeNode = {
  type: "folder" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
  file?: FileItem;
};

export function buildTree(files: FileItem[]): TreeNode {
  const root: TreeNode = { type: "folder", name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.name.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const atLeaf = i === parts.length - 1;
      if (atLeaf) {
        (cur.children ||= []).push({
          type: "file",
          name: part,
          path: (cur.path ? cur.path + "/" : "") + part,
          file: f,
        });
      } else {
        let next = cur.children?.find(
          (c) => c.type === "folder" && c.name === part
        );
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
