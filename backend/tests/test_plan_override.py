from __future__ import annotations

import sys
import types

import pytest

import core.plan as plan


class _DocSnapshot:
    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


class _SubscriptionSnapshot(_DocSnapshot):
    pass


class _SubscriptionQuery:
    def __init__(self, docs):
        self._docs = docs

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def stream(self):
        return [_SubscriptionSnapshot(doc) for doc in self._docs]


class _CustomerDocument:
    def __init__(self, subscriptions):
        self._subscriptions = subscriptions

    def collection(self, name):
        assert name == plan.SUB_COLLECTION
        return _SubscriptionQuery(self._subscriptions)


class _CustomerCollection:
    def __init__(self, customers):
        self._customers = customers

    def document(self, uid):
        customer_data = self._customers.get(uid, {})
        return _CustomerDocument(customer_data.get("subscriptions", []))


class _UserDocument:
    def __init__(self, users, uid):
        self._users = users
        self._uid = uid

    def get(self):
        return _DocSnapshot(self._users.get(self._uid, {}))


class _UserCollection:
    def __init__(self, users):
        self._users = users

    def document(self, uid):
        return _UserDocument(self._users, uid)


class _FakeDB:
    def __init__(self, users=None, customers=None):
        self._users = users or {}
        self._customers = customers or {}

    def collection(self, name):
        if name == plan.USER_COLLECTION:
            return _UserCollection(self._users)
        if name == "customers":
            return _CustomerCollection(self._customers)
        raise AssertionError(f"unexpected collection: {name}")


class _FakeFirestoreModule:
    class Query:
        DESCENDING = "DESCENDING"

    def __init__(self, db):
        self._db = db

    def client(self):
        return self._db


def _install_fake_firestore(monkeypatch, *, users=None, customers=None):
    fake_firestore = _FakeFirestoreModule(_FakeDB(users=users, customers=customers))
    fake_firebase_admin = types.SimpleNamespace(firestore=fake_firestore)
    monkeypatch.setitem(sys.modules, "firebase_admin", fake_firebase_admin)


@pytest.mark.asyncio
async def test_plan_override_takes_precedence(monkeypatch):
    _install_fake_firestore(
        monkeypatch,
        users={"u1": {plan.PLAN_OVERRIDE_FIELD: "pro"}},
        customers={
            "u1": {
                "subscriptions": [
                    {"status": "active", "current_period_start": 123, "current_period_end": 456}
                ]
            }
        },
    )

    snap = await plan._fetch_sub_snapshot("u1")

    assert snap["plan"] == "PRO"
    assert snap["status"] == "override"
    assert snap["override"] is True
    assert snap["current_period_start"] == 0
    assert snap["current_period_end"] == 0


@pytest.mark.asyncio
async def test_invalid_override_falls_back_to_subscription(monkeypatch):
    _install_fake_firestore(
        monkeypatch,
        users={"u2": {plan.PLAN_OVERRIDE_FIELD: "enterprise"}},
        customers={
            "u2": {
                "subscriptions": [
                    {"status": "active", "current_period_start": 789, "current_period_end": 999}
                ]
            }
        },
    )

    snap = await plan._fetch_sub_snapshot("u2")

    assert snap["plan"] == "PRO"
    assert snap["status"] == "active"
    assert snap["override"] is False
    assert snap["current_period_start"] == 789
    assert snap["current_period_end"] == 999
