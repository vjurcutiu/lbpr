import { getJSON, postJSON } from "@/shared/api";
import type {
  CreateWorkflowRunRequest,
  WorkflowManifest,
  WorkflowRun,
  WorkflowRunList,
} from "./types";

export async function listWorkflows(): Promise<WorkflowManifest[]> {
  return getJSON<WorkflowManifest[]>("/v1/workflows");
}

export async function listWorkflowRuns(limit = 8): Promise<WorkflowRunList> {
  return getJSON<WorkflowRunList>(`/v1/workflows/runs?limit=${encodeURIComponent(String(limit))}`);
}

export async function createWorkflowRun(payload: CreateWorkflowRunRequest): Promise<WorkflowRun> {
  return postJSON<WorkflowRun>("/v1/workflows/runs", payload);
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun> {
  return getJSON<WorkflowRun>(`/v1/workflows/runs/${encodeURIComponent(runId)}`);
}
