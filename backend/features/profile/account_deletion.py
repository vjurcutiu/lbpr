from __future__ import annotations

import base64
import logging
import os
from dataclasses import asdict, dataclass
from typing import Any, Optional

import httpx

from core.config import settings
from core.namespaces import pinecone_namespace
from features.auth.service import AuthService
from features.auth.sessions import sessions
from core.user_store import USERS_COLLECTION

log = logging.getLogger("profile.account_delete")


@dataclass
class DeleteAccountSummary:
    storage_objects_deleted: int = 0
    firestore_docs_deleted: int = 0
    pinecone_namespaces_deleted: int = 0
    redis_keys_deleted: int = 0
    sessions_revoked: int = 0
    stripe_subscriptions_canceled: int = 0

    def to_dict(self) -> dict[str, int]:
        return asdict(self)


class AccountDeletionError(RuntimeError):
    def __init__(self, message: str, *, summary: DeleteAccountSummary):
        super().__init__(message)
        self.summary = summary


def _get_firestore_module():
    try:
        from firebase_admin import firestore  # type: ignore
        return firestore
    except Exception:
        return None


def _get_storage_bucket():
    try:
        from firebase_admin import storage  # type: ignore
    except Exception:
        return None
    bucket_name = settings.FIREBASE_STORAGE_BUCKET or (f"{settings.FIREBASE_PROJECT_ID}.appspot.com" if settings.FIREBASE_PROJECT_ID else None)
    return storage.bucket(bucket_name) if bucket_name else storage.bucket()


def _delete_storage_prefix(uid: str) -> int:
    bucket = _get_storage_bucket()
    if bucket is None:
        return 0
    prefix = f"u:{uid}/"
    deleted = 0
    for blob in bucket.list_blobs(prefix=prefix):
        blob.delete()
        deleted += 1
    log.info("account_delete_storage_ok", uid=uid, prefix=prefix, deleted=deleted)
    return deleted


def _delete_document_tree(doc_ref) -> int:
    deleted = 0
    try:
        for subcol in doc_ref.collections():
            deleted += _delete_collection_tree(subcol)
    except Exception:
        # Missing docs / no subcollections should not block deletion of the doc itself.
        pass
    doc_ref.delete()
    return deleted + 1


def _delete_collection_tree(collection_ref, *, page_size: int = 200) -> int:
    deleted = 0
    while True:
        docs = list(collection_ref.limit(page_size).stream())
        if not docs:
            break
        for doc in docs:
            deleted += _delete_document_tree(doc.reference)
    return deleted


def _collect_user_datasets(uid: str) -> set[str]:
    datasets = {"default"}
    fs = _get_firestore_module()
    if fs is None:
        return datasets
    db = fs.client()
    try:
        docs = db.collection(USERS_COLLECTION).document(uid).collection("files").limit(5000).stream()
        for doc in docs:
            data = doc.to_dict() or {}
            ds = str(data.get("dataset") or "").strip()
            if ds:
                datasets.add(ds)
    except Exception:
        log.exception("account_delete_collect_datasets_failed", uid=uid)
    return datasets


def _delete_firestore_user_data(uid: str) -> int:
    fs = _get_firestore_module()
    if fs is None:
        return 0
    db = fs.client()
    deleted = 0

    user_ref = db.collection(USERS_COLLECTION).document(uid)
    deleted += _delete_document_tree(user_ref)

    customer_ref = db.collection("customers").document(uid)
    deleted += _delete_document_tree(customer_ref)


    log.info("account_delete_firestore_ok", uid=uid, deleted=deleted)
    return deleted


def _get_sync_redis_client():
    try:
        import redis  # type: ignore
    except Exception:
        return None
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        return None
    return redis.Redis.from_url(redis_url, decode_responses=True)


def _delete_redis_user_data(uid: str) -> int:
    client = _get_sync_redis_client()
    if client is None:
        return 0

    deleted = 0
    pipe = client.pipeline()

    user_jobs_key = f"ut:user:{uid}:jobs"
    try:
        job_ids = list(client.zrange(user_jobs_key, 0, -1) or [])
    except Exception:
        job_ids = []
    for job_id in job_ids:
        pipe.delete(f"ut:job:{job_id}")
        deleted += 1
    if job_ids or client.exists(user_jobs_key):
        pipe.delete(user_jobs_key)
        deleted += 1

    for key in client.scan_iter(match=f"rl:{uid}:*"):
        pipe.delete(key)
        deleted += 1

    pipe.execute()
    log.info("account_delete_redis_ok", uid=uid, deleted=deleted)
    return deleted


