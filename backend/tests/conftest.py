# tests/conftest.py
import os
import pytest
from starlette.testclient import TestClient
from main import create_app

@pytest.fixture(scope="session")
def app():
    # If your app/deps switch to Fake services when under pytest,
    # this env flag can help (harmless if unused).
    os.environ.setdefault("PYTEST", "1")
    os.environ.setdefault("AUTH_FAKE", "1")
    os.environ.setdefault("OTEL_TRACES_EXPORTER", "none")
    os.environ.setdefault("OTEL_METRICS_EXPORTER", "none")
    return create_app()

@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c
