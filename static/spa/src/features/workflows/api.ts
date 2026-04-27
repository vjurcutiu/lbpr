import { API_BASE, deleteJSON, getJSON, patchJSON, postJSON } from "@/shared/api";
import type {
  CreateWorkflowRunRequest,
  WorkflowAiPartialEditRequest,
  WorkflowAiPartialEditResponse,
  WorkflowArtifact,
  WorkflowArtifactFormat,
  WorkflowEditSaveMode,
  WorkflowEditSaveOptions,
  WorkflowManifest,
  WorkflowRun,
  WorkflowRunList,
  WorkflowRunVersionList,
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

export async function renameWorkflowRun(runId: string, title: string): Promise<WorkflowRun> {
  return patchJSON<WorkflowRun>(`/v1/workflows/runs/${encodeURIComponent(runId)}/title`, { title });
}

export async function refineWorkflowRun(runId: string, prompt: string): Promise<WorkflowRun> {
  return postJSON<WorkflowRun>(`/v1/workflows/runs/${encodeURIComponent(runId)}/refine`, { prompt });
}

export async function deleteWorkflowRun(runId: string): Promise<void> {
  await deleteJSON(`/v1/workflows/runs/${encodeURIComponent(runId)}`);
}


export async function listWorkflowRunVersions(runId: string): Promise<WorkflowRunVersionList> {
  return getJSON<WorkflowRunVersionList>(`/v1/workflows/runs/${encodeURIComponent(runId)}/versions`);
}

export async function selectWorkflowRunVersion(runId: string, versionId: string): Promise<WorkflowRun> {
  return postJSON<WorkflowRun>(
    `/v1/workflows/runs/${encodeURIComponent(runId)}/versions/${encodeURIComponent(versionId)}/select`,
    {}
  );
}

export async function renameWorkflowRunVersion(runId: string, versionId: string, label: string): Promise<WorkflowRun> {
  return patchJSON<WorkflowRun>(
    `/v1/workflows/runs/${encodeURIComponent(runId)}/versions/${encodeURIComponent(versionId)}/label`,
    { label }
  );
}

export async function updateWorkflowRunVersionLayout(
  runId: string,
  versionId: string,
  position: { x: number; y: number }
): Promise<WorkflowRun> {
  return patchJSON<WorkflowRun>(
    `/v1/workflows/runs/${encodeURIComponent(runId)}/versions/${encodeURIComponent(versionId)}/layout`,
    position
  );
}

export async function resetWorkflowRunVersionLayout(runId: string): Promise<WorkflowRun> {
  return postJSON<WorkflowRun>(`/v1/workflows/runs/${encodeURIComponent(runId)}/versions/layout/reset`, {});
}

export async function branchWorkflowRunVersion(runId: string, versionId: string, prompt: string): Promise<WorkflowRun> {
  return postJSON<WorkflowRun>(
    `/v1/workflows/runs/${encodeURIComponent(runId)}/versions/${encodeURIComponent(versionId)}/branch`,
    { prompt }
  );
}

export async function saveWorkflowVersionArtifact(runId: string, versionId: string): Promise<WorkflowArtifact> {
  return postJSON<WorkflowArtifact>(
    `/v1/workflows/runs/${encodeURIComponent(runId)}/versions/${encodeURIComponent(versionId)}/artifact`,
    {}
  );
}

export async function saveWorkflowVersionEdit(
  runId: string,
  versionId: string,
  content: string,
  mode: WorkflowEditSaveMode = "new_version",
  options: WorkflowEditSaveOptions = {}
): Promise<WorkflowRun> {
  return postJSON<WorkflowRun>(
    `/v1/workflows/runs/${encodeURIComponent(runId)}/versions/${encodeURIComponent(versionId)}/edit`,
    { content, mode, ...options }
  );
}

export async function saveWorkflowVersionPartialEdit(
  runId: string,
  versionId: string,
  payload: WorkflowAiPartialEditRequest
): Promise<WorkflowAiPartialEditResponse> {
  return postJSON<WorkflowAiPartialEditResponse>(
    `/v1/workflows/runs/${encodeURIComponent(runId)}/versions/${encodeURIComponent(versionId)}/partial-edit`,
    payload
  );
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

export async function downloadWorkflowArtifact(artifactId: string, format: WorkflowArtifactFormat = "markdown"): Promise<void> {
  const params = new URLSearchParams({ format });
  const res = await fetch(`${API_BASE}/v1/workflows/artifacts/${encodeURIComponent(artifactId)}/download?${params.toString()}`, {
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
