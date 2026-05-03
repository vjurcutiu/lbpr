from __future__ import annotations

import json
import logging
import math
import os
import re
from dataclasses import dataclass
from typing import Any, Iterable

from features.files import service as files_service
from features.files.schemas import FileItem
from features.rag.chunker import simple_word_chunker

log = logging.getLogger("rag.chunk_store")

ARTIFACT_VERSION = 1
LEGACY_ARTIFACT_NAME = "workflow_chunks.v1.json"
MANIFEST_NAME = "workflow_chunks.v1.manifest.json"
PART_PREFIX = "workflow_chunks.v1.parts"
DEFAULT_MAX_ARTIFACT_BYTES = 800_000
DEFAULT_PART_MAX_BYTES = 650_000


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default
    return max(1, value)


def max_artifact_bytes() -> int:
    return _env_int("WORKFLOW_CHUNK_ARTIFACT_MAX_BYTES", DEFAULT_MAX_ARTIFACT_BYTES)


def part_max_bytes() -> int:
    return _env_int("WORKFLOW_CHUNK_ARTIFACT_PART_MAX_BYTES", DEFAULT_PART_MAX_BYTES)


def normalize_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def artifact_base_path(file_id: str) -> str:
    return str(file_id or "").rsplit("/", 1)[0]


def legacy_artifact_path(file_id: str) -> str:
    base = artifact_base_path(file_id)
    return f"{base}/{LEGACY_ARTIFACT_NAME}" if base else LEGACY_ARTIFACT_NAME


def manifest_path(file_id: str) -> str:
    base = artifact_base_path(file_id)
    return f"{base}/{MANIFEST_NAME}" if base else MANIFEST_NAME


def part_path(file_id: str, part_index: int) -> str:
    base = artifact_base_path(file_id)
    filename = f"{PART_PREFIX}/part-{part_index:04d}.json"
    return f"{base}/{filename}" if base else filename


@dataclass(frozen=True)
class StoredChunk:
    file_id: str
    chunk_id: str
    chunk_index: int
    text: str
    span: dict[str, Any]
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_id": self.file_id,
            "chunk_id": self.chunk_id,
            "chunk_index": self.chunk_index,
            "text": self.text,
            "span": self.span,
            "metadata": self.metadata,
        }


def _chunk_payload(
    *,
    file_id: str,
    text: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
) -> dict[str, Any] | None:
    normalized = normalize_text(text)
    if not normalized:
        return None
    raw_chunks = simple_word_chunker(normalized)
    chunks: list[dict[str, Any]] = []
    for idx, chunk in enumerate(raw_chunks):
        chunk_text = str(chunk.get("text") or "").strip()
        if not chunk_text:
            continue
        chunk_id = str(chunk.get("chunk_id") or f"ch_{idx}")
        chunks.append(
            {
                "chunk_id": chunk_id,
                "chunk_index": idx,
                "text": chunk_text,
                "span": chunk.get("span") or {},
            }
        )
    if not chunks:
        return None
    return {
        "version": ARTIFACT_VERSION,
        "file_id": file_id,
        "name": name,
        "folder_path": folder_path or None,
        "content_type": content_type or None,
        "full_text_chars": len(normalized),
        "chunk_count": len(chunks),
        "chunks": chunks,
    }


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _bucket_blob(path: str):
    return files_service._bucket().blob(path)  # type: ignore[attr-defined]


def _upload_json(uid: str, file_id: str, path: str, payload: Any) -> None:
    files_service._assert_user_owns(uid, file_id)  # type: ignore[attr-defined]
    _bucket_blob(path).upload_from_string(_json_bytes(payload), content_type="application/json")


def _download_json(uid: str, file_id: str, path: str) -> Any | None:
    files_service._assert_user_owns(uid, file_id)  # type: ignore[attr-defined]
    blob = _bucket_blob(path)
    if not blob.exists():
        return None
    return json.loads(blob.download_as_bytes().decode("utf-8"))


def _delete_blob_if_exists(uid: str, file_id: str, path: str) -> None:
    files_service._assert_user_owns(uid, file_id)  # type: ignore[attr-defined]
    blob = _bucket_blob(path)
    if blob.exists():
        blob.delete()


def _chunks_to_parts(chunks: list[dict[str, Any]], *, max_bytes: int) -> list[list[dict[str, Any]]]:
    parts: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_bytes = 2  # []
    for chunk in chunks:
        encoded_len = len(_json_bytes(chunk)) + 1
        if current and current_bytes + encoded_len > max_bytes:
            parts.append(current)
            current = []
            current_bytes = 2
        current.append(chunk)
        current_bytes += encoded_len
    if current:
        parts.append(current)
    return parts