def _pinecone_enabled() -> bool:
    return (settings.RAG_VECTORSTORE or "").lower() == "pinecone" and bool(settings.PINECONE_API_KEY)


def _import_pinecone_client():
    from pinecone import Pinecone  # type: ignore
    return Pinecone


def _pinecone_client():
    Pinecone = _import_pinecone_client()
    return Pinecone(api_key=settings.PINECONE_API_KEY)


def _is_not_found_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(token in msg for token in ("not found", "404", "does not exist", "resource not found"))


def _resolve_index_names() -> list[str]:
    base = settings.PINECONE_INDEX or "lbpr"
    if settings.RAG_HYBRID_DUAL_INDEX:
        return [
            settings.PINECONE_INDEX_DENSE or f"{base}-dense",
            settings.PINECONE_INDEX_SPARSE or f"{base}-sparse",
        ]
    return [base]


def _namespace_name(obj: Any) -> Optional[str]:
    if isinstance(obj, str):
        return obj
    if isinstance(obj, dict):
        return obj.get("name")
    return getattr(obj, "name", None)


def _list_index_namespaces(index) -> set[str]:
    names: set[str] = set()
    if hasattr(index, "list_namespaces"):
        for item in index.list_namespaces():
            name = _namespace_name(item)
            if name:
                names.add(str(name))
        return names

    if hasattr(index, "list_namespaces_paginated"):
        token = None
        while True:
            resp = index.list_namespaces_paginated(limit=100, pagination_token=token)
            if isinstance(resp, dict):
                raw_items = resp.get("namespaces") or []
                token = ((resp.get("pagination") or {}).get("next"))
            else:
                raw_items = getattr(resp, "namespaces", []) or []
                pagination = getattr(resp, "pagination", None)
                token = getattr(pagination, "next", None) if pagination is not None else None
            for item in raw_items:
                name = _namespace_name(item)
                if name:
                    names.add(str(name))
            if not token:
                break
    return names


def _delete_namespace(index, namespace: str) -> None:
    if hasattr(index, "delete_namespace"):
        try:
            index.delete_namespace(namespace=namespace)
            return
        except Exception as exc:
            if _is_not_found_error(exc):
                return
            log.warning("account_delete_namespace_delete_namespace_failed", namespace=namespace, error=str(exc))
    index.delete(delete_all=True, namespace=namespace)


def _delete_pinecone_user_data(uid: str, *, datasets: set[str]) -> int:
    if not _pinecone_enabled():
        return 0

    pc = _pinecone_client()
    prefix = f"u:{uid}:"
    candidate_namespaces = {pinecone_namespace(uid, ds) for ds in datasets if str(ds).strip()}
    deleted = 0

    for index_name in _resolve_index_names():
        try:
            index = pc.Index(index_name)
        except Exception as exc:
            if _is_not_found_error(exc):
                continue
            raise

        namespaces = set(candidate_namespaces)
        try:
            namespaces.update({ns for ns in _list_index_namespaces(index) if ns.startswith(prefix)})
        except Exception as exc:
            log.warning("account_delete_list_namespaces_failed", uid=uid, index=index_name, error=str(exc))

        for namespace in sorted(namespaces):
            try:
                _delete_namespace(index, namespace)
                deleted += 1
            except Exception as exc:
                if _is_not_found_error(exc):
                    continue
                raise RuntimeError(f"Failed deleting Pinecone namespace '{namespace}' from '{index_name}': {exc}") from exc

    log.info("account_delete_pinecone_ok", uid=uid, deleted=deleted)
    return deleted


def _stripe_api_key() -> str:
    return str(getattr(settings, "STRIPE_API_KEY", None) or os.getenv("STRIPE_API_KEY") or "").strip()


def _stripe_headers() -> dict[str, str]:
    api_key = _stripe_api_key()
    if not api_key:
        raise RuntimeError("STRIPE_API_KEY is not configured")
    token = base64.b64encode(f"{api_key}:".encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {token}",
        "User-Agent": "lbpr-account-delete/1.0",
    }


def _stripe_request(method: str, path: str, *, params: Optional[dict[str, Any]] = None, data: Optional[dict[str, Any]] = None) -> Any:
    with httpx.Client(base_url="https://api.stripe.com", timeout=20.0, headers=_stripe_headers()) as client:
        resp = client.request(method, path, params=params, data=data)
    if resp.status_code == 404:
        return None
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = None
        try:
            payload = resp.json()
            detail = ((payload or {}).get("error") or {}).get("message")
        except Exception:
            detail = None
        raise RuntimeError(detail or resp.text or str(exc)) from exc
    if not resp.content:
        return None
    return resp.json()


