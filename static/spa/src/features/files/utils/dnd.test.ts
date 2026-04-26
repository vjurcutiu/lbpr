import { describe, expect, it } from "vitest";

import {
  folderDndId,
  folderDropData,
  folderDropDndId,
  normalizeFolderPath,
  parseFolderDropDndId,
} from "./dnd";

describe("files dnd identifiers", () => {
  it("keeps draggable folder ids separate from droppable folder ids", () => {
    expect(folderDndId("clients/acme")).toBe("folder:clients/acme");
    expect(folderDropDndId("tree", "clients/acme")).toBe("folder-drop:tree:clients/acme");
    expect(folderDropDndId("list-row", "clients/acme")).toBe("folder-drop:list-row:clients/acme");
    expect(folderDropDndId("current", "clients/acme")).toBe("folder-drop:current:clients/acme");
  });

  it("normalizes folder drop metadata and parses fallback ids", () => {
    expect(folderDropData("list-row", "/clients//acme/")).toEqual({
      type: "folder-drop",
      kind: "list-row",
      folderPath: "clients/acme",
    });
    expect(parseFolderDropDndId("folder-drop:current:clients/acme")).toEqual({
      kind: "current",
      value: "clients/acme",
    });
    expect(parseFolderDropDndId("folder:clients/acme")).toBeNull();
    expect(normalizeFolderPath("/clients//acme/")).toBe("clients/acme");
  });
});
