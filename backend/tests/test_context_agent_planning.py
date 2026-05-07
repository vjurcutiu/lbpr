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
