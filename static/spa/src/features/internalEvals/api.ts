import { API_BASE, getJSON, patchJSON, postJSON } from "@/shared/api";
import type {
  EvalCaseSummary,
  EvalComparisonResponse,
  EvalJob,
  EvalResultDetail,
  EvalResultSummary,
  EvalSelectionOptions,
  EvalReviewRecord,
  EvalRunRequest,
} from "./types";

export async function getInternalEvalStatus(): Promise<{ enabled: boolean }> {
  return getJSON("/v1/internal/evals/status");
}

export async function listEvalCases(): Promise<EvalCaseSummary[]> {
  return getJSON("/v1/internal/evals/cases");
}


export async function listEvalSelectionOptions(uid?: string | null): Promise<EvalSelectionOptions> {
  const query = uid?.trim() ? `?uid=${encodeURIComponent(uid.trim())}` : "";
  return getJSON(`/v1/internal/evals/selection-options${query}`);
}

export async function listEvalResults(limit = 50): Promise<EvalResultSummary[]> {
  return getJSON(`/v1/internal/evals/results?limit=${encodeURIComponent(String(limit))}`);
}

export async function getEvalResult(resultId: string): Promise<EvalResultDetail> {
  return getJSON(`/v1/internal/evals/results/${encodeURIComponent(resultId)}`);
}

export async function createEvalRun(payload: EvalRunRequest): Promise<{ job: EvalJob }> {
  return postJSON("/v1/internal/evals/runs", payload);
}

export async function getEvalJob(jobId: string): Promise<EvalJob> {
  return getJSON(`/v1/internal/evals/runs/${encodeURIComponent(jobId)}`);
}

export async function saveEvalReview(
  resultId: string,
  payload: { reviewer_notes: string; run_reviews: EvalReviewRecord["run_reviews"] }
): Promise<EvalReviewRecord> {
  return patchJSON(`/v1/internal/evals/results/${encodeURIComponent(resultId)}/review`, payload);
}

export async function compareEvalResults(currentResult: string, baselineResult: string): Promise<EvalComparisonResponse> {
  return postJSON("/v1/internal/evals/compare", {
    current_result: currentResult,
    baseline_result: baselineResult,
    write: true,
  });
}

export function evalResultDownloadUrl(resultId: string): string {
  return `${API_BASE}/v1/internal/evals/results/${encodeURIComponent(resultId)}/download`;
}
