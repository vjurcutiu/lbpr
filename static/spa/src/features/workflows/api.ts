import { API_BASE, getJSON, postJSON } from "@/shared/api";
import type {
  CreateWorkflowRunRequest,
  WorkflowArtifact,
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


export async function saveWorkflowArtifact(runId: string): Promise<WorkflowArtifact> {
  return postJSON<WorkflowArtifact>(`/v1/workflows/runs/${encodeURIComponent(runId)}/artifact`, {});
}

export async function getWorkflowArtifact(artifactId: string): Promise<WorkflowArtifact> {
  return getJSON<WorkflowArtifact>(`/v1/workflows/artifacts/${encodeURIComponent(artifactId)}`);
}

function fileNameFromDisposition(value: string | null): string {
  const text = value || "";
  const utfMatch = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]);
  const simpleMatch = text.match(/filename="?([^";]+)"?/i);
  return simpleMatch?.[1] || "workflow-output.md";
}

export async function downloadWorkflowArtifact(artifactId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/workflows/artifacts/${encodeURIComponent(artifactId)}/download`, {
    credentials: "include",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || res.statusText || "Failed to download artifact");
  }

  const blob = await res.blob();
  const fileName = fileNameFromDisposition(res.headers.get("content-disposition"));
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}
