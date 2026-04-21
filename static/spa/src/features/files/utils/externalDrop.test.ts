import { describe, expect, it } from "vitest";

import { mapDroppedFilesToFolders } from "./externalDrop";

function makeFile(name: string, body = "hello") {
  return new File([body], name, { type: "text/plain", lastModified: 1 });
}

describe("mapDroppedFilesToFolders", () => {
  it("maps dropped directory structure under the target folder", () => {
    const items = mapDroppedFilesToFolders("client-a", [
      { file: makeFile("nda.txt"), relativePath: "contracts/nda.txt", destinationFolder: "" },
      { file: makeFile("msa.txt"), relativePath: "contracts/redlines/msa.txt", destinationFolder: "" },
    ]);

    expect(items).toEqual([
      expect.objectContaining({ relativePath: "contracts/nda.txt", destinationFolder: "client-a/contracts" }),
      expect.objectContaining({ relativePath: "contracts/redlines/msa.txt", destinationFolder: "client-a/contracts/redlines" }),
    ]);
  });

  it("normalizes slash variants and deduplicates repeated entries", () => {
    const sharedFile = makeFile("brief.txt");
    const items = mapDroppedFilesToFolders("/team//", [
      { file: sharedFile, relativePath: "\\nested\\brief.txt", destinationFolder: "" },
      { file: sharedFile, relativePath: "nested/brief.txt", destinationFolder: "" },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({ relativePath: "nested/brief.txt", destinationFolder: "team/nested" })
    );
  });

  it("keeps root-level files in the chosen folder", () => {
    const items = mapDroppedFilesToFolders("ops", [
      { file: makeFile("runbook.md"), relativePath: "runbook.md", destinationFolder: "" },
    ]);

    expect(items[0]).toEqual(
      expect.objectContaining({ relativePath: "runbook.md", destinationFolder: "ops" })
    );
  });
});
