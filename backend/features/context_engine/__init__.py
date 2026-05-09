"""Domain-agnostic context coverage engine primitives.

The context engine is intentionally domain-neutral. Domain packs (legal,
accounting, etc.) provide map entries and target metadata; the shared ledger
tracks bounded evidence passes, accepted/rejected chunks, unresolved frontier,
and sufficiency signals.
"""

from .schemas import (
    CoverageLedgerSnapshot,
    CoveragePassSnapshot,
    CoverageTargetSnapshot,
    DomainMapEntry,
    EvidenceRecord,
    SourceSpan,
)
from .ledger import CoverageLedger

__all__ = [
    "CoverageLedger",
    "CoverageLedgerSnapshot",
    "CoveragePassSnapshot",
    "CoverageTargetSnapshot",
    "DomainMapEntry",
    "EvidenceRecord",
    "SourceSpan",
]
