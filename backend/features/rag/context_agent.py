from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable

from core.pii import detokenize_text, tokenize_text
from core.tokenizer import count_tokens
from features.files import service as files_service
from features.files.schemas import FileItem
from features.rag import chunk_store
from features.rag.orchestrator import query_request
from features.rag.schemas import QueryRequest, Source

log = logging.getLogger("rag.context_agent")


@dataclass(frozen=True)
class ContextAgentProfile:
    name: str
    initial_k: int = 4
    followup_k: int = 4
    max_rounds: int = 2
    max_chunks: int = 12
    max_input_tokens: int = 24_000
    neighbor_before: int = 1
    neighbor_after: int = 1


PROFILES: dict[str, ContextAgentProfile] = {
    "default": ContextAgentProfile(name="default"),
    "chat": ContextAgentProfile(name="chat", initial_k=4, followup_k=4, max_rounds=2, max_chunks=12, max_input_tokens=24_000),
    "workflow": ContextAgentProfile(name="workflow", initial_k=6, followup_k=4, max_rounds=2, max_chunks=16, max_input_tokens=32_000),
    "legal": ContextAgentProfile(name="legal", initial_k=8, followup_k=5, max_rounds=3, max_chunks=24, max_input_tokens=48_000, neighbor_before=1, neighbor_after=2),
}


@dataclass
class ContextChunk:
    file_id: str
    chunk_id: str
    chunk_index: int | None
    text: str
    score: float = 0.0
    source: str = "retrieved"
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, str]:
        return (self.file_id, self.chunk_id)


@dataclass
class RetrievalStep:
    step: int
    type: str
    query: str | None = None
    reason: str | None = None
    chunk_ids: list[str] = field(default_factory=list)
    chunks_added: int = 0


@dataclass
class ContextDecision:
    step: int
    stage: str
    decision: str
    rationale: str
    action: str
    observation: str | None = None
    outcome: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ContextBundle:
    query: str
    profile: str
    sufficient: bool
    chunks: list[ContextChunk]
    retrieval_trace: list[RetrievalStep]
    decision_trace: list[ContextDecision] = field(default_factory=list)
    coverage_notes: list[str] = field(default_factory=list)
    missing_context: list[str] = field(default_factory=list)

    def combined_text(self) -> str:
        parts: list[str] = []
        for idx, chunk in enumerate(self.chunks, start=1):
            label = chunk.metadata.get("display_name") or chunk.metadata.get("filename") or chunk.file_id
            parts.append(f"[Source {idx}: {label}, chunk {chunk.chunk_id}]\n{chunk.text}")
        return "\n\n".join(parts).strip()


_STOPWORDS = {
    "about", "after", "again", "against", "also", "between", "could", "first", "from", "have", "into",
    "just", "more", "most", "other", "over", "same", "should", "that", "their", "there", "these", "this",
    "those", "through", "using", "very", "what", "when", "where", "which", "with", "would", "your", "than",
}

_QUERY_EXPANSIONS: list[tuple[tuple[str, ...], str]] = [
    (("termination", "terminate", "expired", "expiration"), "termination for cause convenience cure period post termination obligations survival payment wind down transition"),
    (("liability", "damages", "cap", "consequential"), "limitation of liability liability cap excluded damages consequential damages lost profits carveouts confidentiality indemnity data breach"),
    (("indemnity", "indemnification", "indemnify", "hold harmless"), "indemnification defend indemnify hold harmless third party claims IP infringement defense control settlement exclusions"),
    (("data", "security", "privacy", "breach", "personal information"), "data protection security controls breach incident notice subprocessors audit return destruction personal data confidential information"),
    (("renewal", "renew", "term", "auto-renew"), "term renewal auto renewal non renewal notice expiration initial term renewal term"),
    (("payment", "fees", "invoice", "tax"), "fees payment invoices taxes expenses disputed charges late fees billing supporting documentation"),
    (("ip", "intellectual property", "work product", "deliverables"), "intellectual property ownership work product deliverables license pre-existing materials third party materials"),
    (("audit", "inspect", "certification", "soc"), "audit inspection SOC report certification records security audit compliance verification"),
    (("insurance", "coverage", "policy"), "insurance coverage policy certificate additional insured workers compensation cyber professional liability"),
    (("assignment", "change of control", "assign"), "assignment change of control transfer merger acquisition consent notice successor"),
    (("governing law", "venue", "jurisdiction", "dispute"), "governing law jurisdiction venue dispute resolution arbitration courts injunctive relief"),
]


