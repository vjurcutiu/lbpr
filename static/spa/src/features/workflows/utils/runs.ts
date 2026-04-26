import type { WorkflowRun, WorkflowStatus } from "../types";

const WORKFLOW_STATUS_RANK: Record<WorkflowStatus, number> = {
  queued: 0,
  running: 1,
  failed: 2,
  completed: 3,
};

export function workflowRunUpdatedTime(run: Pick<WorkflowRun, "updated_at" | "created_at">): number {
  const updated = Date.parse(String(run.updated_at || ""));
  if (Number.isFinite(updated)) return updated;

  const created = Date.parse(String(run.created_at || ""));
  return Number.isFinite(created) ? created : 0;
}

function isFreshWorkflowRun(candidate: WorkflowRun, existing: WorkflowRun): boolean {
  const candidateTime = workflowRunUpdatedTime(candidate);
  const existingTime = workflowRunUpdatedTime(existing);

  if (candidateTime !== existingTime) return candidateTime > existingTime;

  const candidateRank = WORKFLOW_STATUS_RANK[candidate.status] ?? 0;
  const existingRank = WORKFLOW_STATUS_RANK[existing.status] ?? 0;
  if (candidateRank !== existingRank) return candidateRank > existingRank;

  // Same logical version: prefer the incoming/current candidate so title, artifact,
  // and metadata edits are not accidentally held back by the merge.
  return true;
}

export function mergeWorkflowRuns(current: WorkflowRun[], incoming: WorkflowRun[], limit = 12): WorkflowRun[] {
  const byId = new Map<string, WorkflowRun>();

  for (const run of current) {
    if (run?.id) byId.set(run.id, run);
  }

  for (const run of incoming) {
    if (!run?.id) continue;
    const existing = byId.get(run.id);
    if (!existing || isFreshWorkflowRun(run, existing)) {
      byId.set(run.id, run);
    }
  }

  return [...byId.values()]
    .sort((a, b) => workflowRunUpdatedTime(b) - workflowRunUpdatedTime(a))
    .slice(0, Math.max(1, limit));
}
