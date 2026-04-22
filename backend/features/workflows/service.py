from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from core.background_jobs import submit as submit_background_job
from core.business_metrics import (
    record_workflow_completed,
    record_workflow_duration,
    record_workflow_failed,
    record_workflow_started,
)
from core.plan import sync_caps_and_plan
from core.rate_limit import add_file_processing_tokens, usage_snapshot
from core.user_store import USERS_COLLECTION
from features.files import service as files_service
from features.files.schemas import FileItem

from . import toolkit as workflow_toolkit
from .models import (
    WorkflowArtifact,
    WorkflowArtifactDownloadFormat,
    WorkflowArtifactSummary,
    WorkflowManifest,
    WorkflowRun,
    WorkflowRunCreate,
    WorkflowRunList,
    WorkflowSelectionIn,
    WorkflowSourceFile,
)
from .registry import WORKFLOW_HANDLERS, WORKFLOW_INDEX
from .exporting import ExportedArtifact, export_artifact, sanitize_export_markdown

log = logging.getLogger("workflows.service")

ROOT_COLLECTION = USERS_COLLECTION
_WORKFLOW_RUNS_SUBCOLLECTION = "workflow_runs"
_WORKFLOW_ARTIFACTS_SUBCOLLECTION = "workflow_artifacts"
_RUNS_BY_UID: dict[str, list[WorkflowRun]] = defaultdict(list)
_ARTIFACTS_BY_UID: dict[str, list[WorkflowArtifact]] = defaultdict(list)
_LOCK = threading.Lock()
_MAX_RUNS_PER_USER = 25
_MAX_SOURCE_FILES = 8
_MAX_FIRESTORE_DOC_BYTES = 850_000
_WORKFLOW_TARGETED_RAG_OVERHEAD_TOKENS = 192
_EXTRACTABLE_CONTENT_TYPES = {
    "application/json",
    "application/xml",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_EXTRACTABLE_SUFFIXES = (".txt", ".md", ".markdown", ".json", ".xml", ".csv", ".pdf", ".docx")


def _get_firestore_handles():
    try:
        from firebase_admin import firestore  # type: ignore
    except Exception:
        return None, None

    try:
        return firestore.client(), firestore
    except Exception:
        return None, None


def _workflow_runs_ref(db, uid: str):
    return db.collection(ROOT_COLLECTION).document(uid).collection(_WORKFLOW_RUNS_SUBCOLLECTION)


def _workflow_artifacts_ref(db, uid: str):
    return db.collection(ROOT_COLLECTION).document(uid).collection(_WORKFLOW_ARTIFACTS_SUBCOLLECTION)


def _artifact_summary(artifact: WorkflowArtifact) -> WorkflowArtifactSummary:
    return WorkflowArtifactSummary(**artifact.model_dump(exclude={"content", "metadata"}))


def _slugify_filename(value: str, fallback: str = "workflow-output") -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip().lower()).strip("-._")
    safe = re.sub(r"-{2,}", "-", safe)
    return safe or fallback


def _build_artifact_content(run: WorkflowRun) -> str:
    result = run.result
    if result is None:
        return ""

    preview = sanitize_export_markdown(str(result.preview_markdown or "").strip())
    if preview:
        return preview

    lines = [f"# {run.title}"]
    summary = str(result.summary or "").strip()
    if summary:
        lines.extend(["", summary])

    bullets = [str(item).strip() for item in result.bullets or [] if str(item).strip()]
    if bullets:
        lines.extend(["", "## Key points", *[f"- {item}" for item in bullets]])

    next_actions = [str(item).strip() for item in result.next_actions or [] if str(item).strip()]
    if next_actions:
        lines.extend(["", "## Next actions", *[f"- {item}" for item in next_actions]])

    return sanitize_export_markdown("\n".join(lines).strip())


