from __future__ import annotations

import json
import re
from pathlib import Path

from .schemas import WorkflowEvalComparisonExport, WorkflowEvalExport, WorkflowEvalRunRecord


def slug(value: str, fallback: str = "workflow-eval") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip().lower()).strip("-._")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    return cleaned or fallback


def write_json(path: str | Path, payload) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        json.dump(payload.model_dump(mode="json"), handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return target


def _status_icon(status: str) -> str:
    if status == "completed":
        return "✅"
    if status == "failed":
        return "❌"
    return "⏭️"


def _validation_line(run: WorkflowEvalRunRecord) -> str:
    errors = sum(1 for issue in run.validation.issues if issue.severity == "error")
    warnings = sum(1 for issue in run.validation.issues if issue.severity == "warning")
    if not errors and not warnings:
        return "passed"
    return f"{errors} error(s), {warnings} warning(s)"


def write_markdown_bundle(export: WorkflowEvalExport, output_dir: str | Path) -> Path:
    timestamp = export.created_at.strftime("%Y%m%dT%H%M%SZ")
    bundle_dir = Path(output_dir) / f"{slug(export.eval_id)}__{timestamp}"
    bundle_dir.mkdir(parents=True, exist_ok=True)

    summary_lines = [
        f"# Workflow Eval: {export.eval_id}",
        "",
        export.description or "No description provided.",
        "",
        f"- Created: {export.created_at.isoformat()}",
        f"- Mode: {export.mode}",
        f"- Git commit: {export.app_git_commit or 'unknown'}",
        f"- Document set: {export.document_set.name}",
        f"- Case fingerprint: `{export.case_fingerprint}`",
        "",
        "## Runs",
        "",
        "| Status | Workflow | Label | Duration | Sources | Validation | Fingerprint |",
        "|---|---|---|---:|---:|---|---|",
    ]
    for run in export.runs:
        summary_lines.append(
            "| "
            f"{_status_icon(run.status)} {run.status} | "
            f"`{run.workflow_id}` | "
            f"{run.label or ''} | "
            f"{round(run.duration_ms, 2)} ms | "
            f"{len(run.sources)} | "
            f"{_validation_line(run)} | "
            f"`{run.output_fingerprint[:12]}` |"
        )
    summary_lines.append("")
    (bundle_dir / "summary.md").write_text("\n".join(summary_lines), encoding="utf-8")

    for index, run in enumerate(export.runs, start=1):
        run_path = bundle_dir / f"{index:02d}-{slug(run.workflow_id)}.md"
        lines = [
            f"# {run.label or run.title or run.workflow_id}",
            "",
            f"- Workflow: `{run.workflow_id}`",
            f"- Status: {run.status}",
            f"- Duration: {round(run.duration_ms, 2)} ms",
            f"- Prompt version: {run.prompt_version or 'not set'}",
            f"- Workflow version: {run.workflow_version or 'not set'}",
            f"- Config fingerprint: `{run.config_fingerprint}`",
            f"- Output fingerprint: `{run.output_fingerprint}`",
            "",
        ]
        if run.error:
            lines.extend(["## Error", "", run.error, ""])
        if run.validation.issues:
            lines.extend(["## Validation", ""])
            for issue in run.validation.issues:
                path = f" `{issue.path}`" if issue.path else ""
                lines.append(f"- **{issue.severity.upper()}** `{issue.code}`{path}: {issue.message}")
            lines.append("")
        if run.criterion_scores:
            lines.extend(["## Rubric", ""])
            for score in run.criterion_scores:
                lines.append(f"- [{score.score if score.score is not None else ' '}/{score.max_score}] **{score.label}** — weight {score.weight}")
            lines.append("")
        if run.sources:
            lines.extend(["## Sources", ""])
            for source in run.sources:
                lines.append(f"- `{source.file_id}` {source.name} ({source.folder_path or 'no folder'})")
            lines.append("")
        lines.extend(["## Output", "", run.output_markdown or "_No output._", ""])
        run_path.write_text("\n".join(lines), encoding="utf-8")

    return bundle_dir


def write_comparison_markdown(comparison: WorkflowEvalComparisonExport, output_dir: str | Path) -> Path:
    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    timestamp = comparison.created_at.strftime("%Y%m%dT%H%M%SZ")
    path = target / f"comparison__{slug(comparison.current_eval_id)}__vs__{slug(comparison.baseline_eval_id)}__{timestamp}.md"
    lines = [
        f"# Eval Comparison: {comparison.current_eval_id} vs {comparison.baseline_eval_id}",
        "",
        f"- Current: {comparison.current_path or 'not set'}",
        f"- Baseline: {comparison.baseline_path or 'not set'}",
        "",
        "## Summary",
        "",
    ]
    for key, value in comparison.summary.items():
        lines.append(f"- {key}: {value}")
    lines.extend([
        "",
        "## Runs",
        "",
        "| Workflow | Label | Status changed | Output changed | Similarity | Token Δ | Duration Δ | Validation Δ |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ])
    for row in comparison.runs:
        validation_delta = ""
        if row.validation_error_delta is not None or row.validation_warning_delta is not None:
            validation_delta = f"E {row.validation_error_delta or 0}, W {row.validation_warning_delta or 0}"
        lines.append(
            "| "
            f"`{row.workflow_id}` | "
            f"{row.label or ''} | "
            f"{row.status_changed} | "
            f"{row.output_changed} | "
            f"{row.output_similarity if row.output_similarity is not None else ''} | "
            f"{row.token_delta if row.token_delta is not None else ''} | "
            f"{round(row.duration_delta_ms, 2) if row.duration_delta_ms is not None else ''} | "
            f"{validation_delta} |"
        )
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
