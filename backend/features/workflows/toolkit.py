from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any

from core.pii import detokenize_text
from features.files import service as files_service
from features.files.schemas import FileItem
from urllib.parse import unquote
from features.rag import chunk_store
from features.rag.context_agent import build_context_bundle

from .domain_packs import get_domain_workflow_spec
from .legal_clause_map import (
    build_clause_map_source_with_status,
    clause_map_status_record,
    compact_clause_map_for_eval,
    normalize_contract_text,
    parse_clause_map_from_text,
    select_clause_map_entries_for_workflow,
)
from .models import WorkflowSourceFile

log = logging.getLogger("workflows.toolkit")

_EVAL_FIXTURE_ID_PREFIX = "eval_fixture://"
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_EVAL_FIXTURE_ROOTS = (
    _BACKEND_ROOT / "internal" / "evals" / "fixtures",
    _BACKEND_ROOT / "app" / "internal" / "evals" / "fixtures",
)


def _is_path_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except Exception:
        return False


def _safe_eval_fixture_roots() -> list[Path]:
    roots: list[Path] = []
    for root in _EVAL_FIXTURE_ROOTS:
        try:
            resolved = root.resolve()
        except Exception:
            continue
        if resolved.exists() and resolved.is_dir():
            roots.append(resolved)
    return roots


def _eval_fixture_path_from_file_id(file_id: str) -> Path | None:
    if not str(file_id or "").startswith(_EVAL_FIXTURE_ID_PREFIX):
        return None
    raw = unquote(str(file_id)[len(_EVAL_FIXTURE_ID_PREFIX):])
    try:
        path = Path(raw).resolve()
    except Exception:
        return None
    for root in _safe_eval_fixture_roots():
        if _is_path_within(path, root) and path.exists() and path.is_file():
            return path
    return None


def _is_eval_fixture_file_id(file_id: str) -> bool:
    return _eval_fixture_path_from_file_id(file_id) is not None

_ARTIFACT_VERSION = chunk_store.ARTIFACT_VERSION
_ARTIFACT_NAME = chunk_store.LEGACY_ARTIFACT_NAME
_MAX_ARTIFACT_BYTES = chunk_store.DEFAULT_MAX_ARTIFACT_BYTES
_MAX_GROUP_CHARS = 2400
_MAX_COVERAGE_CHARS_PER_FILE = 8000
_MAX_RETRIEVED_SOURCES = 4
_MAX_TOTAL_SOURCES = 12
_RETRIEVAL_K = 8
_DEFAULT_FULL_CONTRACT_MAX_TOKENS = 0
_MIN_FULL_CONTRACT_CHARS = 1_000

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



def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default
    return max(0, value)


def _full_contract_max_tokens() -> int:
    return _env_int("WORKFLOW_FULL_CONTRACT_MAX_TOKENS", _DEFAULT_FULL_CONTRACT_MAX_TOKENS)


def _is_legal_workflow(workflow_id: str) -> bool:
    spec = get_domain_workflow_spec(workflow_id)
    return bool(spec is not None and spec.pack_id == "legal")
def _normalize_text(text: str) -> str:
    return chunk_store.normalize_text(text)


def chunk_artifact_path(file_id: str) -> str:
    return chunk_store.legacy_artifact_path(file_id)


def delete_chunk_artifact(uid: str, file_id: str) -> None:
    chunk_store.delete_chunk_artifact(uid, file_id)


def persist_chunk_artifact(
    uid: str,
    *,
    file_id: str,
    text: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
) -> dict[str, Any] | None:
    return chunk_store.persist_chunk_artifact(
        uid,
        file_id=file_id,
        text=text,
        name=name,
        folder_path=folder_path,
        content_type=content_type,
        store=not _is_eval_fixture_file_id(file_id),
    )


def _load_chunk_artifact(uid: str, file_item: FileItem) -> dict[str, Any] | None:
    if _is_eval_fixture_file_id(file_item.id):
        return None
    return chunk_store.load_chunk_artifact(uid, file_item)


def _extract_text_on_demand(uid: str, file_item: FileItem) -> str | None:
    fixture_path = _eval_fixture_path_from_file_id(file_item.id)
    if fixture_path is not None:
        try:
            data = fixture_path.read_bytes()
        except Exception:
            log.warning("workflow_eval_fixture_read_failed", uid=uid, file_id=file_item.id, exc_info=True)
            return None
        content_type = file_item.content_type
    else:
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
    if _is_eval_fixture_file_id(file_item.id):
        return "eval_fixtures"
    try:
        meta = files_service._get_blob_metadata(uid, file_item.id)  # type: ignore[attr-defined]
    except Exception:
        return "default"
    dataset = str(meta.get("dataset") or "default").strip()
    return dataset or "default"


