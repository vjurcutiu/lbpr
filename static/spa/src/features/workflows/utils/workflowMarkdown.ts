import type { WorkflowResult } from "../types";

export function stripSourcesUsedSection(markdown: string) {
  return String(markdown || "")
    .replace(/^\s*#{1,6}\s+(?:sources used|source used|sources|source material)\s*$[\s\S]*?(?=^\s*#{1,6}\s+|\s*$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fallbackWorkflowMarkdown(result: WorkflowResult) {
  const lines: string[] = [];
  const summary = String(result.summary || "").trim();
  if (summary) lines.push(summary);

  const bullets = (result.bullets || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (bullets.length) {
    lines.push("", "## Summary", ...bullets.map((item) => `- ${item}`));
  }

  const actions = (result.next_actions || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (actions.length) {
    lines.push("", "## Next steps", ...actions.map((item) => `- ${item}`));
  }

  return lines.join("\n").trim() || "No workflow output is available yet.";
}

export function workflowDocumentMarkdown(result: WorkflowResult) {
  return stripSourcesUsedSection(result.preview_markdown || fallbackWorkflowMarkdown(result));
}