def _build_artifact_from_run(run: WorkflowRun) -> WorkflowArtifact:
    if run.result is None:
        raise HTTPException(status_code=400, detail="This workflow run does not have an output to save yet.")

    content = _build_artifact_content(run)
    if not content:
        raise HTTPException(status_code=400, detail="This workflow output is empty and cannot be saved yet.")

    file_name = f"{_slugify_filename(run.title, fallback=run.workflow_id)}.md"
    artifact_id = (run.artifact.id if run.artifact else "") or f"wf_art_{uuid4().hex[:12]}"
    metadata = {
        "run_id": run.id,
        "selection": {
            "file_ids": list(run.selection.file_ids),
            "folder_paths": list(run.selection.folder_paths),
            "current_folder": run.selection.current_folder,
        },
        "source_summary": {
            "file_count": len(run.selection.file_ids),
            "folder_count": len(run.selection.folder_paths),
        },
    }
    if run.result.metadata:
        metadata["workflow_result_metadata"] = _sanitize_jsonish(run.result.metadata)

    now = datetime.now(UTC)
    created_at = run.artifact.created_at if run.artifact else now
    return WorkflowArtifact(
        id=artifact_id,
        run_id=run.id,
        workflow_id=run.workflow_id,
        title=run.title,
        capability=run.capability,
        file_name=file_name,
        byte_size=len(content.encode("utf-8")),
        content=content,
        metadata=metadata,
        created_at=created_at,
        updated_at=now,
    )


def export_artifact_for_download(artifact: WorkflowArtifact, *, target_format: WorkflowArtifactDownloadFormat = "markdown") -> ExportedArtifact:
    file_stem = _slugify_filename(artifact.title, fallback=artifact.workflow_id)
    return export_artifact(
        title=artifact.title,
        markdown=artifact.content,
        file_stem=file_stem,
        target_format=target_format,
    )


def get_artifact_download(uid: str, artifact_id: str, *, target_format: WorkflowArtifactDownloadFormat = "markdown") -> ExportedArtifact:
    artifact = get_artifact(uid, artifact_id)
    return export_artifact_for_download(artifact, target_format=target_format)


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif hasattr(value, "to_datetime"):
        dt = value.to_datetime()  # Firestore Timestamp
    else:
        raw = str(value or "").strip()
        if not raw:
            return datetime.now(UTC)
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)



def _to_iso_utc(value: Any) -> str:
    dt = _parse_datetime(value)
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")



def _sanitize_jsonish(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))
    except Exception:
        return value



def _trim_run_doc_for_firestore(payload: dict[str, Any]) -> dict[str, Any]:
    trimmed = _sanitize_jsonish(payload) or {}
    result = trimmed.get("result")
    if isinstance(result, dict):
        metadata = result.get("metadata")
        if isinstance(metadata, dict):
            source_files = metadata.get("source_files")
            if isinstance(source_files, list):
                slim_sources: list[dict[str, Any]] = []
                for item in source_files:
                    if not isinstance(item, dict):
                        continue
                    slim = dict(item)
                    if isinstance(slim.get("chunk_ids"), list) and slim["chunk_ids"]:
                        slim["chunk_ids"] = []
                        slim["chunk_ids_omitted"] = True
                    slim_sources.append(slim)
                metadata["source_files"] = slim_sources

    encoded = json.dumps(trimmed, ensure_ascii=False, default=str).encode("utf-8")
    if len(encoded) <= _MAX_FIRESTORE_DOC_BYTES:
        return trimmed

    if isinstance(result, dict):
        preview_markdown = str(result.get("preview_markdown") or "")
        if len(preview_markdown) > 120_000:
            result["preview_markdown"] = preview_markdown[:120_000].rstrip() + "\n\n...[truncated for Firestore storage]"

        metadata = result.get("metadata")
        if isinstance(metadata, dict):
            keep_keys = {
                "warnings",
                "selection",
                "usage_accounting",
                "llm_usage",
                "source_strategy",
                "selected_files",
                "used_source_files",
                "coverage_source_files",
                "retrieved_source_files",
                "chunk_artifacts_used",
                "chunks_seen",
                "skipped_source_files",
                "truncated_source_files",
                "max_source_files",
                "max_total_source_chars",
                "max_chars_per_file",
                "summary_profile",
                "summary_layers",
                "evidence_highlights",
                "suggested_actions",
            }
            preserved = {key: metadata.get(key) for key in keep_keys if key in metadata}
            preserved["firestore_trimmed"] = True
            result["metadata"] = preserved

    return trimmed



