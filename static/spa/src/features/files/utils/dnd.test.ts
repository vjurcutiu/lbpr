import { describe, expect, it } from "vitest";

import {
  folderDndId,
  folderDragData,
  folderDropData,
  folderDropDndId,
  normalizeFolderPath,
  parseDndId,
  parseFolderDropDndId,
} from "./dnd";

describe("files dnd identifiers", () => {
  it("keeps draggable folder ids unique by render source and separate from droppable ids", () => {
    expect(folderDndId("tree", "clients/acme")).toBe("folder:tree:clients/acme");
    expect(folderDndId("list-row", "clients/acme")).toBe("folder:list-row:clients/acme");
    expect(folderDropDndId("tree", "clients/acme")).toBe("folder-drop:tree:clients/acme");
    expect(folderDropDndId("list-row", "clients/acme")).toBe("folder-drop:list-row:clients/acme");
    expect(folderDropDndId("current", "clients/acme")).toBe("folder-drop:current:clients/acme");
  });

  it("normalizes folder drag/drop metadata and parses ids", () => {
    expect(folderDragData("tree", "/clients//acme/")).toEqual({
      type: "folder",
      source: "tree",
      folderPath: "clients/acme",
    });
    expect(folderDropData("list-row", "/clients//acme/")).toEqual({
      type: "folder-drop",
      kind: "list-row",
      folderPath: "clients/acme",
    });
    expect(parseDndId("folder:tree:clients/acme")).toEqual({
      kind: "folder",
      source: "tree",
      value: "clients/acme",
    });
    expect(parseDndId("folder:clients/acme")).toEqual({
      kind: "folder",
      value: "clients/acme",
    });
    expect(parseFolderDropDndId("folder-drop:current:clients/acme")).toEqual({
      kind: "current",
      value: "clients/acme",
    });
    expect(parseFolderDropDndId("folder:tree:clients/acme")).toBeNull();
    expect(normalizeFolderPath("/clients//acme/")).toBe("clients/acme");
  });
});
