from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import Counter, defaultdict
from typing import Any

from core.pii import detokenize_text, tokenize_text
from features.files import service as files_service
from features.files.schemas import FileItem
from features.rag.chunker import simple_word_chunker
from features.rag.orchestrator import query_request
from features.rag.schemas import QueryRequest

from .domain_packs import get_domain_workflow_spec
from .models import WorkflowSourceFile

log = logging.getLogger("workflows.toolkit")

_ARTIFACT_VERSION = 1
_ARTIFACT_NAME = "workflow_chunks.v1.json"
_MAX_ARTIFACT_BYTES = 800_000
_MAX_GROUP_CHARS = 2400
_MAX_COVERAGE_CHARS_PER_FILE = 8000
_MAX_RETRIEVED_SOURCES = 4
_MAX_TOTAL_SOURCES = 12
_RETRIEVAL_K = 8

_BROAD_FOCUS_WORDS = {
    "summary",
    "summarize",
    "overview",
    "general",
    "all",
    "everything",
    "complete",
    "full",
    "whole",
    "entire",
    "broad",
}
_STOPWORDS = {
    "about", "after", "again", "against", "also", "between", "could", "first", "from", "have", "into",
    "just", "more", "most", "other", "over", "same", "should", "that", "their", "there", "these", "this",
    "those", "through", "using", "very", "what", "when", "where", "which", "with", "would", "your", "than",
}
_DEFAULT_QUERIES: dict[str, str] = {
    "summarize_documents": "key findings decisions risks open questions summary",
    "compare_documents": "changes differences missing content risks deadlines",
    "extract_information": "dates names totals obligations deadlines contacts",
    "draft_from_sources": "facts requirements audience tone decisions constraints",
    "generate_report": "key findings risks recommendations decisions next steps",
    "create_action_plan": "actions next steps owners deadlines priorities blockers deliverables",
}


def _normalize_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def chunk_artifact_path(file_id: str) -> str:
    base = str(file_id or "").rsplit("/", 1)[0]
    return f"{base}/{_ARTIFACT_NAME}" if base else _ARTIFACT_NAME


def delete_chunk_artifact(uid: str, file_id: str) -> None:
    try:
        files_service._assert_user_owns(uid, file_id)  # type: ignore[attr-defined]
        blob = files_service._bucket().blob(chunk_artifact_path(file_id))  # type: ignore[attr-defined]
        if blob.exists():
            blob.delete()
    except Exception:
        log.debug("workflow_chunk_artifact_delete_failed", uid=uid, file_id=file_id, exc_info=True)


def persist_chunk_artifact(
    uid: str,
    *,
    file_id: str,
    text: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
) -> dict[str, Any] | None:
    normalized = _normalize_text(text)
    if not normalized:
        return None
    chunks = simple_word_chunker(normalized)
    if not chunks:
        return None
    payload = {
        "version": _ARTIFACT_VERSION,
        "file_id": file_id,
        "name": name,
        "folder_path": folder_path or None,
        "content_type": content_type or None,
        "full_text_chars": len(normalized),
        "chunks": [
            {
                "chunk_id": chunk.get("chunk_id") or f"ch_{idx}",
                "text": chunk.get("text") or "",
                "span": chunk.get("span") or {},
            }
            for idx, chunk in enumerate(chunks)
            if str(chunk.get("text") or "").strip()
        ],
    }
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(encoded) > _MAX_ARTIFACT_BYTES:
        log.info("workflow_chunk_artifact_skip_large", uid=uid, file_id=file_id, size=len(encoded))
        return payload
    try:
        files_service._assert_user_owns(uid, file_id)  # type: ignore[attr-defined]
        blob = files_service._bucket().blob(chunk_artifact_path(file_id))  # type: ignore[attr-defined]
        blob.upload_from_string(encoded, content_type="application/json")
    except Exception:
        log.warning("workflow_chunk_artifact_store_failed", uid=uid, file_id=file_id, exc_info=True)
    return payload