def _trim_artifact_doc_for_firestore(payload: dict[str, Any]) -> dict[str, Any]:
    trimmed = _sanitize_jsonish(payload) or {}
    encoded = json.dumps(trimmed, ensure_ascii=False, default=str).encode("utf-8")
    if len(encoded) <= _MAX_FIRESTORE_DOC_BYTES:
        return trimmed

    content = str(trimmed.get("content") or "")
    if len(content) > 200_000:
        trimmed["content"] = content[:200_000].rstrip() + "\n\n...[truncated for Firestore storage]"
        trimmed["byte_size"] = len(str(trimmed.get("content") or "").encode("utf-8"))

    metadata = trimmed.get("metadata")
    if isinstance(metadata, dict):
        metadata = dict(metadata)
        metadata["firestore_trimmed"] = True
        trimmed["metadata"] = metadata

    return trimmed


def _artifact_to_doc(artifact: WorkflowArtifact) -> dict[str, Any]:
    payload = artifact.model_dump(mode="json")
    payload["created_at"] = _to_iso_utc(artifact.created_at)
    payload["updated_at"] = _to_iso_utc(artifact.updated_at)
    payload["created_at_ts"] = _parse_datetime(artifact.created_at)
    payload["updated_at_ts"] = _parse_datetime(artifact.updated_at)
    return _trim_artifact_doc_for_firestore(payload)


def _artifact_from_doc(doc_id: str, data: dict[str, Any]) -> WorkflowArtifact:
    payload = dict(data or {})
    payload["id"] = str(payload.get("id") or doc_id)
    payload["created_at"] = _to_iso_utc(payload.get("created_at") or payload.get("created_at_ts"))
    payload["updated_at"] = _to_iso_utc(payload.get("updated_at") or payload.get("updated_at_ts"))
    payload.pop("created_at_ts", None)
    payload.pop("updated_at_ts", None)
    return WorkflowArtifact(**payload)


def _run_to_doc(run: WorkflowRun) -> dict[str, Any]:
    payload = run.model_dump(mode="json")
    payload["created_at"] = _to_iso_utc(run.created_at)
    payload["updated_at"] = _to_iso_utc(run.updated_at)
    payload["created_at_ts"] = _parse_datetime(run.created_at)
    payload["updated_at_ts"] = _parse_datetime(run.updated_at)
    return _trim_run_doc_for_firestore(payload)



def _run_from_doc(doc_id: str, data: dict[str, Any]) -> WorkflowRun:
    payload = dict(data or {})
    payload["id"] = str(payload.get("id") or doc_id)
    payload["created_at"] = _to_iso_utc(payload.get("created_at") or payload.get("created_at_ts"))
    payload["updated_at"] = _to_iso_utc(payload.get("updated_at") or payload.get("updated_at_ts"))
    payload.pop("created_at_ts", None)
    payload.pop("updated_at_ts", None)
    return WorkflowRun(**payload)



def _cache_run(uid: str, run: WorkflowRun) -> None:
    with _LOCK:
        existing = [item for item in _RUNS_BY_UID.get(uid, []) if item.id != run.id]
        _RUNS_BY_UID[uid] = [run, *existing][:_MAX_RUNS_PER_USER]



def _cached_runs(uid: str) -> list[WorkflowRun]:
    with _LOCK:
        return list(_RUNS_BY_UID.get(uid, []))


def _cache_artifact(uid: str, artifact: WorkflowArtifact) -> None:
    with _LOCK:
        existing = [item for item in _ARTIFACTS_BY_UID.get(uid, []) if item.id != artifact.id]
        _ARTIFACTS_BY_UID[uid] = [artifact, *existing][:_MAX_RUNS_PER_USER]


def _cached_artifacts(uid: str) -> list[WorkflowArtifact]:
    with _LOCK:
        return list(_ARTIFACTS_BY_UID.get(uid, []))


