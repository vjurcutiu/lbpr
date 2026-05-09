from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from features.context_engine.schemas import DomainMapEntry, SourceSpan


def _strings(values: Any) -> tuple[str, ...]:
    if not isinstance(values, list):
        return ()
    return tuple(str(item).strip() for item in values if str(item).strip())


def entries_from_clause_map_records(entries: Iterable[dict[str, Any]]) -> list[DomainMapEntry]:
    out: list[DomainMapEntry] = []
    for idx, entry in enumerate(entries or []):
        if not isinstance(entry, dict):
            continue
        raw_id = str(entry.get("entry_id") or entry.get("clause_family") or f"entry_{idx}").strip()
        if not raw_id:
            continue
        spans: list[SourceSpan] = []
        for raw_span in entry.get("source_spans") or []:
            if isinstance(raw_span, dict):
                span = SourceSpan.from_dict(raw_span)
                if span is not None:
                    spans.append(span)
        entry_type = str(entry.get("clause_family") or entry.get("normalized_type") or entry.get("entry_kind") or "legal_clause").strip()
        out.append(
            DomainMapEntry(
                entry_id=raw_id,
                entry_type=entry_type,
                title=str(entry.get("title") or entry_type or raw_id),
                summary=str(entry.get("summary") or ""),
                source_spans=tuple(spans),
                key_terms=_strings(entry.get("key_terms")),
                obligations_or_actions=_strings(entry.get("obligations")),
                risks_or_flags=_strings(entry.get("risk_signals")),
                cross_references=_strings(entry.get("cross_references")),
                metadata={
                    "domain_source": "legal_clause_map",
                    "clause_map_id": entry.get("clause_map_id"),
                    "entry_kind": entry.get("entry_kind"),
                    "clause_family": entry.get("clause_family"),
                    "normalized_type": entry.get("normalized_type"),
                    "status": entry.get("status"),
                    "confidence": entry.get("confidence"),
                    "source_file_id": entry.get("source_file_id"),
                    "source_name": entry.get("source_name"),
                    "priority": "high" if entry.get("source_spans") else "normal",
                },
            )
        )
    return out


@dataclass(frozen=True)
class LegalClauseMapAdapter:
    entries: tuple[DomainMapEntry, ...]
    available_entry_count: int | None = None
    selected_entry_count: int | None = None
    selection_method: str | None = None
    selection_lens: dict[str, Any] | None = None

    domain_id: str = "legal"
    source_map_kind: str = "clause_map"

    @classmethod
    def from_selection(cls, *, entries: Iterable[dict[str, Any]], selection: dict[str, Any] | None = None) -> "LegalClauseMapAdapter":
        selection = selection or {}
        domain_entries = tuple(entries_from_clause_map_records(entries))
        return cls(
            entries=domain_entries,
            available_entry_count=selection.get("available_entry_count"),
            selected_entry_count=selection.get("selected_entry_count", len(domain_entries)),
            selection_method=selection.get("method"),
            selection_lens=selection.get("selection_lens") if isinstance(selection.get("selection_lens"), dict) else {},
        )

    def map_entries(self) -> Iterable[DomainMapEntry]:
        return self.entries

    def source_map_summary(self) -> dict[str, Any]:
        return {
            "map_type": self.source_map_kind,
            "selection_method": self.selection_method,
            "available_entry_count": self.available_entry_count,
            "selected_entry_count": self.selected_entry_count,
            "selection_lens": self.selection_lens or {},
        }