def _load_chunk_artifact(uid: str, file_item: FileItem) -> dict[str, Any] | None:
    try:
        files_service._assert_user_owns(uid, file_item.id)  # type: ignore[attr-defined]
        blob = files_service._bucket().blob(chunk_artifact_path(file_item.id))  # type: ignore[attr-defined]
        if not blob.exists():
            return None
        raw = blob.download_as_bytes()
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        return payload
    except Exception:
        log.debug("workflow_chunk_artifact_load_failed", uid=uid, file_id=file_item.id, exc_info=True)
        return None


def _extract_text_on_demand(uid: str, file_item: FileItem) -> str | None:
    data, content_type = files_service.get_file_bytes(uid, file_item.id)
    text = asyncio.run(
        files_service._extract_text(  # type: ignore[attr-defined]
            uid,
            f"workflow:{file_item.id}",
            file_item.original_name or file_item.name or file_item.id,
            content_type or file_item.content_type,
            data,
            charge_usage=False,
        )
    )
    normalized = _normalize_text(text or "")
    if not normalized:
        return None
    persist_chunk_artifact(
        uid,
        file_id=file_item.id,
        text=normalized,
        name=file_item.original_name or file_item.name or file_item.id,
        folder_path=file_item.folder_path,
        content_type=content_type or file_item.content_type,
    )
    return normalized


def _materialize_chunks(uid: str, file_item: FileItem) -> dict[str, Any] | None:
    payload = _load_chunk_artifact(uid, file_item)
    if payload and isinstance(payload.get("chunks"), list):
        payload.setdefault("name", file_item.original_name or file_item.name)
        payload.setdefault("folder_path", file_item.folder_path)
        payload.setdefault("content_type", file_item.content_type)
        payload.setdefault("file_id", file_item.id)
        payload.setdefault("full_text_chars", sum(len(str(chunk.get("text") or "")) for chunk in payload.get("chunks") or []))
        return payload

    text = _extract_text_on_demand(uid, file_item)
    if not text:
        return None
    return persist_chunk_artifact(
        uid,
        file_id=file_item.id,
        text=text,
        name=file_item.original_name or file_item.name or file_item.id,
        folder_path=file_item.folder_path,
        content_type=file_item.content_type,
    )


def _group_chunks(chunks: list[dict[str, Any]], *, max_chars: int = _MAX_GROUP_CHARS) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0
    for chunk in chunks:
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue
        if current and current_chars + len(text) > max_chars:
            groups.append(current)
            current = []
            current_chars = 0
        current.append(chunk)
        current_chars += len(text)
    if current:
        groups.append(current)
    return groups


def _split_sentences(text: str) -> list[str]:
    pieces = re.split(r"(?<=[.!?])\s+|\n+", text or "")
    return [re.sub(r"\s+", " ", piece).strip(" -•\t") for piece in pieces if piece and piece.strip()]


def _focus_terms(focus: str) -> list[str]:
    out: list[str] = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", focus or ""):
        lowered = token.lower()
        if lowered in _STOPWORDS:
            continue
        out.append(lowered)
    return out[:12]


def _score_sentence(sentence: str, focus_terms: list[str]) -> float:
    lowered = sentence.lower()
    score = 0.0
    if len(sentence) >= 30:
        score += 1.0
    if any(char.isdigit() for char in sentence):
        score += 0.5
    for term in focus_terms:
        if term in lowered:
            score += 1.5
    if ":" in sentence:
        score += 0.25
    return score


def _condense_group(text: str, *, focus: str, max_chars: int = 360) -> str:
    sentences = _split_sentences(text)
    if not sentences:
        clean = re.sub(r"\s+", " ", text or "").strip()
        return clean[:max_chars].rstrip(" ,.;:-")
    focus_terms = _focus_terms(focus)
    ranked = sorted(
        enumerate(sentences),
        key=lambda item: (_score_sentence(item[1], focus_terms), -item[0]),
        reverse=True,
    )
    keep_indices = sorted(idx for idx, _ in ranked[: max(1, min(3, len(sentences)))])
    selected = []
    total = 0
    for idx in keep_indices:
        sentence = sentences[idx]
        if total and total + len(sentence) + 1 > max_chars:
            break
        selected.append(sentence)
        total += len(sentence) + 1
    if not selected:
        selected.append(sentences[0][:max_chars])
    return " ".join(selected).strip()


