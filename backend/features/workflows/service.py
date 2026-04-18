from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict

from fastapi import HTTPException

from core.business_metrics import (
    record_workflow_completed,
    record_workflow_duration,
    record_workflow_failed,
    record_workflow_started,
)

from .models import WorkflowManifest, WorkflowRun, WorkflowRunCreate, WorkflowRunList
from .registry import WORKFLOW_HANDLERS, WORKFLOW_INDEX

log = logging.getLogger("workflows.service")


_RUNS_BY_UID: dict[str, list[WorkflowRun]] = defaultdict(list)
_LOCK = threading.Lock()
_MAX_RUNS_PER_USER = 25



def list_workflows() -> list[WorkflowManifest]:
    return list(WORKFLOW_INDEX.values())



def list_runs(uid: str, limit: int = 10) -> WorkflowRunList:
    with _LOCK:
        items = list(_RUNS_BY_UID.get(uid, []))
    return WorkflowRunList(items=items[: max(1, min(limit, 50))])



def get_run(uid: str, run_id: str) -> WorkflowRun:
    with _LOCK:
        for run in _RUNS_BY_UID.get(uid, []):
            if run.id == run_id:
                return run
    raise HTTPException(status_code=404, detail="Workflow run not found")



def _validate_selection(payload: WorkflowRunCreate) -> WorkflowManifest:
    manifest = WORKFLOW_INDEX.get(payload.workflow_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="Unknown workflow")

    total_items = payload.selection.total_items
    requirements = manifest.selection

    if total_items < requirements.min_total_items:
        raise HTTPException(status_code=400, detail="Selection does not meet this workflow's minimum requirements")
    if requirements.max_total_items is not None and total_items > requirements.max_total_items:
        raise HTTPException(status_code=400, detail="Selection is too large for this workflow")
    if requirements.exact_file_count is not None and len(payload.selection.file_ids) != requirements.exact_file_count:
        raise HTTPException(status_code=400, detail="This workflow requires a specific number of files")
    if not requirements.allow_folders and payload.selection.folder_paths:
        raise HTTPException(status_code=400, detail="This workflow only accepts file selections")

    return manifest



def _persist_run(uid: str, run: WorkflowRun) -> None:
    with _LOCK:
        existing = [item for item in _RUNS_BY_UID.get(uid, []) if item.id != run.id]
        _RUNS_BY_UID[uid] = [run, *existing][:_MAX_RUNS_PER_USER]



def create_run(uid: str, payload: WorkflowRunCreate) -> WorkflowRun:
    manifest = _validate_selection(payload)
    handler = WORKFLOW_HANDLERS[payload.workflow_id]

    run = WorkflowRun(
        workflow_id=manifest.workflow_id,
        title=manifest.title,
        capability=manifest.capability,
        selection=payload.selection,
        inputs=payload.inputs,
    )
    _persist_run(uid, run)

    started_at = time.perf_counter()
    record_workflow_started(workflow_id=manifest.workflow_id, capability=manifest.capability)

    try:
        run.mark_running()
        _persist_run(uid, run)
        result = handler(run)
        run.mark_completed(result)
        _persist_run(uid, run)
        dur_ms = (time.perf_counter() - started_at) * 1000
        record_workflow_completed(workflow_id=manifest.workflow_id, capability=manifest.capability)
        record_workflow_duration(workflow_id=manifest.workflow_id, capability=manifest.capability, dur_ms=dur_ms, status="ok")
        log.info(
            "workflow_run_completed",
            workflow_id=manifest.workflow_id,
            capability=manifest.capability,
            run_id=run.id,
            status=run.status,
        )
        return run
    except HTTPException:
        raise
    except Exception as exc:
        run.mark_failed(str(exc) or "Workflow failed")
        _persist_run(uid, run)
        dur_ms = (time.perf_counter() - started_at) * 1000
        record_workflow_failed(workflow_id=manifest.workflow_id, capability=manifest.capability, stage="handler")
        record_workflow_duration(workflow_id=manifest.workflow_id, capability=manifest.capability, dur_ms=dur_ms, status="error")
        log.exception(
            "workflow_run_failed",
            workflow_id=manifest.workflow_id,
            capability=manifest.capability,
            run_id=run.id,
        )
        raise HTTPException(status_code=500, detail="Workflow execution failed") from exc
