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


@dataclass(frozen=True)
class ContextTopic:
    key: str
    label: str
    terms: tuple[str, ...]
    expansion_query: str


@dataclass(frozen=True)
class ContextSearchPlan:
    original_query: str
    search_query: str
    sufficiency_query: str
    question_type: str
    required_topics: tuple[ContextTopic, ...] = ()
    min_required_topics: int = 0
    user_signal: str = ""
    planning_mode: str = "query_first"


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

_LEGAL_CONTRACT_REVIEW_TOPICS: tuple[ContextTopic, ...] = (
    ContextTopic(
        key="term_termination_renewal",
        label="term, termination, and renewal",
        terms=("term", "termination", "terminate", "renewal", "expiration", "cure", "notice period"),
        expansion_query="term termination renewal expiration cure period notice post termination survival transition assistance",
    ),
    ContextTopic(
        key="payment_commercial_terms",
        label="payment and commercial terms",
        terms=("payment", "fees", "invoice", "invoices", "tax", "billing", "charges", "expenses"),
        expansion_query="payment fees invoices taxes billing disputed charges expenses payment terms",
    ),
    ContextTopic(
        key="confidentiality_data_security",
        label="confidentiality, data protection, and security",
        terms=("confidential", "confidentiality", "data", "security", "privacy", "encryption", "breach", "personal information"),
        expansion_query="confidentiality data protection privacy security encryption breach incident notice personal information protected data",
    ),
    ContextTopic(
        key="liability_indemnity",
        label="liability, damages, and indemnity",
        terms=("liability", "damages", "consequential", "indemnity", "indemnification", "indemnify", "hold harmless", "cap"),
        expansion_query="limitation of liability damages cap consequential damages indemnity indemnification defend hold harmless carveouts",
    ),
    ContextTopic(
        key="ip_ownership_license",
        label="IP ownership and license rights",
        terms=("intellectual property", "ip", "ownership", "work product", "deliverables", "license", "materials"),
        expansion_query="intellectual property IP ownership work product deliverables license background materials third party materials",
    ),
    ContextTopic(
        key="performance_warranties_slas",
        label="performance, warranties, and service levels",
        terms=("warranty", "warranties", "service level", "sla", "performance", "acceptance", "deficiency", "remedy"),
        expansion_query="warranties service levels SLA performance acceptance testing deficiencies remedies service credits",
    ),
    ContextTopic(
        key="audit_insurance_compliance",
        label="audit, insurance, and compliance controls",
        terms=("audit", "inspect", "records", "insurance", "coverage", "compliance", "certification", "certificate"),
        expansion_query="audit inspection records insurance coverage certificates compliance security audit certification",
    ),
    ContextTopic(
        key="assignment_change_control",
        label="assignment, subcontracting, and change control",
        terms=("assignment", "assign", "subcontract", "subcontractor", "change control", "change of control", "consent"),
        expansion_query="assignment change of control subcontractor subcontracting consent third party access change control approval",
    ),
    ContextTopic(
        key="dispute_law_notices",
        label="dispute resolution, governing law, and notices",
        terms=("dispute", "arbitration", "governing law", "jurisdiction", "venue", "notices", "notice", "injunctive"),
        expansion_query="dispute resolution arbitration governing law jurisdiction venue notices notice injunctive relief courts",
    ),
)

_LEGAL_WORKFLOW_TOPICS: dict[str, tuple[ContextTopic, ...]] = {
    "legal_contract_review": _LEGAL_CONTRACT_REVIEW_TOPICS,
    "legal_msa_review": _LEGAL_CONTRACT_REVIEW_TOPICS,
    "legal_contract_risk_matrix": tuple(
        topic for topic in _LEGAL_CONTRACT_REVIEW_TOPICS
        if topic.key in {"term_termination_renewal", "confidentiality_data_security", "liability_indemnity", "payment_commercial_terms", "performance_warranties_slas"}
    ),
}