def _retrieve_focus_chunks(
    uid: str,
    files: list[FileItem],
    *,
    workflow_id: str,
    focus: str,
    workflow_inputs: dict[str, Any] | None = None,
    clause_maps: list[dict[str, Any]] | None = None,
) -> tuple[list[WorkflowSourceFile], dict[str, Any]]:
    if not files:
        return [], {}
    query = _default_query(workflow_id, focus)
    profile = "legal" if _is_legal_workflow(workflow_id) else "workflow"
    clause_map_selection: dict[str, Any] | None = None
    selected_clause_entries: list[dict[str, Any]] = []
    if profile == "legal" and clause_maps:
        try:
            clause_map_selection = select_clause_map_entries_for_workflow(
                clause_maps=clause_maps,
                workflow_id=workflow_id,
                focus=focus,
                workflow_inputs=workflow_inputs or {},
            )
            selected_clause_entries = [
                item for item in (clause_map_selection.get("selected_entries") or [])
                if isinstance(item, dict)
            ]
        except Exception:
            log.warning("workflow_clause_map_selection_failed", uid=uid, workflow_id=workflow_id, exc_info=True)
            clause_map_selection = None
            selected_clause_entries = []
    try:
        bundle = build_context_bundle(
            uid=uid,
            files=files,
            query=query,
            profile=profile,
            workflow_id=workflow_id,
            clause_map_entries=selected_clause_entries,
            clause_map_selection=clause_map_selection,
        )
    except Exception:
        log.warning("workflow_adaptive_context_failed", uid=uid, workflow_id=workflow_id, exc_info=True)
        return [], {}

    sources: list[WorkflowSourceFile] = []
    evidence_chunks: list[dict[str, Any]] = []
    for idx, chunk in enumerate(bundle.chunks):
        meta = _detokenize_metadata(uid, chunk.metadata or {})
        display_name = str(meta.get("display_name") or meta.get("filename") or chunk.file_id)
        label = display_name.split("/")[-1] if "/" in display_name else display_name
        suffix = "retrieved evidence" if chunk.source == "retrieved" else "context"
        text = _normalize_text(detokenize_text(uid, str(chunk.text or "")))
        if not text:
            continue
        evidence_chunks.append(
            {
                "file_id": chunk.file_id,
                "source_name": label,
                "folder_path": str(meta.get("folder_path") or "") or None,
                "chunk_id": chunk.chunk_id,
                "chunk_index": chunk.chunk_index,
                "source_kind": chunk.source,
                "score": chunk.score,
                "excerpt": text[:1200].strip(),
            }
        )
        if len(sources) < _MAX_RETRIEVED_SOURCES:
            sources.append(
                WorkflowSourceFile(
                    file_id=chunk.file_id,
                    name=f"{label} — {suffix}",
                    folder_path=str(meta.get("folder_path") or "") or None,
                    content_type=str(meta.get("content_type") or "") or None,
                    excerpt=text,
                    full_text_chars=len(text),
                    excerpt_chars=len(text),
                    truncated=False,
                    source_kind="retrieved",
                    chunk_ids=[chunk.chunk_id] if chunk.chunk_id else [],
                    chunk_count=1,
                )
            )


    trace = [
        {
            "step": step.step,
            "type": step.type,
            "query": step.query,
            "reason": step.reason,
            "chunk_ids": step.chunk_ids,
            "chunks_added": step.chunks_added,
        }
        for step in bundle.retrieval_trace
    ]
    decision_trace = [
        {
            "step": decision.step,
            "stage": decision.stage,
            "decision": decision.decision,
            "rationale": decision.rationale,
            "action": decision.action,
            "observation": decision.observation,
            "outcome": decision.outcome,
            "metadata": decision.metadata,
        }
        for decision in bundle.decision_trace
    ]
    stats = {
        "adaptive_context": {
            "profile": bundle.profile,
            "sufficient": bundle.sufficient,
            "selected_chunks": len(bundle.chunks),
            "returned_sources": len(sources),
            "coverage_notes": bundle.coverage_notes,
            "missing_context": bundle.missing_context,
            "retrieval_trace": trace,
            "decision_trace": decision_trace,
            "evidence_chunks": evidence_chunks,
            "context_source_mode": "clause_map_first" if any(step.type == "clause_map_source_fetch" for step in bundle.retrieval_trace) else "rag_first",
            "clause_map_selection": {
                key: value
                for key, value in (clause_map_selection or {}).items()
                if key != "selected_entries"
            } if clause_map_selection else {},
            "selected_clause_map_entries": [
                {
                    "clause_map_id": entry.get("clause_map_id"),
                    "entry_id": entry.get("entry_id"),
                    "entry_kind": entry.get("entry_kind"),
                    "source_file_id": entry.get("source_file_id"),
                    "source_name": entry.get("source_name"),
                    "title": entry.get("title"),
                    "normalized_type": entry.get("normalized_type"),
                    "clause_family": entry.get("clause_family"),
                    "status": entry.get("status"),
                    "confidence": entry.get("confidence"),
                    "summary": entry.get("summary"),
                    "source_spans": entry.get("source_spans") or [],
                    "cross_references": entry.get("cross_references") or [],
                }
                for entry in selected_clause_entries
            ],
        }
    }
    return sources, stats


