from __future__ import annotations

from features.context_engine.ledger import CoverageLedger
from features.context_engine.schemas import DomainMapEntry, EvidenceRecord, SourceSpan
from features.domains.legal.context_adapter import LegalClauseMapAdapter, entries_from_clause_map_records


def test_coverage_ledger_tracks_accepted_and_rejected_evidence_without_domain_terms():
    entries = [
        DomainMapEntry(
            entry_id="target_a",
            entry_type="generic_entry",
            title="Target A",
            source_spans=(SourceSpan(file_id="f", chunk_id="ch_1", chunk_index=1),),
        )
    ]
    ledger = CoverageLedger.from_entries(
        domain="test_domain",
        workflow_id="test_workflow",
        entries=entries,
        source_map_kind="test_map",
        max_chunks_per_pass=24,
    )

    accepted = EvidenceRecord(file_id="f", chunk_id="ch_1", chunk_index=1, target_ids=("target_a",), source_kind="map")
    rejected = EvidenceRecord(file_id="f", chunk_id="ch_2", chunk_index=2, target_ids=("target_a",), verdict="rejected", reason="low relevance")
    ledger.record_pass(
        pass_type="source_map_fetch",
        frontier_target_ids=["target_a"],
        candidates=[accepted, rejected],
        accepted=[accepted],
        rejected=[rejected],
        decision="covered",
        reason="test pass",
    )

    payload = ledger.to_dict()
    assert payload["domain"] == "test_domain"
    assert payload["pass_count"] == 1
    assert payload["targets"]["target_a"]["status"] == "covered"
    assert "f:ch_1" in payload["targets"]["target_a"]["accepted_evidence"]
    assert "f:ch_2" in payload["targets"]["target_a"]["rejected_evidence"]


def test_legal_adapter_maps_clause_entries_into_domain_map_entries():
    clause_entries = [
        {
            "entry_id": "liability_limits",
            "title": "Limitation of Liability",
            "normalized_type": "liability_limitations",
            "source_spans": [{"file_id": "f", "chunk_id": "ch_24", "chunk_index": 24}],
            "key_terms": ["Direct Damages Cap"],
        }
    ]

    entries = entries_from_clause_map_records(clause_entries)
    assert entries[0].entry_id == "liability_limits"
    assert entries[0].entry_type == "liability_limitations"
    assert entries[0].source_spans[0].chunk_id == "ch_24"

    adapter = LegalClauseMapAdapter.from_selection(
        entries=clause_entries,
        selection={"method": "nano_model", "available_entry_count": 20, "selected_entry_count": 1},
    )
    assert adapter.domain_id == "legal"
    assert adapter.source_map_summary()["map_type"] == "clause_map"
    assert adapter.source_map_summary()["available_entry_count"] == 20


def test_coverage_ledger_tracks_deferred_frontier_for_later_passes():
    ledger = CoverageLedger.from_entries(
        domain="test_domain",
        workflow_id="test_workflow",
        entries=[DomainMapEntry(entry_id="target_b", entry_type="generic_entry", title="Target B")],
        source_map_kind="test_map",
        max_chunks_per_pass=1,
    )

    deferred = EvidenceRecord(
        file_id="f",
        chunk_id="ch_99",
        chunk_index=99,
        target_ids=("target_b",),
        source_kind="map",
        verdict="deferred",
        reason="per-pass budget",
    )
    ledger.record_pass(
        pass_type="source_map_frontier",
        frontier_target_ids=["target_b"],
        candidates=[deferred],
        accepted=[],
        deferred=[deferred],
        decision="continue",
        reason="not enough pass budget",
    )

    payload = ledger.to_dict()
    assert payload["targets"]["target_b"]["status"] == "partial"
    assert "f:ch_99" in payload["targets"]["target_b"]["deferred_evidence"]
    assert payload["frontier"][0]["target_id"] == "target_b"
    assert payload["passes"][0]["deferred_count"] == 1