def _persist_artifact(uid: str, artifact: WorkflowArtifact) -> None:
    _cache_artifact(uid, artifact)

    db, _fs = _get_firestore_handles()
    if db is None:
        return

    try:
        _workflow_artifacts_ref(db, uid).document(artifact.id).set(_artifact_to_doc(artifact), merge=True)
    except Exception:
        log.warning("workflow_artifact_persist_firestore_failed", uid=uid, artifact_id=artifact.id, exc_info=True)


def get_artifact(uid: str, artifact_id: str) -> WorkflowArtifact:
    db, _fs = _get_firestore_handles()
    if db is not None:
        try:
            snap = _workflow_artifacts_ref(db, uid).document(artifact_id).get()
            if getattr(snap, "exists", False):
                return _artifact_from_doc(artifact_id, snap.to_dict() or {})
        except Exception:
            log.warning("workflow_artifact_get_firestore_failed", uid=uid, artifact_id=artifact_id, exc_info=True)

    for artifact in _cached_artifacts(uid):
        if artifact.id == artifact_id:
            return artifact
    raise HTTPException(status_code=404, detail="Workflow artifact not found")


def _upsert_artifact_for_run(uid: str, run: WorkflowRun) -> WorkflowArtifact:
    artifact = _build_artifact_from_run(run)
    _persist_artifact(uid, artifact)
    run.artifact = _artifact_summary(artifact)
    return artifact


def list_workflows() -> list[WorkflowManifest]:
    return list(WORKFLOW_INDEX.values())



def list_runs(uid: str, limit: int = 10) -> WorkflowRunList:
    limit = max(1, min(limit, 50))
    db, fs = _get_firestore_handles()
    if db is not None and fs is not None:
        rows: list[WorkflowRun] = []
        try:
            q = _workflow_runs_ref(db, uid).order_by("updated_at_ts", direction=fs.Query.DESCENDING).limit(int(limit))
            for doc in q.stream():
                rows.append(_run_from_doc(doc.id, doc.to_dict() or {}))
        except Exception:
            log.debug("workflow_runs_list_firestore_fallback", uid=uid, exc_info=True)
            try:
                q = _workflow_runs_ref(db, uid).limit(int(limit))
                rows = [_run_from_doc(doc.id, doc.to_dict() or {}) for doc in q.stream()]
                rows.sort(key=lambda item: item.updated_at, reverse=True)
            except Exception:
                log.warning("workflow_runs_list_firestore_failed", uid=uid, exc_info=True)
                rows = []
        if rows:
            return WorkflowRunList(items=rows[:limit])

    items = _cached_runs(uid)
    return WorkflowRunList(items=items[:limit])



def get_run(uid: str, run_id: str) -> WorkflowRun:
    db, _fs = _get_firestore_handles()
    if db is not None:
        try:
            snap = _workflow_runs_ref(db, uid).document(run_id).get()
            if getattr(snap, "exists", False):
                return _run_from_doc(run_id, snap.to_dict() or {})
        except Exception:
            log.warning("workflow_run_get_firestore_failed", uid=uid, run_id=run_id, exc_info=True)

    for run in _cached_runs(uid):
        if run.id == run_id:
            return run
    raise HTTPException(status_code=404, detail="Workflow run not found")



def save_artifact_for_run(uid: str, run_id: str) -> WorkflowArtifact:
    run = get_run(uid, run_id)
    if run.status != "completed" or run.result is None:
        raise HTTPException(status_code=400, detail="Only completed workflow runs can be saved as artifacts.")

    existing_id = run.artifact.id if run.artifact else ""
    if existing_id:
        try:
            artifact = get_artifact(uid, existing_id)
            run.artifact = _artifact_summary(artifact)
            _persist_run(uid, run)
            return artifact
        except HTTPException:
            run.artifact = None

    artifact = _upsert_artifact_for_run(uid, run)
    _persist_run(uid, run)
    return artifact


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
    _cache_run(uid, run)

    db, _fs = _get_firestore_handles()
    if db is None:
        return

    try:
        _workflow_runs_ref(db, uid).document(run.id).set(_run_to_doc(run), merge=True)
    except Exception:
        log.warning("workflow_run_persist_firestore_failed", uid=uid, run_id=run.id, exc_info=True)



def _normalize_folder_path(path: str | None) -> str:
    return str(path or "").strip().strip("/")