def _merge_group_summaries(groups: list[str], *, max_chars: int = _MAX_COVERAGE_CHARS_PER_FILE) -> str:
    if not groups:
        return ""
    lines: list[str] = []
    total = 0
    for idx, group in enumerate(groups, start=1):
        clean = str(group or "").strip()
        if not clean:
            continue
        line = f"Section {idx}: {clean}"
        if total and total + len(line) + 1 > max_chars:
            break
        lines.append(line)
        total += len(line) + 1
    return "\n".join(lines).strip()


def _default_query(workflow_id: str, focus: str) -> str:
    clean_focus = str(focus or "").strip()
    if clean_focus:
        return clean_focus
    spec = get_domain_workflow_spec(workflow_id)
    if spec is not None:
        return spec.default_focus
    return _DEFAULT_QUERIES.get(workflow_id, "key facts decisions risks next steps")


def _looks_broad_focus(focus: str) -> bool:
    clean = str(focus or "").strip().lower()
    if not clean:
        return True
    return any(word in clean.split() for word in _BROAD_FOCUS_WORDS)


def _detokenize_metadata(uid: str, meta: dict[str, Any]) -> dict[str, Any]:
    out = dict(meta or {})
    for key in ("title", "filename", "display_name", "folder_path"):
        if isinstance(out.get(key), str):
            out[key] = detokenize_text(uid, out[key])
    return out


def _dataset_for_file(uid: str, file_item: FileItem) -> str:
    try:
        meta = files_service._get_blob_metadata(uid, file_item.id)  # type: ignore[attr-defined]
    except Exception:
        return "default"
    dataset = str(meta.get("dataset") or "default").strip()
    return dataset or "default"


def _retrieve_focus_chunks(uid: str, files: list[FileItem], *, workflow_id: str, focus: str) -> list[WorkflowSourceFile]:
    if not files:
        return []
    query = _default_query(workflow_id, focus)
    tokenized_query = tokenize_text(uid, query)
    files_by_dataset: dict[str, list[FileItem]] = defaultdict(list)
    for file_item in files:
        files_by_dataset[_dataset_for_file(uid, file_item)].append(file_item)

    gathered: list[tuple[float, WorkflowSourceFile]] = []
    for dataset, dataset_files in files_by_dataset.items():
        try:
            resp = query_request(
                QueryRequest(
                    dataset=dataset,
                    query=tokenized_query,
                    k=_RETRIEVAL_K,
                    with_sources=True,
                    per_doc=False,
                    doc_ids=[item.id for item in dataset_files],
                ),
                uid=uid,
            )
        except Exception:
            log.warning("workflow_targeted_rag_failed", uid=uid, dataset=dataset, workflow_id=workflow_id, exc_info=True)
            continue
        name_by_id = {item.id: item.original_name or item.name or item.id for item in dataset_files}
        folder_by_id = {item.id: item.folder_path for item in dataset_files}
        ctype_by_id = {item.id: item.content_type for item in dataset_files}
        for source in resp.sources or []:
            meta = _detokenize_metadata(uid, source.metadata or {})
            file_id = str(meta.get("file_id") or source.doc_id or "")
            display_name = str(meta.get("display_name") or meta.get("filename") or name_by_id.get(file_id) or file_id)
            text = detokenize_text(uid, str(source.text or ""))
            text = _normalize_text(text)
            if not file_id or not text:
                continue
            score = float(source.score or 0.0)
            label = display_name.split("/")[-1] if "/" in display_name else display_name
            gathered.append(
                (
                    score,
                    WorkflowSourceFile(
                        file_id=file_id,
                        name=f"{label} — retrieved evidence",
                        folder_path=str(meta.get("folder_path") or folder_by_id.get(file_id) or "") or None,
                        content_type=str(meta.get("content_type") or ctype_by_id.get(file_id) or "") or None,
                        excerpt=text,
                        full_text_chars=len(text),
                        excerpt_chars=len(text),
                        truncated=False,
                        source_kind="retrieved",
                        chunk_ids=[str(source.chunk_id or "")] if getattr(source, "chunk_id", None) else [],
                        chunk_count=1,
                    ),
                )
            )
    gathered.sort(key=lambda item: item[0], reverse=True)
    deduped: list[WorkflowSourceFile] = []
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for _, source in gathered:
        key = (source.file_id, tuple(source.chunk_ids or []))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(source)
        if len(deduped) >= _MAX_RETRIEVED_SOURCES:
            break
    return deduped