def get_profile(name: str | None) -> ContextAgentProfile:
    return PROFILES.get(str(name or "").strip().lower() or "default", PROFILES["default"])


def _dataset_for_file(uid: str, file_item: FileItem) -> str:
    try:
        meta = files_service._get_blob_metadata(uid, file_item.id)  # type: ignore[attr-defined]
    except Exception:
        return "default"
    dataset = str((meta or {}).get("dataset") or "default").strip()
    return dataset or "default"


def _chunk_index_from_id(chunk_id: str) -> int | None:
    match = re.search(r"(\d+)$", str(chunk_id or ""))
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _source_to_context_chunk(uid: str, source: Source, *, file_lookup: dict[str, FileItem]) -> ContextChunk | None:
    meta = dict(source.metadata or {})
    file_id = str(meta.get("file_id") or source.doc_id or "")
    if not file_id:
        return None
    text = chunk_store.normalize_text(detokenize_text(uid, str(source.text or "")))
    if not text:
        return None
    display_name = meta.get("display_name") or meta.get("filename")
    if file_id in file_lookup:
        display_name = display_name or file_lookup[file_id].original_name or file_lookup[file_id].name
    return ContextChunk(
        file_id=file_id,
        chunk_id=str(source.chunk_id or ""),
        chunk_index=_chunk_index_from_id(str(source.chunk_id or "")),
        text=text,
        score=float(source.score or 0.0),
        source="retrieved",
        metadata={**meta, "display_name": detokenize_text(uid, str(display_name or file_id))},
    )


def _stored_to_context_chunk(stored: chunk_store.StoredChunk, *, source: str = "neighbor") -> ContextChunk:
    metadata = dict(stored.metadata or {})
    return ContextChunk(
        file_id=stored.file_id,
        chunk_id=stored.chunk_id,
        chunk_index=stored.chunk_index,
        text=stored.text,
        score=0.0,
        source=source,
        metadata=metadata,
    )


def _add_chunks(selected: list[ContextChunk], seen: set[tuple[str, str]], candidates: Iterable[ContextChunk], *, max_chunks: int) -> list[ContextChunk]:
    added: list[ContextChunk] = []
    for chunk in candidates:
        if not chunk.text.strip():
            continue
        key = chunk.key
        if key in seen:
            continue
        seen.add(key)
        selected.append(chunk)
        added.append(chunk)
        if len(selected) >= max_chunks:
            break
    return added


def _token_terms(text: str) -> list[str]:
    terms: list[str] = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text or ""):
        lowered = token.lower()
        if lowered not in _STOPWORDS:
            terms.append(lowered)
    return terms