def _is_within_folder(file_item: FileItem, folder_path: str) -> bool:
    target = _normalize_folder_path(folder_path)
    current = _normalize_folder_path(file_item.folder_path)
    return bool(target) and (current == target or current.startswith(target + "/"))



def _remaining_file_processing_tokens(snap: dict[str, object]) -> int:
    cap = int(snap.get("cap_file_processing_tokens") or snap.get("cap_upload_tokens") or 0)
    used = int(snap.get("file_processing_tokens_used") or snap.get("upload_tokens_used") or 0)
    return max(0, cap - used)



def _workflow_usage_breakdown(run: WorkflowRun, source_stats: dict[str, object]) -> tuple[int, dict[str, int], dict[str, object]]:
    metadata = dict((run.result.metadata if run.result else {}) or {})
    llm_usage = metadata.get("llm_usage") if isinstance(metadata.get("llm_usage"), dict) else {}
    prompt_tokens = max(0, int(llm_usage.get("prompt_tokens") or 0))
    completion_tokens = max(0, int(llm_usage.get("completion_tokens") or 0))
    total_tokens = max(0, int(llm_usage.get("total_tokens") or (prompt_tokens + completion_tokens)))

    source_strategy = str(source_stats.get("source_strategy") or "coverage")
    rag_overhead_tokens = _WORKFLOW_TARGETED_RAG_OVERHEAD_TOKENS if "targeted_rag" in source_strategy else 0

    billed_total = total_tokens + rag_overhead_tokens
    breakdown = {
        "workflow_input_tokens": prompt_tokens,
        "workflow_output_tokens": completion_tokens,
        "workflow_rag_overhead_tokens": rag_overhead_tokens,
    }
    details = {
        "billed_total_tokens": billed_total,
        "source_strategy": source_strategy,
        "rag_overhead_tokens": rag_overhead_tokens,
        "llm_prompt_tokens": prompt_tokens,
        "llm_completion_tokens": completion_tokens,
        "llm_total_tokens": total_tokens,
    }
    return billed_total, breakdown, details



def _attach_usage_details(run: WorkflowRun, *, usage_details: dict[str, object], used: int | None = None, cap: int | None = None) -> None:
    if run.result is None:
        return
    metadata = dict(run.result.metadata or {})
    payload = dict(usage_details or {})
    if used is not None:
        payload["period_used_tokens"] = int(used)
    if cap is not None:
        payload["period_cap_tokens"] = int(cap)
        payload["period_remaining_tokens"] = max(0, int(cap) - int(used or 0))
    metadata["usage_accounting"] = payload
    run.result.metadata = metadata



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
    # Keep workflow warnings in metadata only. They are useful for internal review
    # and telemetry, but should never be surfaced in customer-facing output.
    return sanitize_export_markdown(preview_markdown)



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
        try:
            asyncio.run(sync_caps_and_plan(uid))
            snap = asyncio.run(usage_snapshot(uid))
            if _remaining_file_processing_tokens(snap) <= 0:
                raise HTTPException(status_code=402, detail="File processing usage limit reached for this billing period.")
        except HTTPException:
            raise
        except Exception:
            log.debug("workflow_limits_prefetch_failed", uid=uid, workflow_id=manifest.workflow_id, exc_info=True)

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
        billed_total, breakdown, usage_details = _workflow_usage_breakdown(run, source_stats)
        if billed_total > 0:
            ok, used, cap = asyncio.run(
                add_file_processing_tokens(
                    uid,
                    billed_total,
                    category="workflow",
                    breakdown=breakdown,
                )
            )
            if not ok:
                raise HTTPException(status_code=402, detail="File processing usage limit reached for this billing period.")
            _attach_usage_details(run, usage_details=usage_details, used=used, cap=cap)
        else:
            _attach_usage_details(run, usage_details=usage_details)

        try:
            _upsert_artifact_for_run(uid, run)
        except Exception:
            log.warning("workflow_artifact_auto_save_failed", uid=uid, run_id=run.id, exc_info=True)

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
            billed_total_tokens=billed_total,
            source_strategy=usage_details.get("source_strategy"),
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

    return get_run(uid, run.id)
