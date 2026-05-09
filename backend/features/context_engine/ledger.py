from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .schemas import (
    CoverageLedgerSnapshot,
    CoveragePassSnapshot,
    CoverageStatus,
    CoverageTargetSnapshot,
    DomainMapEntry,
    EvidenceRecord,
)


_FINAL_STATUSES = {"covered", "negative_supported", "not_applicable", "exhausted"}
_UNRESOLVED_STATUSES = {"unvisited", "partial", "weak", "missing"}


def _clean_id(value: str) -> str:
    return "_".join(str(value or "").strip().split()) or "unknown"


@dataclass
class _TargetState:
    target_id: str
    target_type: str = "map_entry"
    label: str = ""
    priority: str = "normal"
    status: CoverageStatus = "unvisited"
    accepted_evidence: list[str] = field(default_factory=list)
    partial_evidence: list[str] = field(default_factory=list)
    rejected_evidence: list[str] = field(default_factory=list)
    missing_evidence: list[str] = field(default_factory=list)
    attempts: int = 0
    exhausted: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> CoverageTargetSnapshot:
        return {
            "target_id": self.target_id,
            "target_type": self.target_type,
            "label": self.label,
            "priority": self.priority,
            "status": self.status,
            "accepted_evidence": self.accepted_evidence,
            "partial_evidence": self.partial_evidence,
            "rejected_evidence": self.rejected_evidence,
            "missing_evidence": self.missing_evidence,
            "attempts": self.attempts,
            "exhausted": self.exhausted,
            "metadata": self.metadata,
        }


