import { describe, expect, it } from "vitest";

import type { FileItem } from "../api";
import { applyOptimisticFileMoveState, applyOptimisticFolderMoveState } from "./pageHelpers";

const files: FileItem[] = [
  { id: "f1", name: "contract.pdf", original_name: "contract.pdf", folder_path: "clients/acme", size: 10 },
  { id: "f2", name: "notes.txt", original_name: "notes.txt", folder_path: "clients/acme/archive", size: 20 },
  { id: "f3", name: "root.txt", original_name: "root.txt", folder_path: null, size: 30 },
];

describe("files optimistic move helpers", () => {
  it("optimistically moves only files that change folders", () => {
    const result = applyOptimisticFileMoveState({
      files,
      fileIds: ["f1", "f3"],
      destination: "clients/acme",
    });

    expect(result.movedFileIds).toEqual(["f3"]);
    expect(result.files.find((file) => file.id === "f1")?.folder_path).toBe("clients/acme");
    expect(result.files.find((file) => file.id === "f3")?.folder_path).toBe("clients/acme");
  });

  it("remaps moved folder subtrees and explicit folder paths", () => {
    const result = applyOptimisticFolderMoveState({
      files,
      folderPaths: ["clients", "clients/acme", "clients/acme/archive", "shared"],
      movingFolderPaths: ["clients/acme"],
      destination: "shared",
    });

    expect(result.mapPath("clients/acme/archive")).toBe("shared/acme/archive");
    expect(result.folderPaths).toContain("shared/acme");
    expect(result.folderPaths).toContain("shared/acme/archive");
    expect(result.files.find((file) => file.id === "f1")?.folder_path).toBe("shared/acme");
    expect(result.files.find((file) => file.id === "f2")?.folder_path).toBe("shared/acme/archive");
  });
});