def _store_sharded(uid: str, file_id: str, payload: dict[str, Any]) -> None:
    chunks = list(payload.get("chunks") or [])
    parts = _chunks_to_parts(chunks, max_bytes=part_max_bytes())
    part_records: list[dict[str, Any]] = []
    for idx, part_chunks in enumerate(parts):
        path = part_path(file_id, idx)
        part_payload = {
            "version": ARTIFACT_VERSION,
            "file_id": file_id,
            "part_index": idx,
            "chunks": part_chunks,
        }
        _upload_json(uid, file_id, path, part_payload)
        part_records.append({"path": path, "chunk_count": len(part_chunks)})

    manifest = {
        "version": ARTIFACT_VERSION,
        "storage_mode": "sharded",
        "file_id": payload.get("file_id") or file_id,
        "name": payload.get("name"),
        "folder_path": payload.get("folder_path"),
        "content_type": payload.get("content_type"),
        "full_text_chars": payload.get("full_text_chars"),
        "chunk_count": len(chunks),
        "part_count": len(parts),
        "parts": part_records,
    }
    _upload_json(uid, file_id, manifest_path(file_id), manifest)
    try:
        _delete_blob_if_exists(uid, file_id, legacy_artifact_path(file_id))
    except Exception:
        log.debug("chunk_store_legacy_delete_after_shard_failed", uid=uid, file_id=file_id, exc_info=True)


def persist_chunk_artifact(
    uid: str,
    *,
    file_id: str,
    text: str,
    name: str,
    folder_path: str | None,
    content_type: str | None,
    store: bool = True,
) -> dict[str, Any] | None:
    """Build and optionally persist the workflow chunk artifact.

    Small files keep the legacy single-json artifact for backward compatibility.
    Large files are stored as a manifest plus JSON parts so long documents remain
    reusable by workflows and adaptive retrieval instead of being re-extracted.
    """
    payload = _chunk_payload(
        file_id=file_id,
        text=text,
        name=name,
        folder_path=folder_path,
        content_type=content_type,
    )
    if payload is None:
        return None
    if not store:
        payload["storage_mode"] = "inline"
        return payload

    try:
        encoded = _json_bytes(payload)
        if len(encoded) <= max_artifact_bytes():
            payload["storage_mode"] = "single"
            _upload_json(uid, file_id, legacy_artifact_path(file_id), payload)
            # Best effort cleanup of an older sharded artifact if the file shrank.
            try:
                delete_sharded_artifact(uid, file_id)
            except Exception:
                log.debug("chunk_store_shard_cleanup_failed", uid=uid, file_id=file_id, exc_info=True)
        else:
            payload["storage_mode"] = "sharded"
            _store_sharded(uid, file_id, payload)
        return payload
    except Exception:
        log.warning("chunk_store_persist_failed", uid=uid, file_id=file_id, exc_info=True)
        return payload


def delete_sharded_artifact(uid: str, file_id: str) -> None:
    manifest = _download_json(uid, file_id, manifest_path(file_id))
    if isinstance(manifest, dict):
        for part in manifest.get("parts") or []:
            path = str((part or {}).get("path") or "")
            if path:
                _delete_blob_if_exists(uid, file_id, path)
    _delete_blob_if_exists(uid, file_id, manifest_path(file_id))


def delete_chunk_artifact(uid: str, file_id: str) -> None:
    try:
        _delete_blob_if_exists(uid, file_id, legacy_artifact_path(file_id))
    except Exception:
        log.debug("chunk_store_legacy_delete_failed", uid=uid, file_id=file_id, exc_info=True)
    try:
        delete_sharded_artifact(uid, file_id)
    except Exception:
        log.debug("chunk_store_shard_delete_failed", uid=uid, file_id=file_id, exc_info=True)


def _load_legacy(uid: str, file_item: FileItem) -> dict[str, Any] | None:
    payload = _download_json(uid, file_item.id, legacy_artifact_path(file_item.id))
    if not isinstance(payload, dict) or not isinstance(payload.get("chunks"), list):
        return None
    payload.setdefault("storage_mode", "single")
    return payload


def _load_sharded(uid: str, file_item: FileItem) -> dict[str, Any] | None:
    manifest = _download_json(uid, file_item.id, manifest_path(file_item.id))
    if not isinstance(manifest, dict):
        return None
    chunks: list[dict[str, Any]] = []
    for part in manifest.get("parts") or []:
        path = str((part or {}).get("path") or "")
        if not path:
            continue
        part_payload = _download_json(uid, file_item.id, path)
        if isinstance(part_payload, dict) and isinstance(part_payload.get("chunks"), list):
            chunks.extend(part_payload.get("chunks") or [])
    if not chunks:
        return None
    return {
        "version": manifest.get("version") or ARTIFACT_VERSION,
        "storage_mode": "sharded",
        "file_id": manifest.get("file_id") or file_item.id,
        "name": manifest.get("name"),
        "folder_path": manifest.get("folder_path"),
        "content_type": manifest.get("content_type"),
        "full_text_chars": manifest.get("full_text_chars"),
        "chunk_count": len(chunks),
        "part_count": manifest.get("part_count"),
        "chunks": chunks,
    }