@dataclass
class CoverageLedger:
    """Domain-neutral coverage ledger for iterative evidence retrieval.

    The ledger does not know what a "clause" or "invoice" is. It tracks map
    entries, workflow targets, evidence verdicts, and pass-level progress so
    domain packs can decide whether more context is needed.
    """

    domain: str
    workflow_id: str | None = None
    source_map_kind: str | None = None
    max_chunks_per_pass: int = 24
    source_map_summary: dict[str, Any] = field(default_factory=dict)
    targets: dict[str, _TargetState] = field(default_factory=dict)
    evidence: dict[str, EvidenceRecord] = field(default_factory=dict)
    passes: list[CoveragePassSnapshot] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @classmethod
    def from_entries(
        cls,
        *,
        domain: str,
        workflow_id: str | None,
        entries: Iterable[DomainMapEntry],
        source_map_kind: str | None,
        max_chunks_per_pass: int,
        source_map_summary: dict[str, Any] | None = None,
    ) -> "CoverageLedger":
        ledger = cls(
            domain=domain,
            workflow_id=workflow_id,
            source_map_kind=source_map_kind,
            max_chunks_per_pass=max_chunks_per_pass,
            source_map_summary=source_map_summary or {},
        )
        for entry in entries:
            ledger.add_target(
                target_id=entry.entry_id,
                target_type="map_entry",
                label=entry.title or entry.entry_type or entry.entry_id,
                priority=str(entry.metadata.get("priority") or "normal"),
                metadata={
                    "entry_type": entry.entry_type,
                    "source_span_count": len(entry.source_spans),
                    "cross_references": list(entry.cross_references),
                    **{k: v for k, v in entry.metadata.items() if k not in {"priority"}},
                },
            )
        return ledger

    def add_target(
        self,
        *,
        target_id: str,
        target_type: str = "map_entry",
        label: str = "",
        priority: str = "normal",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        clean = _clean_id(target_id)
        if clean in self.targets:
            if metadata:
                self.targets[clean].metadata.update(metadata)
            return
        self.targets[clean] = _TargetState(
            target_id=clean,
            target_type=target_type,
            label=label or clean,
            priority=priority or "normal",
            metadata=metadata or {},
        )

    def add_note(self, note: str) -> None:
        clean = str(note or "").strip()
        if clean:
            self.notes.append(clean)

    def _ensure_target(self, target_id: str, *, target_type: str = "derived", label: str = "") -> _TargetState:
        clean = _clean_id(target_id)
        if clean not in self.targets:
            self.add_target(target_id=clean, target_type=target_type, label=label or clean)
        return self.targets[clean]

    def record_pass(
        self,
        *,
        pass_type: str,
        query: str | None = None,
        frontier_target_ids: Iterable[str] = (),
        candidates: Iterable[EvidenceRecord] = (),
        accepted: Iterable[EvidenceRecord] = (),
        rejected: Iterable[EvidenceRecord] = (),
        duplicates: Iterable[EvidenceRecord] = (),
        decision: str = "continue",
        reason: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        frontier = [_clean_id(item) for item in frontier_target_ids if str(item or "").strip()]
        candidate_list = list(candidates)
        accepted_list = list(accepted)
        rejected_list = list(rejected)
        duplicate_list = list(duplicates)

        for target_id in frontier:
            self._ensure_target(target_id).attempts += 1

        for record in accepted_list:
            self.evidence[record.key] = record
            target_ids = list(record.target_ids) or frontier
            for target_id in target_ids:
                target = self._ensure_target(target_id)
                if record.key not in target.accepted_evidence:
                    target.accepted_evidence.append(record.key)
                target.status = "covered"
                target.exhausted = False

        for record in rejected_list:
            self.evidence[record.key] = record
            target_ids = list(record.target_ids) or frontier
            for target_id in target_ids:
                target = self._ensure_target(target_id)
                if record.key not in target.rejected_evidence:
                    target.rejected_evidence.append(record.key)
                if target.status == "unvisited":
                    target.status = "weak"

        for record in duplicate_list:
            self.evidence[record.key] = record

        for target_id in frontier:
            target = self._ensure_target(target_id)
            if not target.accepted_evidence and not target.partial_evidence and target.status == "unvisited":
                target.status = "missing"

        self.passes.append(
            {
                "pass_index": len(self.passes) + 1,
                "pass_type": pass_type,
                "query": query,
                "frontier_target_ids": frontier,
                "candidate_count": len(candidate_list),
                "accepted_count": len(accepted_list),
                "rejected_count": len(rejected_list),
                "duplicate_count": len(duplicate_list),
                "accepted_evidence": [item.key for item in accepted_list],
                "rejected_evidence": [item.key for item in rejected_list],
                "decision": decision,
                "reason": reason,
                "metadata": metadata or {},
            }
        )

    def mark_exhausted(self, target_ids: Iterable[str], *, reason: str = "") -> None:
        for target_id in target_ids:
            target = self._ensure_target(target_id)
            target.exhausted = True
            if target.status in {"unvisited", "weak", "missing"}:
                target.status = "exhausted"
            if reason and reason not in target.missing_evidence:
                target.missing_evidence.append(reason)

    def mark_partial(self, target_ids: Iterable[str], *, reason: str = "") -> None:
        for target_id in target_ids:
            target = self._ensure_target(target_id)
            if target.status not in _FINAL_STATUSES:
                target.status = "partial"
            if reason and reason not in target.missing_evidence:
                target.missing_evidence.append(reason)

    def frontier(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for target in self.targets.values():
            if target.status in _UNRESOLVED_STATUSES and not target.exhausted:
                out.append(
                    {
                        "target_id": target.target_id,
                        "target_type": target.target_type,
                        "label": target.label,
                        "priority": target.priority,
                        "status": target.status,
                        "attempts": target.attempts,
                        "missing_evidence": target.missing_evidence,
                    }
                )
        return out

    def to_dict(self) -> CoverageLedgerSnapshot:
        unresolved = self.frontier()
        exhausted_count = sum(1 for target in self.targets.values() if target.exhausted or target.status == "exhausted")
        sufficient = not unresolved
        status = "sufficient" if sufficient else "needs_more_context"
        return {
            "schema_version": 1,
            "domain": self.domain,
            "workflow_id": self.workflow_id,
            "source_map_kind": self.source_map_kind,
            "source_map_summary": self.source_map_summary,
            "max_chunks_per_pass": self.max_chunks_per_pass,
            "pass_count": len(self.passes),
            "status": status,
            "sufficient": sufficient,
            "unresolved_target_count": len(unresolved),
            "exhausted_target_count": exhausted_count,
            "targets": {key: target.to_dict() for key, target in self.targets.items()},
            "frontier": unresolved,
            "passes": self.passes,
            "evidence": {key: record.to_dict() for key, record in self.evidence.items()},
            "notes": self.notes,
        }
