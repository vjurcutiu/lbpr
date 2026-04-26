import importlib

from features.rag.adapters import openai_chat


def test_default_openai_chat_model_is_gpt_54_mini():
    assert openai_chat.DEFAULT_MODEL == "gpt-5.4-mini"


def test_openai_chat_uses_env_override_when_module_reloaded(monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL", "custom-test-model")
    reloaded = importlib.reload(openai_chat)
    try:
        assert reloaded.DEFAULT_MODEL == "custom-test-model"
    finally:
        monkeypatch.delenv("OPENAI_MODEL", raising=False)
        importlib.reload(openai_chat)