def build_sources(uid: str, files: list[FileItem], *, workflow_id: str, focus: str = "", workflow_inputs: dict[str, Any] | None = None) -> tuple[list[WorkflowSourceFile], dict[str, Any]]:
    coverage_sources: list[WorkflowSourceFile] = []
    clause_map_sources: list[WorkflowSourceFile] = []
    skipped_files: list[str] = []
    artifacts_used = 0
    chunks_seen = 0
    full_contract_sources = 0
    clause_maps_created = 0
    clause_map_eval_records: list[dict[str, Any]] = []
    clause_map_status_records: list[dict[str, Any]] = []
    clause_maps_for_agent: list[dict[str, Any]] = []
    legal_workflow = _is_legal_workflow(workflow_id)
    full_contract_max_tokens = _full_contract_max_tokens()

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
        chunk_ids = [str(chunk.get("chunk_id") or "") for chunk in raw_chunks]
        full_text = normalize_contract_text("\n\n".join(str(chunk.get("text") or "") for chunk in raw_chunks))
        full_text_chars = int(materialized.get("full_text_chars") or len(full_text))
        display_name = file_item.original_name or file_item.name or file_item.id

        # Legal Pro workflows need completeness. Build a persisted full stored-
        # chunk clause map for every legal source. The map is compact evidence
        # control, not a customer-facing source and not the full contract.
        if legal_workflow and raw_chunks:
            try:
                stored_chunks = chunk_store.chunks_from_payload(materialized)
                clause_map_source, clause_map_status = build_clause_map_source_with_status(
                    uid=uid,
                    file_id=file_item.id,
                    name=display_name,
                    folder_path=file_item.folder_path,
                    content_type=file_item.content_type,
                    chunks=stored_chunks,
                    workflow_id=workflow_id,
                    store=not _is_eval_fixture_file_id(file_item.id),
                    prefer_llm=True,
                    generation_context="workflow_fallback",
                )
                clause_map_status_records.append(clause_map_status)
                if clause_map_source is not None:
                    clause_map_sources.append(clause_map_source)
                    parsed_clause_map = parse_clause_map_from_text(clause_map_source.excerpt)
                    if parsed_clause_map:
                        clause_maps_for_agent.append(parsed_clause_map)
                        clause_map_eval_records.append(compact_clause_map_for_eval(parsed_clause_map))
                    clause_maps_created += 1
                else:
                    log.warning(
                        "workflow_contract_clause_map_unavailable",
                        uid=uid,
                        file_id=file_item.id,
                        workflow_id=workflow_id,
                        status=clause_map_status.get("status"),
                        detail=clause_map_status.get("detail"),
                    )
            except Exception as exc:
                log.warning("workflow_contract_clause_map_failed", uid=uid, file_id=file_item.id, workflow_id=workflow_id, exc_info=True)
                clause_map_status_records.append(
                    clause_map_status_record(
                        file_id=file_item.id,
                        name=display_name,
                        folder_path=file_item.folder_path,
                        content_type=file_item.content_type,
                        status="error",
                        detail="Unexpected workflow clause-map error.",
                        error=str(exc),
                    )
                )

            if full_contract_max_tokens > 0 and full_text and len(full_text) >= _MIN_FULL_CONTRACT_CHARS:
                try:
                    from core.tokenizer import count_tokens
                    token_estimate = count_tokens(full_text)
                except Exception:
                    token_estimate = len(full_text) // 4
                if token_estimate <= full_contract_max_tokens:
                    coverage_sources.append(
                        WorkflowSourceFile(
                            file_id=file_item.id,
                            name=display_name,
                            folder_path=file_item.folder_path,
                            content_type=file_item.content_type,
                            excerpt=full_text,
                            full_text_chars=full_text_chars,
                            excerpt_chars=len(full_text),
                            truncated=False,
                            source_kind="full_contract",
                            chunk_ids=chunk_ids,
                            chunk_count=len(raw_chunks),
                        )
                    )
                    full_contract_sources += 1
                    continue

        grouped = _group_chunks(raw_chunks)
        group_summaries = [
            _condense_group("\n\n".join(str(chunk.get("text") or "") for chunk in group), focus=focus or _default_query(workflow_id, focus))
            for group in grouped
        ]
        combined = _merge_group_summaries(group_summaries)
        if not combined:
            skipped_files.append(display_name)
            continue
        coverage_sources.append(
            WorkflowSourceFile(
                file_id=file_item.id,
                name=display_name,
                folder_path=file_item.folder_path,
                content_type=file_item.content_type,
                excerpt=combined,
                full_text_chars=full_text_chars,
                excerpt_chars=len(combined),
                truncated=len(combined) < full_text_chars,
                source_kind="coverage",
                chunk_ids=chunk_ids,
                chunk_count=len(raw_chunks),
            )
        )

    retrieved_sources: list[WorkflowSourceFile] = []
    adaptive_context_stats: dict[str, Any] = {}
    if coverage_sources:
        should_retrieve = get_domain_workflow_spec(workflow_id) is not None or not _looks_broad_focus(focus) or workflow_id in {"create_action_plan", "extract_information", "compare_documents"}
        retrieval_files = [item for item in files if not _is_eval_fixture_file_id(item.id)]
        if should_retrieve and retrieval_files:
            retrieved_sources, adaptive_context_stats = _retrieve_focus_chunks(uid, retrieval_files, workflow_id=workflow_id, focus=focus, workflow_inputs=workflow_inputs or {}, clause_maps=clause_maps_for_agent)
        else:
            adaptive_context_stats = {}

    # Put customer-visible source text before hidden fact-map support records so
    # final Sources used renders the selected contract, not the internal fact map.
    sources = [*coverage_sources, *clause_map_sources, *retrieved_sources]
    if len(sources) > _MAX_TOTAL_SOURCES:
        # Preserve fact maps for legal workflows even when there are many sources.
        if clause_map_sources:
            source_limit = max(0, _MAX_TOTAL_SOURCES - len(clause_map_sources))
            sources = [*coverage_sources[:source_limit], *clause_map_sources]
        else:
            sources = sources[:_MAX_TOTAL_SOURCES]

    strategy = "coverage"
    if full_contract_sources and clause_map_sources:
        strategy = "full_contract_plus_clause_map"
    elif clause_map_sources and coverage_sources:
        strategy = "coverage_plus_clause_map"
    elif clause_map_sources:
        strategy = "clause_map"
    adaptive_context = adaptive_context_stats.get("adaptive_context") if isinstance(adaptive_context_stats.get("adaptive_context"), dict) else {}
    if retrieved_sources:
        if adaptive_context.get("context_source_mode") == "clause_map_first":
            strategy = f"{strategy}_plus_clause_map_context"
        else:
            strategy = f"{strategy}_plus_targeted_rag"

    stats = {
        "source_strategy": strategy,
        "coverage_source_files": len([source for source in coverage_sources if source.source_kind == "coverage"]),
        "full_contract_source_files": full_contract_sources,
        "contract_clause_map_files": clause_maps_created,
        "contract_clause_maps": clause_map_eval_records,
        "clause_map_status": clause_map_status_records,
        "contract_clause_map_statuses": clause_map_status_records,
        "retrieved_source_files": len(retrieved_sources),
        "chunk_artifacts_used": artifacts_used,
        "chunks_seen": chunks_seen,
        "skipped_source_files": skipped_files,
        "max_full_contract_tokens": full_contract_max_tokens,
        **adaptive_context_stats,
        "warnings": [
            "Legal workflow used full-contract source text where it fit the configured context budget." if full_contract_sources else "",
            "Legal workflow used a full stored-chunk clause map for clause coverage." if clause_map_sources else "",
            "Workflow sources use condensed chunk coverage for source text that exceeds the full-contract budget." if coverage_sources and not full_contract_sources else "",
            "Clause-map-selected source chunks were added for workflow-specific evidence." if retrieved_sources and adaptive_context.get("context_source_mode") == "clause_map_first" else "",
            "Targeted retrieval was added for workflow-specific evidence." if retrieved_sources and adaptive_context.get("context_source_mode") != "clause_map_first" else "",
        ],
    }
    stats["warnings"] = [item for item in stats["warnings"] if item]
    return sources, stats
