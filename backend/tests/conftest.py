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
    return create_app()

@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c