_LEGAL_WORKFLOW_SEARCH_QUERIES: dict[str, str] = {
    "legal_contract_review": (
        "contract review key terms obligations risks missing protections approval issues "
        "liability indemnity termination renewal confidentiality data security payment fees IP ownership "
        "audit insurance assignment subcontracting warranties service levels dispute resolution governing law notices"
    ),
    "legal_contract_risk_matrix": (
        "contract risk matrix severity business impact approval exceptions liability indemnity termination data security "
        "payment obligations warranties service levels recommended fixes fallback positions"
    ),
    "legal_nda_review": (
        "NDA review confidentiality scope exclusions residual knowledge term return destruction remedies injunctive relief "
        "mutuality non solicit non compete assignment governing law disclosure obligations"
    ),
    "legal_msa_review": (
        "MSA services agreement review scope SOW payment fees liability indemnity IP ownership data protection security "
        "SLAs warranties service levels termination renewal audit insurance assignment dispute resolution"
    ),
    "legal_clause_extraction": (
        "contract clause extraction confidentiality indemnity limitation liability termination renewal IP ownership data protection "
        "payment assignment audit insurance warranties dispute resolution notices obligations deadlines"
    ),
    "legal_fallback_language": (
        "fallback clause language target issue preferred position negotiation comment liability indemnity confidentiality data security "
        "termination payment IP ownership fallback ladder"
    ),
    "legal_negotiation_brief": (
        "negotiation brief must have changes nice to have changes acceptable fallbacks escalation issues liability indemnity "
        "termination data security payment IP ownership suggested comments"
    ),
    "legal_obligation_tracker": (
        "contract obligations tracker responsible party deadlines triggers renewal notice payment reporting data security audit "
        "subcontractor compliance termination post signature obligations"
    ),
    "legal_matter_handoff": (
        "matter handoff contract status key decisions open issues risks deadlines approvals next steps legal business context"
    ),
}

_WORKFLOW_SETTINGS_RE = re.compile(r"(?:^|\n)\s*Workflow settings:\s*.*?(?=\n\s*\n|\Z)", re.IGNORECASE | re.DOTALL)
_USER_FOCUS_PREFIX_RE = re.compile(r"^\s*(?:Matter context|Review focus|Matrix focus|Instructions|User focus):\s*", re.IGNORECASE)


def get_profile(name: str | None) -> ContextAgentProfile:
    return PROFILES.get(str(name or "").strip().lower() or "default", PROFILES["default"])


def _meaningful_query_fragment(query: str) -> str:
    """Keep user-supplied retrieval signal while dropping launcher bookkeeping."""
    clean = str(query or "").strip()
    if not clean:
        return ""
    clean = _WORKFLOW_SETTINGS_RE.sub("\n", clean)
    fragments: list[str] = []
    for part in re.split(r"\n\s*\n|\n", clean):
        fragment = _USER_FOCUS_PREFIX_RE.sub("", part).strip(" .\t")
        if not fragment:
            continue
        lowered = fragment.lower()
        if lowered.startswith("workflow settings:"):
            continue
        fragments.append(fragment)
    return " ".join(fragments).strip()


def _dedupe_query_terms(text: str) -> str:
    # Preserve original order but avoid repeating the same term-heavy workflow defaults.
    seen: set[str] = set()
    out: list[str] = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]*", text or ""):
        key = token.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(token)
    return " ".join(out)


def _build_search_plan(query: str, *, profile: ContextAgentProfile, workflow_id: str | None = None) -> ContextSearchPlan:
    original_query = str(query or "").strip()
    workflow_key = str(workflow_id or "").strip()
    user_signal = _meaningful_query_fragment(original_query)
    workflow_query = _LEGAL_WORKFLOW_SEARCH_QUERIES.get(workflow_key, "") if profile.name == "legal" else ""

    if workflow_query:
        combined = f"{workflow_query} {user_signal}" if user_signal else workflow_query
        search_query = _dedupe_query_terms(combined)
        topics = _LEGAL_WORKFLOW_TOPICS.get(workflow_key, ())
        min_topics = 0
        if topics:
            # Broad legal reviews do not need every topic to be present, but they should
            # show coverage across several substantive legal areas before stopping.
            min_topics = min(len(topics), 5 if workflow_key == "legal_contract_risk_matrix" else 6)
        return ContextSearchPlan(
            original_query=original_query,
            search_query=search_query,
            sufficiency_query=workflow_query,
            question_type=workflow_key or "legal_workflow",
            required_topics=topics,
            min_required_topics=min_topics,
            user_signal=user_signal,
        )

    fallback_query = user_signal or original_query
    return ContextSearchPlan(
        original_query=original_query,
        search_query=fallback_query,
        sufficiency_query=fallback_query,
        question_type=workflow_key or profile.name,
        user_signal=user_signal,
    )


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