def _collect_stripe_targets(uid: str) -> tuple[Optional[str], list[str]]:
    fs = _get_firestore_module()
    if fs is None:
        return None, []

    db = fs.client()
    customer_data = (db.collection("customers").document(uid).get().to_dict() or {})
    stripe_id = str(customer_data.get("stripeId") or "").strip() or None

    fallback_subscription_ids: list[str] = []
    try:
        docs = db.collection("customers").document(uid).collection("subscriptions").limit(100).stream()
        for doc in docs:
            data = doc.to_dict() or {}
            status = str(data.get("status") or "").strip().lower()
            if status == "canceled":
                continue
            fallback_subscription_ids.append(doc.id)
    except Exception:
        log.exception("account_delete_collect_stripe_subscriptions_failed", uid=uid)

    return stripe_id, fallback_subscription_ids


def _list_stripe_subscription_ids(customer_id: str) -> list[str]:
    subscription_ids: list[str] = []
    starting_after: Optional[str] = None

    while True:
        params: dict[str, Any] = {
            "customer": customer_id,
            "status": "all",
            "limit": 100,
        }
        if starting_after:
            params["starting_after"] = starting_after
        payload = _stripe_request("GET", "/v1/subscriptions", params=params) or {}
        data = payload.get("data") or []
        for item in data:
            if not isinstance(item, dict):
                continue
            status = str(item.get("status") or "").strip().lower()
            sub_id = str(item.get("id") or "").strip()
            if sub_id and status != "canceled":
                subscription_ids.append(sub_id)
        if not payload.get("has_more") or not data:
            break
        starting_after = str(data[-1].get("id") or "").strip() or None
        if not starting_after:
            break

    return subscription_ids


def _cancel_stripe_subscription(subscription_id: str) -> bool:
    try:
        _stripe_request(
            "DELETE",
            f"/v1/subscriptions/{subscription_id}",
            data={
                "cancellation_details[comment]": "User deleted their account in LexBot.",
            },
        )
        return True
    except RuntimeError as exc:
        if "No such subscription" in str(exc):
            return False
        raise


def _cancel_stripe_billing(uid: str) -> int:
    stripe_id, fallback_subscription_ids = _collect_stripe_targets(uid)
    if not stripe_id and not fallback_subscription_ids:
        return 0

    if not _stripe_api_key():
        raise RuntimeError("Cannot cancel Stripe billing during account deletion because STRIPE_API_KEY is not configured.")

    subscription_ids = set(fallback_subscription_ids)
    if stripe_id:
        try:
            subscription_ids.update(_list_stripe_subscription_ids(stripe_id))
        except Exception:
            log.exception("account_delete_list_stripe_subscriptions_failed", uid=uid, stripe_id=stripe_id)
            if not subscription_ids:
                raise

    canceled = 0
    for subscription_id in sorted(subscription_ids):
        if _cancel_stripe_subscription(subscription_id):
            canceled += 1

    log.info("account_delete_stripe_ok", uid=uid, stripe_id=stripe_id, canceled=canceled)
    return canceled


def delete_account_data(uid: str, *, auth_svc: AuthService, current_sid: Optional[str] = None) -> dict[str, int]:
    uid = str(uid or "").strip()
    if not uid:
        raise ValueError("uid is required")

    summary = DeleteAccountSummary()
    datasets = _collect_user_datasets(uid)

    try:
        summary.stripe_subscriptions_canceled = _cancel_stripe_billing(uid)
        summary.pinecone_namespaces_deleted = _delete_pinecone_user_data(uid, datasets=datasets)
        summary.storage_objects_deleted = _delete_storage_prefix(uid)
        summary.firestore_docs_deleted = _delete_firestore_user_data(uid)
        summary.redis_keys_deleted = _delete_redis_user_data(uid)
    except Exception as exc:
        log.exception("account_delete_cleanup_failed", uid=uid, summary=summary.to_dict())
        raise AccountDeletionError(str(exc), summary=summary) from exc

    summary.sessions_revoked = sessions.revoke_user(uid)
    if current_sid:
        sessions.revoke(current_sid)

    try:
        auth_svc.delete_user(uid)
    except Exception as exc:
        log.exception("account_delete_auth_failed", uid=uid, summary=summary.to_dict())
        raise AccountDeletionError(f"Account data was removed, but deleting the auth user failed: {exc}", summary=summary) from exc

    log.info("account_delete_ok", uid=uid, **summary.to_dict())
    return summary.to_dict()
