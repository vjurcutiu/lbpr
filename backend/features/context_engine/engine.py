from __future__ import annotations

from typing import Iterable, Protocol

from .ledger import CoverageLedger
from .schemas import DomainMapEntry


class DomainAdapter(Protocol):
    """Protocol implemented by domain packs that plug into the context engine."""

    domain_id: str
    source_map_kind: str

    def map_entries(self) -> Iterable[DomainMapEntry]:
        ...

    def source_map_summary(self) -> dict:
        ...


def create_ledger_from_adapter(
    *,
    adapter: DomainAdapter,
    workflow_id: str | None,
    max_chunks_per_pass: int = 24,
) -> CoverageLedger:
    return CoverageLedger.from_entries(
        domain=adapter.domain_id,
        workflow_id=workflow_id,
        entries=adapter.map_entries(),
        source_map_kind=adapter.source_map_kind,
        max_chunks_per_pass=max_chunks_per_pass,
        source_map_summary=adapter.source_map_summary(),
    )
