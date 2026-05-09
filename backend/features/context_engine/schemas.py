from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

CoverageStatus = Literal[
    "unvisited",
    "covered",
    "partial",
    "weak",
    "missing",
    "not_applicable",
    "negative_supported",
    "exhausted",
]
EvidenceVerdict = Literal["accepted", "partial", "rejected", "deferred", "duplicate", "not_retrieved"]
EvidenceQuality = Literal["strong", "partial", "weak", "irrelevant", "duplicate", "unavailable"]


@dataclass(frozen=True)
class SourceSpan:
    file_id: str
    chunk_id: str
    chunk_index: int | None = None
    span: dict[str, int] | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SourceSpan | None":
        file_id = str(raw.get("file_id") or "").strip()
        chunk_id = str(raw.get("chunk_id") or "").strip()
        if not file_id or not chunk_id:
            return None
        chunk_index = raw.get("chunk_index")
        try:
            chunk_index = int(chunk_index) if chunk_index is not None else None
        except Exception:
            chunk_index = None
        span = raw.get("span") if isinstance(raw.get("span"), dict) else None
        return cls(file_id=file_id, chunk_id=chunk_id, chunk_index=chunk_index, span=span)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"file_id": self.file_id, "chunk_id": self.chunk_id, "chunk_index": self.chunk_index}
        if self.span is not None:
            out["span"] = self.span
        return out


@dataclass(frozen=True)
class DomainMapEntry:
    entry_id: str
    entry_type: str
    title: str = ""
    summary: str = ""
    source_spans: tuple[SourceSpan, ...] = ()
    key_terms: tuple[str, ...] = ()
    obligations_or_actions: tuple[str, ...] = ()
    risks_or_flags: tuple[str, ...] = ()
    cross_references: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "entry_type": self.entry_type,
            "title": self.title,
            "summary": self.summary,
            "source_spans": [span.to_dict() for span in self.source_spans],
            "key_terms": list(self.key_terms),
            "obligations_or_actions": list(self.obligations_or_actions),
            "risks_or_flags": list(self.risks_or_flags),
            "cross_references": list(self.cross_references),
            "metadata": self.metadata,
        }


@dataclass(frozen=True)
class EvidenceRecord:
    file_id: str
    chunk_id: str
    source_kind: str = "unknown"
    chunk_index: int | None = None
    score: float | None = None
    target_ids: tuple[str, ...] = ()
    verdict: EvidenceVerdict = "accepted"
    reason: str = ""
    quality: EvidenceQuality | None = None
    relevance_score: float | None = None
    matched_signals: tuple[str, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.file_id}:{self.chunk_id}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_id": self.file_id,
            "chunk_id": self.chunk_id,
            "chunk_index": self.chunk_index,
            "source_kind": self.source_kind,
            "score": self.score,
            "target_ids": list(self.target_ids),
            "verdict": self.verdict,
            "reason": self.reason,
            "quality": self.quality,
            "relevance_score": self.relevance_score,
            "matched_signals": list(self.matched_signals),
        }


class CoverageTargetSnapshot(TypedDict, total=False):
    target_id: str
    target_type: str
    label: str
    priority: str
    status: str
    accepted_evidence: list[str]
    partial_evidence: list[str]
    rejected_evidence: list[str]
    deferred_evidence: list[str]
    missing_evidence: list[str]
    attempts: int
    exhausted: bool
    metadata: dict[str, Any]


class CoveragePassSnapshot(TypedDict, total=False):
    pass_index: int
    pass_type: str
    query: str | None
    frontier_target_ids: list[str]
    candidate_count: int
    accepted_count: int
    rejected_count: int
    duplicate_count: int
    partial_count: int
    deferred_count: int
    accepted_evidence: list[str]
    partial_evidence: list[str]
    rejected_evidence: list[str]
    deferred_evidence: list[str]
    decision: str
    reason: str
    useful_evidence_count: int
    quality_summary: dict[str, int]
    metadata: dict[str, Any]


class CoverageLedgerSnapshot(TypedDict, total=False):
    schema_version: int
    domain: str
    workflow_id: str | None
    source_map_kind: str | None
    source_map_summary: dict[str, Any]
    max_chunks_per_pass: int
    pass_count: int
    status: str
    sufficient: bool
    unresolved_target_count: int
    exhausted_target_count: int
    targets: dict[str, CoverageTargetSnapshot]
    frontier: list[dict[str, Any]]
    passes: list[CoveragePassSnapshot]
    evidence: dict[str, dict[str, Any]]
    notes: list[str]
    convergence: dict[str, Any]
