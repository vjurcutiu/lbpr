import { describe, expect, it } from "vitest";

import type { WorkflowRun } from "../types";
import { mergeWorkflowRuns } from "./runs";

function run(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "wf_run_1",
    workflow_id: "summarize",
    title: "Summarize",
    capability: "summarize",
    status: "queued",
    selection: { file_ids: [], folder_paths: [], current_folder: "" },
    inputs: {},
    result: null,
    versions: [],
    created_at: "2026-04-26T10:00:00.000Z",
    updated_at: "2026-04-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("mergeWorkflowRuns", () => {
  it("keeps the newest status when polling responses arrive out of order", () => {
    const completed = run({ status: "completed", updated_at: "2026-04-26T10:00:03.000Z" });
    const staleFailed = run({ status: "failed", updated_at: "2026-04-26T10:00:02.000Z", error: "stale" });

    expect(mergeWorkflowRuns([completed], [staleFailed], 12)[0].status).toBe("completed");
  });

  it("prefers completed over failed when backend timestamps tie", () => {
    const timestamp = "2026-04-26T10:00:03.000Z";
    const failed = run({ status: "failed", updated_at: timestamp, error: "failed" });
    const completed = run({ status: "completed", updated_at: timestamp });

    expect(mergeWorkflowRuns([failed], [completed], 12)[0].status).toBe("completed");
  });
});