def load_chunk_artifact(uid: str, file_item: FileItem) -> dict[str, Any] | None:
    try:
        payload = _load_legacy(uid, file_item) or _load_sharded(uid, file_item)
        if not payload:
            return None
        payload.setdefault("name", file_item.original_name or file_item.name)
        payload.setdefault("folder_path", file_item.folder_path)
        payload.setdefault("content_type", file_item.content_type)
        payload.setdefault("file_id", file_item.id)
        payload.setdefault("chunk_count", len(payload.get("chunks") or []))
        payload.setdefault("full_text_chars", sum(len(str(chunk.get("text") or "")) for chunk in payload.get("chunks") or []))
        # Backfill chunk_index for older artifacts.
        for idx, chunk in enumerate(payload.get("chunks") or []):
            if isinstance(chunk, dict):
                chunk.setdefault("chunk_index", idx)
                chunk.setdefault("chunk_id", f"ch_{idx}")
        return payload
    except Exception:
        log.debug("chunk_store_load_failed", uid=uid, file_id=file_item.id, exc_info=True)
        return None


def chunks_from_payload(payload: dict[str, Any] | None) -> list[StoredChunk]:
    if not payload:
        return []
    file_id = str(payload.get("file_id") or "")
    base_meta = {
        "name": payload.get("name"),
        "folder_path": payload.get("folder_path"),
        "content_type": payload.get("content_type"),
        "full_text_chars": payload.get("full_text_chars"),
        "storage_mode": payload.get("storage_mode"),
    }
    chunks: list[StoredChunk] = []
    for idx, chunk in enumerate(payload.get("chunks") or []):
        if not isinstance(chunk, dict):
            continue
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue
        chunk_index = int(chunk.get("chunk_index") if chunk.get("chunk_index") is not None else idx)
        chunks.append(
            StoredChunk(
                file_id=file_id,
                chunk_id=str(chunk.get("chunk_id") or f"ch_{chunk_index}"),
                chunk_index=chunk_index,
                text=text,
                span=chunk.get("span") or {},
                metadata=dict(base_meta),
            )
        )
    chunks.sort(key=lambda item: item.chunk_index)
    return chunks


def get_chunks_for_file(uid: str, file_item: FileItem) -> list[StoredChunk]:
    return chunks_from_payload(load_chunk_artifact(uid, file_item))


def _chunk_index_from_id(chunk_id: str) -> int | None:
    match = re.search(r"(\d+)$", str(chunk_id or ""))
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def get_chunks_by_ids(uid: str, file_item: FileItem, chunk_ids: Iterable[str]) -> list[StoredChunk]:
    wanted_ids = {str(item) for item in chunk_ids if str(item or "").strip()}
    wanted_indices = {idx for idx in (_chunk_index_from_id(item) for item in wanted_ids) if idx is not None}
    if not wanted_ids and not wanted_indices:
        return []
    chunks = get_chunks_for_file(uid, file_item)
    return [chunk for chunk in chunks if chunk.chunk_id in wanted_ids or chunk.chunk_index in wanted_indices]


def get_neighbor_chunks(
    uid: str,
    file_item: FileItem,
    *,
    chunk_ids: Iterable[str],
    before: int = 1,
    after: int = 1,
) -> list[StoredChunk]:
    chunks = get_chunks_for_file(uid, file_item)
    if not chunks:
        return []
    by_id = {chunk.chunk_id: chunk for chunk in chunks}
    by_index = {chunk.chunk_index: chunk for chunk in chunks}
    selected_indices: set[int] = set()
    for chunk_id in chunk_ids:
        clean = str(chunk_id or "")
        found = by_id.get(clean)
        if found is not None:
            idx = found.chunk_index
        else:
            parsed = _chunk_index_from_id(clean)
            idx = parsed if parsed is not None else None
        if idx is None:
            continue
        for neighbor_idx in range(max(0, idx - before), idx + after + 1):
            if neighbor_idx in by_index:
                selected_indices.add(neighbor_idx)
    return [by_index[idx] for idx in sorted(selected_indices)]


def estimate_payload_part_count(payload: dict[str, Any] | None) -> int:
    if not payload:
        return 0
    if payload.get("storage_mode") == "sharded" and payload.get("part_count"):
        try:
            return int(payload.get("part_count") or 0)
        except Exception:
            return 0
    chunks = list(payload.get("chunks") or [])
    if not chunks:
        return 0
    total = len(_json_bytes(chunks))
    return max(1, math.ceil(total / max(1, part_max_bytes())))
