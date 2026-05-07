from __future__ import annotations

from features.workflows.legal_clause_map import (
    CLAUSE_MAP_INGEST_ENABLED_ENV,
    CLAUSE_MAP_LLM_ENABLED_ENV,
    CLAUSE_MAP_NANO_MODEL_ENV,
    CLAUSE_MAP_SELECTION_MODEL_ENV,
    clause_map_ingest_enabled,
    clause_map_llm_enabled,
    clause_map_nano_model,
    clause_map_selection_model,
)


def test_clause_map_env_defaults_do_not_require_doppler_values(monkeypatch):
    for name in (
        CLAUSE_MAP_INGEST_ENABLED_ENV,
        CLAUSE_MAP_LLM_ENABLED_ENV,
        CLAUSE_MAP_NANO_MODEL_ENV,
        CLAUSE_MAP_SELECTION_MODEL_ENV,
    ):
        monkeypatch.delenv(name, raising=False)

    assert clause_map_ingest_enabled() is True
    assert clause_map_llm_enabled() is True
    assert clause_map_nano_model() == "gpt-5-nano"
    assert clause_map_selection_model() == "gpt-5-nano"


def test_clause_map_selection_model_defaults_to_nano_override(monkeypatch):
    monkeypatch.setenv(CLAUSE_MAP_NANO_MODEL_ENV, "custom-nano")
    monkeypatch.delenv(CLAUSE_MAP_SELECTION_MODEL_ENV, raising=False)

    assert clause_map_nano_model() == "custom-nano"
    assert clause_map_selection_model() == "custom-nano"


def test_clause_map_env_overrides_still_work(monkeypatch):
    monkeypatch.setenv(CLAUSE_MAP_INGEST_ENABLED_ENV, "0")
    monkeypatch.setenv(CLAUSE_MAP_LLM_ENABLED_ENV, "false")
    monkeypatch.setenv(CLAUSE_MAP_SELECTION_MODEL_ENV, "selection-model")

    assert clause_map_ingest_enabled() is False
    assert clause_map_llm_enabled() is False
    assert clause_map_selection_model() == "selection-model"
