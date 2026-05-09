from __future__ import annotations

from features.rag.context_agent import (
    ContextChunk,
    _build_search_plan,
    _clause_map_signal_snapshot,
    _topic_coverage_snapshot,
    get_profile,
)


def test_legal_contract_review_rewrites_launcher_settings_to_substantive_query():
    plan = _build_search_plan(
        "Workflow settings: Deal stage: Not specified; Audience: Business owner.",
        profile=get_profile("legal"),
        workflow_id="legal_contract_review",
    )

    assert "workflow settings" not in plan.search_query.lower()
    assert "liability" in plan.search_query.lower()
    assert "termination" in plan.search_query.lower()
    assert "confidentiality" in plan.search_query.lower()
    assert plan.required_topics
    assert plan.min_required_topics >= 6


def test_legal_topic_coverage_requires_substantive_contract_topics():
    plan = _build_search_plan(
        "Workflow settings: Deal stage: Not specified; Audience: Business owner.",
        profile=get_profile("legal"),
        workflow_id="legal_contract_review",
    )
    chunks = [
        ContextChunk(file_id="f", chunk_id="ch_1", chunk_index=1, text="The business owner reviewed the workflow stage."),
    ]

    signal = _topic_coverage_snapshot(plan, chunks)

    assert signal["coverage_mode"] == "legal_topics"
    assert signal["sufficient"] is False
    assert signal["covered_count"] == 0
    assert signal["missing_topics"]


def test_legal_topic_coverage_marks_broad_contract_evidence_sufficient():
    plan = _build_search_plan(
        "Workflow settings: Deal stage: Not specified; Audience: Business owner.",
        profile=get_profile("legal"),
        workflow_id="legal_contract_review",
    )
    text = " ".join(
        [
            "The term renews annually and either party may terminate after a cure period.",
            "Fees are invoiced monthly and disputed charges follow the payment process.",
            "Confidential information and data security controls include encryption and breach notice.",
            "The limitation of liability excludes consequential damages and indemnification applies.",
            "Intellectual property ownership and license rights are allocated between the parties.",
            "Service levels, warranties, performance standards, and acceptance remedies apply.",
        ]
    )
    chunks = [ContextChunk(file_id="f", chunk_id="ch_1", chunk_index=1, text=text)]

    signal = _topic_coverage_snapshot(plan, chunks)

    assert signal["sufficient"] is True
    assert signal["covered_count"] >= plan.min_required_topics


def test_clause_map_signal_is_sufficient_when_entries_have_anchored_chunks():
    entries = [
        {
            "entry_id": "limitation_of_liability",
            "title": "Limitation of Liability",
            "source_spans": [{"file_id": "f", "chunk_id": "ch_1", "chunk_index": 1}],
        }
    ]
    chunks = [ContextChunk(file_id="f", chunk_id="ch_1", chunk_index=1, text="Liability is capped at amounts paid.", source="clause_map")]

    signal = _clause_map_signal_snapshot(entries, chunks)

    assert signal["coverage_mode"] == "clause_map"
    assert signal["sufficient"] is True
    assert signal["selected_entry_count"] == 1
    assert signal["selected_chunk_count"] == 1

from features.rag.context_agent import _merge_clause_entries_for_frontier, _query_quality_for_chunk


def test_legal_frontier_merges_available_entries_after_initial_selection():
    selected = [{"entry_id": "payment", "source_spans": [{"file_id": "f", "chunk_id": "ch_1"}]}]
    selection = {
        "available_entries": [
            {"entry_id": "payment", "source_spans": [{"file_id": "f", "chunk_id": "ch_1"}]},
            {"entry_id": "termination", "source_spans": [{"file_id": "f", "chunk_id": "ch_2"}]},
        ]
    }
    frontier = _merge_clause_entries_for_frontier(selected, selection)
    assert [item["entry_id"] for item in frontier] == ["payment", "termination"]
    assert frontier[0]["_frontier_origin"] == "selected"
    assert frontier[1]["_frontier_origin"] == "available"


def test_query_quality_rejects_low_signal_reference_candidates():
    good = ContextChunk(file_id="f", chunk_id="ch_1", chunk_index=1, text="EXHIBIT K: NCQA Requirements and responsibilities apply.", score=0.2)
    bad = ContextChunk(file_id="f", chunk_id="ch_2", chunk_index=2, text="The parties discuss unrelated confidentiality terms.", score=0.9)

    good_quality, _, good_hits = _query_quality_for_chunk("Exhibit K", good)
    bad_quality, _, bad_hits = _query_quality_for_chunk("Exhibit K", bad)

    assert good_quality == "strong"
    assert "exhibit k" in good_hits
    assert bad_quality in {"weak", "irrelevant"}