def _entry_display_text(entry: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("title", "normalized_type", "summary", "source_excerpt"):
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    for key in ("key_terms", "obligations", "risk_signals", "cross_references"):
        values = entry.get(key)
        if isinstance(values, list):
            parts.extend(str(item).strip() for item in values if str(item).strip())
    return "\n".join(parts)


def _selected_clause_entry_records(clause_map_entries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for entry in clause_map_entries or []:
        if not isinstance(entry, dict):
            continue
        records.append({
            "clause_map_id": entry.get("clause_map_id"),
            "entry_id": entry.get("entry_id"),
            "entry_kind": entry.get("entry_kind"),
            "source_file_id": entry.get("source_file_id"),
            "source_name": entry.get("source_name"),
            "title": entry.get("title"),
            "normalized_type": entry.get("normalized_type"),
            "clause_family": entry.get("clause_family"),
            "status": entry.get("status"),
            "confidence": entry.get("confidence"),
            "summary": entry.get("summary"),
            "key_terms": entry.get("key_terms") or [],
            "obligations": entry.get("obligations") or [],
            "risk_signals": entry.get("risk_signals") or [],
            "cross_references": entry.get("cross_references") or [],
            "source_spans": entry.get("source_spans") or [],
        })
    return records


def _chunks_from_clause_map_entries(
    uid: str,
    *,
    entries: list[dict[str, Any]],
    files_by_id: dict[str, FileItem],
) -> list[ContextChunk]:
    by_file: dict[str, set[str]] = defaultdict(set)
    entry_by_chunk: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        for span in entry.get("source_spans") or []:
            if not isinstance(span, dict):
                continue
            file_id = str(span.get("file_id") or entry.get("source_file_id") or "").strip()
            chunk_id = str(span.get("chunk_id") or "").strip()
            if not file_id or not chunk_id:
                continue
            by_file[file_id].add(chunk_id)
            entry_by_chunk[(file_id, chunk_id)].append(entry)

    chunks: list[ContextChunk] = []
    for file_id, chunk_ids in by_file.items():
        file_item = files_by_id.get(file_id)
        if file_item is None:
            continue
        for stored in chunk_store.get_chunks_by_ids(uid, file_item, chunk_ids):
            entries_for_chunk = entry_by_chunk.get((file_id, stored.chunk_id), [])
            metadata = dict(stored.metadata or {})
            if file_item.original_name or file_item.name:
                metadata.setdefault("display_name", file_item.original_name or file_item.name)
            metadata["clause_map_entries"] = [
                {
                    "entry_id": item.get("entry_id"),
                    "title": item.get("title"),
                    "normalized_type": item.get("normalized_type"),
                    "clause_family": item.get("clause_family"),
                }
                for item in entries_for_chunk
            ]
            chunks.append(ContextChunk(
                file_id=file_id,
                chunk_id=stored.chunk_id,
                chunk_index=stored.chunk_index,
                text=stored.text,
                score=1.0,
                source="clause_map",
                metadata=metadata,
            ))
    chunks.sort(key=lambda item: (item.file_id, item.chunk_index if item.chunk_index is not None else 10**9))
    return chunks


def _reference_queries_from_entries(entries: list[dict[str, Any]], chunks: list[ContextChunk]) -> list[str]:
    text = "\n".join([_entry_display_text(entry) for entry in entries] + [chunk.text for chunk in chunks])
    queries: list[str] = []
    refs = re.findall(r"\b(?:Section|Sections|Article|Articles|Exhibit|Schedule|Appendix)\s+[A-Z0-9][A-Z0-9.\-]*\b", text, flags=re.IGNORECASE)
    for ref in refs:
        clean = re.sub(r"\s+", " ", ref).strip()
        if clean and clean.lower() not in {q.lower() for q in queries}:
            queries.append(clean)
    lowered = text.lower()
    if any(term in lowered for term in ("defined in", "as defined", "definition of")):
        queries.append("definitions defined terms")
    if any(term in lowered for term in ("subject to", "except as provided", "as set forth")):
        queries.append("cross reference subject to except as provided as set forth")
    return queries[:4]


def _clause_map_signal_snapshot(entries: list[dict[str, Any]], chunks: list[ContextChunk]) -> dict[str, Any]:
    selected = _selected_clause_entry_records(entries)
    entries_with_spans = [entry for entry in selected if entry.get("source_spans")]
    chunk_ids = {chunk.chunk_id for chunk in chunks if chunk.source in {"clause_map", "neighbor", "reference"}}
    sufficient = bool(entries_with_spans and chunk_ids)
    return {
        "coverage_mode": "clause_map",
        "selected_entry_count": len(selected),
        "selected_entries_with_spans": len(entries_with_spans),
        "selected_entries": selected,
        "selected_chunk_count": len(chunk_ids),
        "sufficient": sufficient,
    }


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


def _term_present(term: str, text: str) -> bool:
    clean = str(term or "").strip().lower()
    if not clean:
        return False
    if " " in clean:
        return clean in text
    return re.search(rf"\b{re.escape(clean)}\b", text) is not None


def _topic_coverage_snapshot(plan: ContextSearchPlan, chunks: list[ContextChunk]) -> dict[str, Any]:
    if not plan.required_topics:
        return _direct_signal_snapshot(plan.sufficiency_query, chunks)

    joined = "\n".join(chunk.text.lower() for chunk in chunks)
    covered: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for topic in plan.required_topics:
        matched_terms = [term for term in topic.terms if _term_present(term, joined)]
        record = {
            "key": topic.key,
            "label": topic.label,
            "matched_terms": matched_terms[:8],
            "expansion_query": topic.expansion_query,
        }
        if matched_terms:
            covered.append(record)
        else:
            missing.append(record)

    min_required = plan.min_required_topics or len(plan.required_topics)
    sufficient = len(covered) >= min_required
    return {
        "coverage_mode": "legal_topics",
        "question_type": plan.question_type,
        "topics_checked": [topic.label for topic in plan.required_topics],
        "covered_topics": covered,
        "missing_topics": missing,
        "covered_count": len(covered),
        "missing_count": len(missing),
        "threshold": min_required,
        "sufficient": sufficient,
    }


def _expansion_queries(query: str, existing: list[str], *, missing_topics: list[dict[str, Any]] | None = None) -> list[str]:
    lowered = (query or "").lower()
    expansions: list[str] = []
    for topic in missing_topics or []:
        expansion_query = str(topic.get("expansion_query") or "").strip()
        if expansion_query:
            expansions.append(expansion_query)
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
    # Preserve original order while preferring clause-map anchors, then retrieved chunks, then neighbors/references.
    priority = {"clause_map": 0, "retrieved": 1, "reference": 2, "neighbor": 3}
    ranked = sorted(enumerate(chunks), key=lambda item: (priority.get(item[1].source, 9), -item[1].score, item[0]))
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
    profile: str | ContextAgentProfile = "default",
    workflow_id: str | None = None,
    clause_map_entries: list[dict[str, Any]] | None = None,
    clause_map_selection: dict[str, Any] | None = None,
) -> ContextBundle:
    """Build an adaptive source context bundle.

    v1 uses deterministic sufficiency heuristics: start with hybrid search,
    expand around high-signal chunks, then run one or two targeted follow-up
    queries only when the initial context looks insufficient.

    The returned ``decision_trace`` is intentionally a concise, observable
    rationale log. It explains what the context agent did and why without
    attempting to expose hidden model chain-of-thought.
    """
    active_profile = profile if isinstance(profile, ContextAgentProfile) else get_profile(profile)
    clean_query = str(query or "").strip()
    plan = _build_search_plan(clean_query, profile=active_profile, workflow_id=workflow_id)
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

    if plan.search_query != plan.original_query and not clause_map_entries:
        add_decision(
            stage="planning",
            decision="Rewrite the retrieval query for the workflow",
            rationale="Launcher settings are useful generation context, but semantic retrieval needs substantive evidence terms for the workflow.",
            action="Use a workflow-aware search query before the initial retrieval",
            observation="Workflow-specific legal terms were used instead of raw launcher settings.",
            outcome="Initial search will target contract-review evidence rather than UI configuration text.",
            metadata={
                "workflow_id": workflow_id,
                "original_query": plan.original_query,
                "search_query": plan.search_query,
                "user_signal": plan.user_signal,
                "question_type": plan.question_type,
                "required_topics": [topic.label for topic in plan.required_topics],
                "min_required_topics": plan.min_required_topics,
                "fallback_query_prepared": True,
            },
        )
    elif plan.search_query != plan.original_query and clause_map_entries:
        add_decision(
            stage="planning",
            decision="Prepare semantic fallback query",
            rationale="Predefined workflow terms are retained only as fallback when clause-map selection cannot provide enough anchored context.",
            action="Keep fallback query available without using it first",
            observation="Clause-map entries are available, so semantic search is not the primary context plan.",
            outcome="The agent will start from selected clause-map spans.",
            metadata={
                "workflow_id": workflow_id,
                "original_query": plan.original_query,
                "fallback_search_query": plan.search_query,
                "fallback_query_prepared": True,
            },
        )

    if not plan.search_query or not files:
        add_decision(
            stage="planning",
            decision="Stop before retrieval",
            rationale="Adaptive retrieval requires both a non-empty query and at least one selected file.",
            action="Return an empty context bundle",
            observation=f"query_present={bool(plan.search_query)}; file_count={len(files)}",
            outcome="No context was selected.",
        )
        return ContextBundle(
            query=plan.search_query,
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
    queried: list[str] = []
    using_clause_map = active_profile.name == "legal" and bool(clause_map_entries)

    if using_clause_map:
        selection_meta = dict(clause_map_selection or {})
        source_chunks = _chunks_from_clause_map_entries(uid, entries=clause_map_entries or [], files_by_id=files_by_id)
        added = _add_chunks(selected, seen, source_chunks, max_chunks=active_profile.max_chunks)
        trace.append(RetrievalStep(step=1, type="clause_map_source_fetch", reason="Clause-map selected source spans", chunk_ids=[item.chunk_id for item in added], chunks_added=len(added)))
        add_decision(
            stage="clause_map_selection",
            decision="Use clause map as the primary context plan",
            rationale="The clause map already contains discovered contract structure and chunk/span anchors, so the agent starts from those entries instead of predefined search terms.",
            action="Fetch exact chunks cited by selected clause-map entries",
            observation=f"{selection_meta.get('selected_entry_count', len(clause_map_entries or []))} clause-map entrie(s) selected by {selection_meta.get('method') or 'unknown'}.",
            outcome=f"Added {len(added)} exact clause chunk(s).",
            metadata={
                "selection_method": selection_meta.get("method"),
                "selection_model": selection_meta.get("model"),
                "selection_reason": selection_meta.get("reason"),
                "available_entry_count": selection_meta.get("available_entry_count"),
                "selected_entry_count": selection_meta.get("selected_entry_count", len(clause_map_entries or [])),
                "selected_entries": _selected_clause_entry_records(clause_map_entries or []),
                "chunk_ids": [item.chunk_id for item in added],
            },
        )

        neighbors = _neighbor_expansion(uid, selected=selected, files_by_id=files_by_id, profile=active_profile)
        added_neighbors = _add_chunks(selected, seen, neighbors, max_chunks=active_profile.max_chunks)
        if added_neighbors:
            trace.append(RetrievalStep(step=len(trace) + 1, type="neighbor_expansion", reason="Adjacent chunks around clause-map spans", chunk_ids=[item.chunk_id for item in added_neighbors], chunks_added=len(added_neighbors)))
        add_decision(
            stage="neighbor_expansion",
            decision="Pull adjacent context around clause-map spans",
            rationale="The exact mapped span can start before or continue after a chunk boundary.",
            action="Fetch neighboring chunks around clause-map source spans",
            observation=f"Neighbor window: {active_profile.neighbor_before} before / {active_profile.neighbor_after} after.",
            outcome=f"Added {len(added_neighbors)} adjacent chunk(s).",
            metadata={"chunk_ids": [item.chunk_id for item in added_neighbors], "candidate_count": len(neighbors)},
        )

        reference_queries = _reference_queries_from_entries(clause_map_entries or [], selected)
        for reference_query in reference_queries:
            candidates = _retrieve(uid, files_by_dataset=files_by_dataset, query=reference_query, k=min(3, active_profile.followup_k))
            # These RAG calls are constrained to references/definitions/exhibits from the clause map.
            for candidate in candidates:
                candidate.source = "reference"
            added_ref = _add_chunks(selected, seen, candidates, max_chunks=active_profile.max_chunks)
            trace.append(RetrievalStep(step=len(trace) + 1, type="reference_query", query=reference_query, reason="Clause-map cross-reference or definition lookup", chunk_ids=[item.chunk_id for item in added_ref], chunks_added=len(added_ref)))
            add_decision(
                stage="reference_fetch",
                decision="Fetch referenced definitions, sections, or exhibits",
                rationale="RAG is used after clause-map selection only to pull referenced context that may live outside the selected clause span.",
                action="Run constrained reference query",
                observation=f"Reference query: {reference_query}",
                outcome=f"Added {len(added_ref)} reference chunk(s).",
                metadata={"query": reference_query, "chunk_ids": [item.chunk_id for item in added_ref], "candidate_count": len(candidates)},
            )

        signal = _clause_map_signal_snapshot(clause_map_entries or [], selected)
        sufficient = bool(signal.get("sufficient"))
    else:
        queried = [plan.search_query]
        initial = _retrieve(uid, files_by_dataset=files_by_dataset, query=plan.search_query, k=active_profile.initial_k)
        added = _add_chunks(selected, seen, initial, max_chunks=active_profile.max_chunks)
        trace.append(RetrievalStep(step=1, type="initial_search", query=plan.search_query, chunk_ids=[item.chunk_id for item in added], chunks_added=len(added)))
        add_decision(
            stage="initial_search",
            decision="Search for the first evidence set",
            rationale="Clause-map selection was unavailable, so the agent falls back to workflow-aware semantic search.",
            action="Run semantic search for the initial query",
            observation=f"Requested up to {active_profile.initial_k} hit(s) per dataset.",
            outcome=f"Added {len(added)} new chunk(s).",
            metadata={"query": plan.search_query, "original_query": plan.original_query, "fallback_used": True, "chunk_ids": [item.chunk_id for item in added], "candidate_count": len(initial)},
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

        signal = _topic_coverage_snapshot(plan, selected)
        sufficient = bool(signal.get("sufficient"))
    add_decision(
        stage="sufficiency_check",
        decision="Check whether selected context covers the required evidence",
        rationale="The agent only stops early when the gathered context contains enough substantive signal for the workflow.",
        action="Evaluate selected chunks against the planned sufficiency criteria",
        observation=(
            f"Clause-map entries {signal.get('selected_entry_count', signal.get('covered_count', signal.get('hit_count', 0)))}; "
            f"chunks {signal.get('selected_chunk_count', len(selected))}; "
            f"threshold {signal.get('threshold', 0)}."
        ),
        outcome="Context marked sufficient." if sufficient else "Context marked incomplete; expansion may be needed.",
        metadata=signal,
    )

    round_no = 0
    while not sufficient and round_no < active_profile.max_rounds and len(selected) < active_profile.max_chunks:
        round_no += 1
        missing_topics = signal.get("missing_topics") if isinstance(signal.get("missing_topics"), list) else None
        expansions = _expansion_queries(plan.search_query, queried, missing_topics=missing_topics)
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
            trace.append(RetrievalStep(step=len(trace) + 1, type="targeted_query", query=expansion_query, reason="Selected context did not cover enough planned evidence areas", chunk_ids=[item.chunk_id for item in added_candidates], chunks_added=len(added_candidates)))
            add_decision(
                stage="targeted_query",
                decision="Search for missing related evidence",
                rationale="The sufficiency check found missing evidence areas, so the agent used targeted domain terms tied to those gaps.",
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

        signal = _topic_coverage_snapshot(plan, selected)
        sufficient = bool(signal.get("sufficient"))
        add_decision(
            stage="sufficiency_check",
            decision="Re-check context sufficiency after expansion",
            rationale="The agent should stop expanding once it has enough topic coverage or when expansion stops producing useful new chunks.",
            action="Evaluate selected chunks after expansion",
            observation=(
                f"Covered {signal.get('covered_count', signal.get('hit_count', 0))} "
                f"of {len(signal.get('topics_checked', signal.get('terms_checked', [])))} checked item(s); "
                f"threshold {signal.get('threshold', 0)}."
            ),
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
    if signal.get("coverage_mode") == "clause_map":
        coverage_notes.append(
            f"Clause-map-first context: {signal.get('selected_entry_count', 0)} selected entrie(s), "
            f"{signal.get('selected_chunk_count', len(selected))} anchored chunk(s)."
        )
    elif signal.get("coverage_mode") == "legal_topics":
        coverage_notes.append(
            f"Legal topic coverage: {signal.get('covered_count', 0)}/{len(signal.get('topics_checked', []))} "
            f"topic(s) met; threshold {signal.get('threshold', 0)}."
        )
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

    missing_topic_labels = [str(item.get("label")) for item in signal.get("missing_topics", [])] if isinstance(signal.get("missing_topics"), list) else []
    missing_context = [] if sufficient else [stop_reason, *missing_topic_labels[:6]]
    return ContextBundle(
        query=plan.search_query,
        profile=active_profile.name,
        sufficient=sufficient,
        chunks=selected,
        retrieval_trace=trace,
        decision_trace=decisions,
        coverage_notes=coverage_notes,
        missing_context=missing_context,
    )
