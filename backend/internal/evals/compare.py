from __future__ import annotations

import difflib
import json
from pathlib import Path
from typing import Any

from .schemas import WorkflowEvalComparisonExport, WorkflowEvalComparisonRun, WorkflowEvalExport, WorkflowEvalRunRecord


def load_eval_export(path: str | Path) -> WorkflowEvalExport:
    with Path(path).open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return WorkflowEvalExport.model_validate(raw)


def _run_map(export: WorkflowEvalExport) -> dict[str, WorkflowEvalRunRecord]:
    mapped: dict[str, WorkflowEvalRunRecord] = {}
    for index, run in enumerate(export.runs):
        key = run.run_key or f"{run.workflow_id}::{index}"
        mapped[key] = run
    return mapped


def _issue_count(run: WorkflowEvalRunRecord | None, severity: str) -> int:
    if not run:
        return 0
    return sum(1 for issue in run.validation.issues if issue.severity == severity)


def _usage_token_total(run: WorkflowEvalRunRecord | None) -> int | None:
    if not run:
        return None
    candidates = [
        run.usage.get("total_tokens"),
        run.usage.get("billed_total_tokens"),
        run.usage.get("billed_total"),
        run.usage.get("total"),
    ]
    for value in candidates:
        try:
            if value is not None:
                return int(value)
        except Exception:
            continue
    breakdown = run.usage.get("breakdown")
    if isinstance(breakdown, dict):
        total = 0
        found = False
        for value in breakdown.values():
            try:
                total += int(value)
                found = True
            except Exception:
                continue
        if found:
            return total
    return None


def _similarity(current: str, baseline: str) -> float | None:
    if not current and not baseline:
        return 1.0
    if not current or not baseline:
        return 0.0
    return round(difflib.SequenceMatcher(a=current, b=baseline).ratio(), 4)


def _delta(current: float | int | None, baseline: float | int | None) -> float | int | None:
    if current is None or baseline is None:
        return None
    return current - baseline


def compare_eval_exports(
    current: WorkflowEvalExport,
    baseline: WorkflowEvalExport,
    *,
    current_path: str | None = None,
    baseline_path: str | None = None,
) -> WorkflowEvalComparisonExport:
    current_runs = _run_map(current)
    baseline_runs = _run_map(baseline)
    keys = sorted(set(current_runs) | set(baseline_runs))
    rows: list[WorkflowEvalComparisonRun] = []

    for key in keys:
        current_run = current_runs.get(key)
        baseline_run = baseline_runs.get(key)
        representative = current_run or baseline_run
        notes: list[str] = []
        if current_run is None:
            notes.append("Run exists in baseline but is missing from current export.")
        if baseline_run is None:
            notes.append("Run is new in current export.")

        current_tokens = _usage_token_total(current_run)
        baseline_tokens = _usage_token_total(baseline_run)
        status_changed = bool(current_run and baseline_run and current_run.status != baseline_run.status)
        output_changed = bool(current_run and baseline_run and current_run.output_fingerprint != baseline_run.output_fingerprint)
        if status_changed:
            notes.append("Status changed.")
        if output_changed:
            notes.append("Output fingerprint changed.")

        rows.append(
            WorkflowEvalComparisonRun(
                run_key=key,
                workflow_id=representative.workflow_id if representative else key,
                label=representative.label if representative else None,
                current_status=current_run.status if current_run else None,
                baseline_status=baseline_run.status if baseline_run else None,
                status_changed=status_changed,
                output_changed=output_changed,
                output_similarity=_similarity(current_run.output_markdown, baseline_run.output_markdown) if current_run and baseline_run else None,
                duration_delta_ms=_delta(current_run.duration_ms if current_run else None, baseline_run.duration_ms if baseline_run else None),
                source_count_delta=_delta(len(current_run.sources) if current_run else None, len(baseline_run.sources) if baseline_run else None),
                validation_error_delta=_delta(_issue_count(current_run, "error"), _issue_count(baseline_run, "error")),
                validation_warning_delta=_delta(_issue_count(current_run, "warning"), _issue_count(baseline_run, "warning")),
                token_delta=_delta(current_tokens, baseline_tokens),
                notes=notes,
            )
        )

    summary: dict[str, Any] = {
        "run_count_current": len(current.runs),
        "run_count_baseline": len(baseline.runs),
        "compared_runs": len(rows),
        "status_changes": sum(1 for row in rows if row.status_changed),
        "output_changes": sum(1 for row in rows if row.output_changed),
        "new_runs": sum(1 for row in rows if row.baseline_status is None),
        "missing_runs": sum(1 for row in rows if row.current_status is None),
        "current_validation_errors": sum(_issue_count(run, "error") for run in current.runs),
        "current_validation_warnings": sum(_issue_count(run, "warning") for run in current.runs),
    }
    return WorkflowEvalComparisonExport(
        current_eval_id=current.eval_id,
        baseline_eval_id=baseline.eval_id,
        current_path=current_path,
        baseline_path=baseline_path,
        summary=summary,
        runs=rows,
    )


def write_comparison_export(comparison: WorkflowEvalComparisonExport, output_path: str | Path) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(comparison.model_dump(mode="json"), handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return path
