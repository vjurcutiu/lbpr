from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
from collections import defaultdict

from fastapi import HTTPException

from core.background_jobs import submit as submit_background_job
from core.business_metrics import (
    record_workflow_completed,
    record_workflow_duration,
    record_workflow_failed,
    record_workflow_started,
)
from features.files import service as files_service
from features.files.schemas import FileItem

from .models import WorkflowManifest, WorkflowRun, WorkflowRunCreate, WorkflowRunList, WorkflowSelectionIn, WorkflowSourceFile
from . import toolkit as workflow_toolkit
from .registry import WORKFLOW_HANDLERS, WORKFLOW_INDEX

log = logging.getLogger("workflows.service")

_RUNS_BY_UID: dict[str, list[WorkflowRun]] = defaultdict(list)
_LOCK = threading.Lock()
_MAX_RUNS_PER_USER = 25
_MAX_SOURCE_FILES = 8
_EXTRACTABLE_CONTENT_TYPES = {
    "application/json",
    "application/xml",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_EXTRACTABLE_SUFFIXES = (".txt", ".md", ".markdown", ".json", ".xml", ".csv", ".pdf", ".docx")


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


def _normalize_folder_path(path: str | None) -> str:
    return str(path or "").strip().strip("/")


def _is_within_folder(file_item: FileItem, folder_path: str) -> bool:
    target = _normalize_folder_path(folder_path)
    current = _normalize_folder_path(file_item.folder_path)
    return bool(target) and (current == target or current.startswith(target + "/"))


def _dedupe_files(items: list[FileItem]) -> list[FileItem]:
    seen: set[str] = set()
    out: list[FileItem] = []
    for item in items:
        if item.id in seen:
            continue
        seen.add(item.id)
        out.append(item)
    return out


def _resolve_selected_files(uid: str, selection: WorkflowSelectionIn) -> list[FileItem]:
    all_files = files_service.list_files(uid)
    by_id = {item.id: item for item in all_files}
    selected: list[FileItem] = []

    for file_id in selection.file_ids:
        item = by_id.get(file_id)
        if item is not None:
            selected.append(item)

    for folder_path in selection.folder_paths:
        selected.extend(item for item in all_files if _is_within_folder(item, folder_path))

    selected = _dedupe_files(selected)
    if not selected:
        raise HTTPException(status_code=400, detail="No files were found for the current workflow selection")
    return selected


def _looks_extractable(file_item: FileItem) -> bool:
    content_type = (file_item.content_type or "").lower()
    name = (file_item.original_name or file_item.name or file_item.id).lower()
    if content_type.startswith("text/"):
        return True
    if content_type in _EXTRACTABLE_CONTENT_TYPES:
        return True
    return name.endswith(_EXTRACTABLE_SUFFIXES)


def _base_name(file_item: FileItem) -> str:
    raw = file_item.original_name or file_item.name or file_item.id.rsplit("/", 1)[-1]
    return raw.rsplit("/", 1)[-1]


def _normalize_excerpt(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _extract_text_for_file(uid: str, file_item: FileItem) -> str | None:
    data, content_type = files_service.get_file_bytes(uid, file_item.id)
    name = _base_name(file_item)
    text = asyncio.run(
        files_service._extract_text(  # type: ignore[attr-defined]
            uid,
            f"workflow:{file_item.id}",
            name,
            content_type or file_item.content_type,
            data,
            charge_usage=False,
        )
    )
    normalized = _normalize_excerpt(text or "")
    return normalized or None


def _load_source_documents(
    uid: str,
    selection: WorkflowSelectionIn,
    *,
    workflow_id: str = "",
    inputs: dict[str, object] | None = None,
) -> tuple[list[WorkflowSourceFile], dict[str, object]]:
    selected_files = _resolve_selected_files(uid, selection)
    limited_files = selected_files[:_MAX_SOURCE_FILES]
    warnings: list[str] = []
    if len(selected_files) > _MAX_SOURCE_FILES:
        warnings.append(f"Used the first {_MAX_SOURCE_FILES} files from the selection to keep the workflow responsive.")

    usable_files = [item for item in limited_files if _looks_extractable(item)]
    skipped_files = [_base_name(item) for item in limited_files if not _looks_extractable(item)]
    focus = str((inputs or {}).get("focus") or "").strip()

    documents, toolkit_stats = workflow_toolkit.build_sources(
        uid,
        usable_files,
        workflow_id=workflow_id,
        focus=focus,
    )
    if not documents:
        raise HTTPException(
            status_code=400,
            detail="No extractable text was found in the selected files. Try text, searchable PDF, or DOCX files.",
        )

    skipped_source_files = skipped_files + [str(item) for item in toolkit_stats.get("skipped_source_files") or [] if str(item).strip()]
    if skipped_source_files:
        warnings.append(f"Skipped {len(skipped_source_files)} file(s) that could not provide usable text.")
    warnings.extend(str(item) for item in toolkit_stats.get("warnings") or [] if str(item).strip())

    stats: dict[str, object] = {
        "selected_files": len(selected_files),
        "used_source_files": len(documents),
        "warnings": warnings,
        "skipped_source_files": skipped_source_files,
        "truncated_source_files": [doc.name for doc in documents if doc.truncated],
        "max_source_files": _MAX_SOURCE_FILES,
        "max_total_source_chars": None,
        "max_chars_per_file": None,
    }
    for key, value in toolkit_stats.items():
        if key in {"warnings", "skipped_source_files"}:
            continue
        stats[key] = value
    return documents, stats


def _append_preview_warnings(preview_markdown: str, warnings: list[str]) -> str:
    if not warnings:
        return preview_markdown
    suffix = "\n\n## Workflow notes\n" + "\n".join(f"- {item}" for item in warnings)
    return (preview_markdown or "").strip() + suffix


def _augment_result_metadata(run: WorkflowRun, docs: list[WorkflowSourceFile], stats: dict[str, object]) -> None:
    if run.result is None:
        return
    metadata = dict(run.result.metadata or {})
    metadata.setdefault(
        "source_files",
        [
            {
                "file_id": doc.file_id,
                "name": doc.name,
                "folder_path": doc.folder_path,
                "content_type": doc.content_type,
                "excerpt_chars": doc.excerpt_chars,
                "full_text_chars": doc.full_text_chars,
                "truncated": doc.truncated,
                "source_kind": doc.source_kind,
                "chunk_count": doc.chunk_count,
                "chunk_ids": list(doc.chunk_ids),
            }
            for doc in docs
        ],
    )
    metadata.setdefault(
        "selection",
        {
            "file_ids": list(run.selection.file_ids),
            "folder_paths": list(run.selection.folder_paths),
            "current_folder": run.selection.current_folder,
        },
    )
    metadata.update(stats)
    warnings = [str(item) for item in metadata.get("warnings") or [] if str(item).strip()]
    run.result.metadata = metadata
    run.result.preview_markdown = _append_preview_warnings(run.result.preview_markdown, warnings)


def _execute_run(uid: str, run_id: str) -> None:
    run = get_run(uid, run_id)
    manifest = WORKFLOW_INDEX.get(run.workflow_id)
    if manifest is None:
        run.mark_failed("Unknown workflow")
        _persist_run(uid, run)
        return

    handler = WORKFLOW_HANDLERS[run.workflow_id]
    started_at = time.perf_counter()
    record_workflow_started(workflow_id=manifest.workflow_id, capability=manifest.capability)

    try:
        run.mark_running()
        _persist_run(uid, run)
        source_documents, source_stats = _load_source_documents(
            uid,
            run.selection,
            workflow_id=manifest.workflow_id,
            inputs=run.inputs,
        )
        if manifest.selection.exact_file_count is not None and len(source_documents) < manifest.selection.exact_file_count:
            raise HTTPException(status_code=400, detail="Could not extract usable text from every selected file for this workflow")

        result = handler(run, source_documents)
        run.mark_completed(result)
        _augment_result_metadata(run, source_documents, source_stats)
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
    except HTTPException as exc:
        detail = getattr(exc, "detail", None) or str(exc) or "Workflow failed"
        run.mark_failed(str(detail))
        _persist_run(uid, run)
        dur_ms = (time.perf_counter() - started_at) * 1000
        record_workflow_failed(workflow_id=manifest.workflow_id, capability=manifest.capability, stage="http_exception")
        record_workflow_duration(workflow_id=manifest.workflow_id, capability=manifest.capability, dur_ms=dur_ms, status="error")
        log.warning(
            "workflow_run_failed_http",
            workflow_id=manifest.workflow_id,
            capability=manifest.capability,
            run_id=run.id,
            detail=detail,
        )
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


def create_run(uid: str, payload: WorkflowRunCreate) -> WorkflowRun:
    manifest = _validate_selection(payload)

    run = WorkflowRun(
        workflow_id=manifest.workflow_id,
        title=manifest.title,
        capability=manifest.capability,
        selection=payload.selection,
        inputs=payload.inputs,
    )
    _persist_run(uid, run)

    try:
        submit_background_job(f"workflow:{run.id}", _execute_run, uid, run.id)
    except Exception as exc:
        run.mark_failed("Failed to queue workflow")
        _persist_run(uid, run)
        log.exception("workflow_run_queue_failed", workflow_id=manifest.workflow_id, capability=manifest.capability, run_id=run.id)
        raise HTTPException(status_code=500, detail="Failed to queue workflow") from exc

    return run