def _has_direct_signal(query: str, chunks: list[ContextChunk]) -> bool:
    terms = _token_terms(query)
    if not terms or not chunks:
        return bool(chunks)
    joined = "\n".join(chunk.text.lower() for chunk in chunks[: min(6, len(chunks))])
    hits = sum(1 for term in terms[:12] if term in joined)
    return hits >= min(3, max(1, len(terms[:12]) // 3))


def _direct_signal_snapshot(query: str, chunks: list[ContextChunk]) -> dict[str, Any]:
    terms = _token_terms(query)[:12]
    if not terms:
        return {
            "terms_checked": [],
            "matched_terms": [],
            "hit_count": 0,
            "threshold": 0,
            "sufficient": bool(chunks),
        }
    joined = "\n".join(chunk.text.lower() for chunk in chunks[: min(6, len(chunks))])
    matched_terms = [term for term in terms if term in joined]
    threshold = min(3, max(1, len(terms) // 3))
    return {
        "terms_checked": terms,
        "matched_terms": matched_terms,
        "hit_count": len(matched_terms),
        "threshold": threshold,
        "sufficient": len(matched_terms) >= threshold,
    }


def _expansion_queries(query: str, existing: list[str]) -> list[str]:
    lowered = (query or "").lower()
    expansions: list[str] = []
    for triggers, expansion in _QUERY_EXPANSIONS:
        if any(trigger in lowered for trigger in triggers):
            expansions.append(expansion)
    if not expansions:
        terms = _token_terms(query)
        if terms:
            expansions.append(" ".join(terms[:10]))
    seen = {item.strip().lower() for item in existing if item.strip()}
    out: list[str] = []
    for item in expansions:
        key = item.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(item)
    return out[:2]


def _trim_to_token_budget(chunks: list[ContextChunk], max_tokens: int) -> list[ContextChunk]:
    if max_tokens <= 0:
        return chunks
    kept: list[ContextChunk] = []
    total = 0
    # Preserve original order while preferring retrieved chunks before neighbors when trimming.
    ranked = sorted(enumerate(chunks), key=lambda item: (item[1].source != "retrieved", -item[1].score, item[0]))
    selected_indices: set[int] = set()
    for idx, chunk in ranked:
        cost = max(1, count_tokens(chunk.text))
        if kept and total + cost > max_tokens:
            continue
        total += cost
        selected_indices.add(idx)
        if total >= max_tokens:
            break
    return [chunk for idx, chunk in enumerate(chunks) if idx in selected_indices]


def _query_dataset(uid: str, *, dataset: str, query: str, files: list[FileItem], k: int) -> list[ContextChunk]:
    tokenized_query = tokenize_text(uid, query)
    try:
        resp = query_request(
            QueryRequest(
                dataset=dataset,
                query=tokenized_query,
                k=k,
                with_sources=True,
                per_doc=False,
                doc_ids=[item.id for item in files],
            ),
            uid=uid,
        )
    except Exception:
        log.warning("context_agent_query_failed", uid=uid, dataset=dataset, exc_info=True)
        return []
    lookup = {item.id: item for item in files}
    chunks: list[ContextChunk] = []
    for source in resp.sources or []:
        chunk = _source_to_context_chunk(uid, source, file_lookup=lookup)
        if chunk is not None:
            chunks.append(chunk)
    return chunks


def _retrieve(uid: str, *, files_by_dataset: dict[str, list[FileItem]], query: str, k: int) -> list[ContextChunk]:
    out: list[ContextChunk] = []
    for dataset, files in files_by_dataset.items():
        out.extend(_query_dataset(uid, dataset=dataset, query=query, files=files, k=k))
    out.sort(key=lambda item: item.score, reverse=True)
    return out


def _neighbor_expansion(uid: str, *, selected: list[ContextChunk], files_by_id: dict[str, FileItem], profile: ContextAgentProfile) -> list[ContextChunk]:
    by_file: dict[str, list[str]] = defaultdict(list)
    for chunk in selected:
        if chunk.file_id and chunk.chunk_id and chunk.file_id in files_by_id:
            by_file[chunk.file_id].append(chunk.chunk_id)
    expanded: list[ContextChunk] = []
    for file_id, chunk_ids in by_file.items():
        file_item = files_by_id[file_id]
        try:
            neighbors = chunk_store.get_neighbor_chunks(
                uid,
                file_item,
                chunk_ids=chunk_ids,
                before=profile.neighbor_before,
                after=profile.neighbor_after,
            )
        except Exception:
            log.debug("context_agent_neighbors_failed", uid=uid, file_id=file_id, exc_info=True)
            continue
        expanded.extend(_stored_to_context_chunk(item, source="neighbor") for item in neighbors)
    expanded.sort(key=lambda item: (item.file_id, item.chunk_index if item.chunk_index is not None else 10**9))
    return expanded


def build_context_bundle(
    *,
    uid: str,
    files: list[FileItem],
    query: str,
    profile: str = "default",
) -> ContextBundle:
    """Build an adaptive source context bundle.

    v1 uses deterministic sufficiency heuristics: start with hybrid search,
    expand around high-signal chunks, then run one or two targeted follow-up
    queries only when the initial context looks insufficient.

    The returned ``decision_trace`` is intentionally a concise, observable
    rationale log. It explains what the context agent did and why without
    attempting to expose hidden model chain-of-thought.
    """
    active_profile = get_profile(profile)
    clean_query = str(query or "").strip()
    decisions: list[ContextDecision] = []

    def add_decision(
        *,
        stage: str,
        decision: str,
        rationale: str,
        action: str,
        observation: str | None = None,
        outcome: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        decisions.append(
            ContextDecision(
                step=len(decisions) + 1,
                stage=stage,
                decision=decision,
                rationale=rationale,
                action=action,
                observation=observation,
                outcome=outcome,
                metadata=metadata or {},
            )
        )

    add_decision(
        stage="planning",
        decision=f"Use the '{active_profile.name}' context profile",
        rationale="The profile sets the initial search size, expansion limits, neighbor policy, and token budget for this run.",
        action="Configure adaptive retrieval before searching",
        metadata={
            "initial_k": active_profile.initial_k,
            "followup_k": active_profile.followup_k,
            "max_rounds": active_profile.max_rounds,
            "max_chunks": active_profile.max_chunks,
            "max_input_tokens": active_profile.max_input_tokens,
            "neighbor_before": active_profile.neighbor_before,
            "neighbor_after": active_profile.neighbor_after,
        },
    )

    if not clean_query or not files:
        add_decision(
            stage="planning",
            decision="Stop before retrieval",
            rationale="Adaptive retrieval requires both a non-empty query and at least one selected file.",
            action="Return an empty context bundle",
            observation=f"query_present={bool(clean_query)}; file_count={len(files)}",
            outcome="No context was selected.",
        )
        return ContextBundle(
            query=clean_query,
            profile=active_profile.name,
            sufficient=False,
            chunks=[],
            retrieval_trace=[],
            decision_trace=decisions,
            missing_context=["No query or files provided."],
        )

    files_by_dataset: dict[str, list[FileItem]] = defaultdict(list)
    files_by_id = {item.id: item for item in files}
    for file_item in files:
        files_by_dataset[_dataset_for_file(uid, file_item)].append(file_item)

    add_decision(
        stage="planning",
        decision="Group selected files by vector dataset",
        rationale="Retrieval must query the dataset that each uploaded file was indexed into.",
        action="Build dataset-specific file groups",
        observation=f"{len(files)} file(s) selected across {len(files_by_dataset)} dataset(s).",
        metadata={"datasets": {dataset: len(items) for dataset, items in files_by_dataset.items()}},
    )

    selected: list[ContextChunk] = []
    seen: set[tuple[str, str]] = set()
    trace: list[RetrievalStep] = []
    queried = [clean_query]

    initial = _retrieve(uid, files_by_dataset=files_by_dataset, query=clean_query, k=active_profile.initial_k)
    added = _add_chunks(selected, seen, initial, max_chunks=active_profile.max_chunks)
    trace.append(RetrievalStep(step=1, type="initial_search", query=clean_query, chunk_ids=[item.chunk_id for item in added], chunks_added=len(added)))
    add_decision(
        stage="initial_search",
        decision="Search for the first evidence set",
        rationale="Start with the user/workflow query rather than loading all chunks, so simple questions stay small and reviewable.",
        action="Run semantic search for the initial query",
        observation=f"Requested up to {active_profile.initial_k} hit(s) per dataset.",
        outcome=f"Added {len(added)} new chunk(s).",
        metadata={"query": clean_query, "chunk_ids": [item.chunk_id for item in added], "candidate_count": len(initial)},
    )

    # Always expand direct neighbors once, because legal and business clauses often span chunk boundaries.
    neighbors = _neighbor_expansion(uid, selected=selected, files_by_id=files_by_id, profile=active_profile)
    added_neighbors = _add_chunks(selected, seen, neighbors, max_chunks=active_profile.max_chunks)
    if added_neighbors:
        trace.append(RetrievalStep(step=len(trace) + 1, type="neighbor_expansion", reason="Adjacent chunks around retrieved hits", chunk_ids=[item.chunk_id for item in added_neighbors], chunks_added=len(added_neighbors)))
    add_decision(
        stage="neighbor_expansion",
        decision="Pull adjacent context around initial hits",
        rationale="Important contract language often starts before a matching chunk or continues after it.",
        action="Fetch neighboring chunks around retrieved hits",
        observation=f"Neighbor window: {active_profile.neighbor_before} before / {active_profile.neighbor_after} after.",
        outcome=f"Added {len(added_neighbors)} adjacent chunk(s).",
        metadata={"chunk_ids": [item.chunk_id for item in added_neighbors], "candidate_count": len(neighbors)},
    )

    signal = _direct_signal_snapshot(clean_query, selected)
    sufficient = bool(signal.get("sufficient"))
    add_decision(
        stage="sufficiency_check",
        decision="Check whether selected context directly matches the task",
        rationale="The agent only stops early when the gathered context contains enough direct signal for the query.",
        action="Compare query terms against the selected context",
        observation=f"Matched {signal.get('hit_count', 0)} of {len(signal.get('terms_checked', []))} checked term(s); threshold {signal.get('threshold', 0)}.",
        outcome="Context marked sufficient." if sufficient else "Context marked incomplete; expansion may be needed.",
        metadata=signal,
    )

    round_no = 0
    while not sufficient and round_no < active_profile.max_rounds and len(selected) < active_profile.max_chunks:
        round_no += 1
        expansions = _expansion_queries(clean_query, queried)
        if not expansions:
            add_decision(
                stage="expansion",
                decision="Do not run a targeted query",
                rationale="No new domain expansion query could be derived from the request.",
                action="Stop expansion loop",
                outcome="No additional context was requested.",
            )
            break
        any_added = False
        for expansion_query in expansions:
            queried.append(expansion_query)
            candidates = _retrieve(uid, files_by_dataset=files_by_dataset, query=expansion_query, k=active_profile.followup_k)
            added_candidates = _add_chunks(selected, seen, candidates, max_chunks=active_profile.max_chunks)
            if added_candidates:
                any_added = True
            trace.append(RetrievalStep(step=len(trace) + 1, type="targeted_query", query=expansion_query, reason="Initial context did not contain enough direct signal", chunk_ids=[item.chunk_id for item in added_candidates], chunks_added=len(added_candidates)))
            add_decision(
                stage="targeted_query",
                decision="Search for missing related evidence",
                rationale="The first sufficiency check did not find enough direct signal, so the agent used domain expansion terms tied to the task.",
                action="Run targeted semantic search",
                observation=f"Expansion round {round_no}; requested up to {active_profile.followup_k} hit(s) per dataset.",
                outcome=f"Added {len(added_candidates)} new chunk(s).",
                metadata={"query": expansion_query, "chunk_ids": [item.chunk_id for item in added_candidates], "candidate_count": len(candidates)},
            )

        if len(selected) < active_profile.max_chunks:
            neighbors = _neighbor_expansion(uid, selected=selected, files_by_id=files_by_id, profile=active_profile)
            added_neighbors = _add_chunks(selected, seen, neighbors, max_chunks=active_profile.max_chunks)
            if added_neighbors:
                any_added = True
                trace.append(RetrievalStep(step=len(trace) + 1, type="neighbor_expansion", reason="Adjacent chunks around targeted hits", chunk_ids=[item.chunk_id for item in added_neighbors], chunks_added=len(added_neighbors)))
            add_decision(
                stage="neighbor_expansion",
                decision="Pull adjacent context around targeted hits",
                rationale="Targeted evidence can also be split across neighboring chunks.",
                action="Fetch neighboring chunks after targeted retrieval",
                observation=f"Expansion round {round_no}.",
                outcome=f"Added {len(added_neighbors)} adjacent chunk(s).",
                metadata={"chunk_ids": [item.chunk_id for item in added_neighbors], "candidate_count": len(neighbors)},
            )

        signal = _direct_signal_snapshot(clean_query, selected)
        sufficient = bool(signal.get("sufficient"))
        add_decision(
            stage="sufficiency_check",
            decision="Re-check context sufficiency after expansion",
            rationale="The agent should stop expanding once it has enough direct evidence or when expansion stops producing useful new chunks.",
            action="Evaluate selected chunks after expansion",
            observation=f"Matched {signal.get('hit_count', 0)} of {len(signal.get('terms_checked', []))} checked term(s); threshold {signal.get('threshold', 0)}.",
            outcome="Context marked sufficient." if sufficient else "Context still marked incomplete.",
            metadata=signal,
        )
        if not any_added:
            add_decision(
                stage="stopping",
                decision="Stop expansion because no new chunks were added",
                rationale="Repeating searches that add no new evidence is unlikely to improve the context and can add noise.",
                action="Exit expansion loop",
                observation=f"Expansion round {round_no} produced no unique chunks.",
                outcome="Context remains incomplete." if not sufficient else "Context is sufficient.",
            )
            break

    before_trim_count = len(selected)
    selected = _trim_to_token_budget(selected, active_profile.max_input_tokens)
    if len(selected) != before_trim_count:
        add_decision(
            stage="budgeting",
            decision="Trim context to fit the input token budget",
            rationale="The final workflow prompt must stay inside the configured input budget.",
            action="Keep the most relevant retrieved chunks while preserving source order",
            observation=f"Selected chunks reduced from {before_trim_count} to {len(selected)}.",
            outcome="Context was trimmed before generation.",
            metadata={"max_input_tokens": active_profile.max_input_tokens},
        )

    coverage_notes: list[str] = []
    if selected:
        coverage_notes.append(f"Adaptive context selected {len(selected)} chunk(s) using profile '{active_profile.name}'.")
    else:
        coverage_notes.append("Adaptive context retrieval found no matching chunks.")
    if len(selected) >= active_profile.max_chunks:
        coverage_notes.append("Context selection reached the configured chunk limit.")

    stop_reason = "Context marked sufficient." if sufficient else "Retrieved context may be incomplete for the question."
    if round_no >= active_profile.max_rounds and not sufficient:
        stop_reason = "Reached the configured expansion round limit before sufficiency was reached."
    elif len(selected) >= active_profile.max_chunks and not sufficient:
        stop_reason = "Reached the configured chunk limit before sufficiency was reached."
    add_decision(
        stage="stopping",
        decision="Finalize context bundle",
        rationale="The workflow synthesis step can now use the selected evidence, with sufficiency and missing-context flags preserved for eval review.",
        action="Return selected context and trace metadata",
        observation=f"{len(selected)} chunk(s), {len(trace)} retrieval turn(s).",
        outcome=stop_reason,
        metadata={"sufficient": sufficient, "selected_chunks": len(selected), "retrieval_turns": len(trace)},
    )

    missing_context = [] if sufficient else [stop_reason]
    return ContextBundle(
        query=clean_query,
        profile=active_profile.name,
        sufficient=sufficient,
        chunks=selected,
        retrieval_trace=trace,
        decision_trace=decisions,
        coverage_notes=coverage_notes,
        missing_context=missing_context,
    )