def build_sources(uid: str, files: list[FileItem], *, workflow_id: str, focus: str = "") -> tuple[list[WorkflowSourceFile], dict[str, Any]]:
    coverage_sources: list[WorkflowSourceFile] = []
    skipped_files: list[str] = []
    artifacts_used = 0
    chunks_seen = 0

    for file_item in files:
        materialized = _materialize_chunks(uid, file_item)
        if materialized and _load_chunk_artifact(uid, file_item) is not None:
            artifacts_used += 1
        if not materialized:
            skipped_files.append(file_item.original_name or file_item.name or file_item.id)
            continue
        raw_chunks = [chunk for chunk in (materialized.get("chunks") or []) if str(chunk.get("text") or "").strip()]
        if not raw_chunks:
            skipped_files.append(file_item.original_name or file_item.name or file_item.id)
            continue
        chunks_seen += len(raw_chunks)
        grouped = _group_chunks(raw_chunks)
        group_summaries = [
            _condense_group("\n\n".join(str(chunk.get("text") or "") for chunk in group), focus=focus or _default_query(workflow_id, focus))
            for group in grouped
        ]
        combined = _merge_group_summaries(group_summaries)
        if not combined:
            skipped_files.append(file_item.original_name or file_item.name or file_item.id)
            continue
        full_text_chars = int(materialized.get("full_text_chars") or sum(len(str(chunk.get("text") or "")) for chunk in raw_chunks))
        coverage_sources.append(
            WorkflowSourceFile(
                file_id=file_item.id,
                name=file_item.original_name or file_item.name or file_item.id,
                folder_path=file_item.folder_path,
                content_type=file_item.content_type,
                excerpt=combined,
                full_text_chars=full_text_chars,
                excerpt_chars=len(combined),
                truncated=len(combined) < full_text_chars,
                source_kind="coverage",
                chunk_ids=[str(chunk.get("chunk_id") or "") for chunk in raw_chunks],
                chunk_count=len(raw_chunks),
            )
        )

    retrieved_sources: list[WorkflowSourceFile] = []
    if coverage_sources:
        should_retrieve = get_domain_workflow_spec(workflow_id) is not None or not _looks_broad_focus(focus) or workflow_id in {"create_action_plan", "extract_information", "compare_documents"}
        if should_retrieve:
            retrieved_sources = _retrieve_focus_chunks(uid, files, workflow_id=workflow_id, focus=focus)

    sources = [*coverage_sources, *retrieved_sources]
    if len(sources) > _MAX_TOTAL_SOURCES:
        sources = sources[:_MAX_TOTAL_SOURCES]

    strategy = "coverage"
    if coverage_sources and retrieved_sources:
        strategy = "coverage_plus_targeted_rag"
    elif retrieved_sources:
        strategy = "targeted_rag"

    stats = {
        "source_strategy": strategy,
        "coverage_source_files": len(coverage_sources),
        "retrieved_source_files": len(retrieved_sources),
        "chunk_artifacts_used": artifacts_used,
        "chunks_seen": chunks_seen,
        "skipped_source_files": skipped_files,
        "warnings": [
            "Workflow sources now use chunk coverage across the selected document(s)." if coverage_sources else "",
            "Targeted retrieval was added for workflow-specific evidence." if retrieved_sources else "",
        ],
    }
    stats["warnings"] = [item for item in stats["warnings"] if item]
    return sources, stats
