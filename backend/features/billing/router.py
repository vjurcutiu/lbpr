from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import time
from typing import Any, Literal
from urllib.parse import urlparse

import httpx

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

try:
    from core.config import settings
except Exception:  # pragma: no cover - keeps tests isolated if config cannot load
    settings = None

log = logging.getLogger("billing")

router = APIRouter(prefix="/billing", tags=["billing"])

PlanKey = Literal["pro"]
CheckoutMode = Literal["subscription", "payment"]

PRO_LOOKUP_KEYS = ("pro_monthly", "pro")
CHECKOUT_POLL_SECONDS = 15.0
CHECKOUT_POLL_INTERVAL_SECONDS = 0.35


class CheckoutIn(BaseModel):
    plan_key: PlanKey = "pro"
    mode: CheckoutMode = "subscription"
    success_url: str | None = None
    cancel_url: str | None = None
    quantity: int = Field(default=1, ge=1, le=999)
    allow_promotion_codes: bool = False
    trial_from_plan: bool = False


class CheckoutOut(BaseModel):
    url: str
    session_id: str
    price_id: str


class CatalogPriceOut(BaseModel):
    id: str
    unit_amount: int | None = None
    currency: str | None = None
    interval: str | None = None
    interval_count: int | None = None
    product: str | None = None
    active: bool | None = None
    type: str | None = None
    lookup_key: str | None = None
    nickname: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CatalogProductOut(BaseModel):
    id: str
    name: str | None = None
    description: str | None = None
    active: bool | None = None
    default_price: str | None = None
    images: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CatalogOut(BaseModel):
    product: CatalogProductOut
    price: CatalogPriceOut


def _normalize_key(value: Any) -> str:
    return str(value or "").strip().lower()


def _metadata_plan_key(metadata: dict[str, Any] | None) -> str:
    metadata = metadata or {}
    return (
        _normalize_key(metadata.get("app_plan_key"))
        or _normalize_key(metadata.get("plan_key"))
        or _normalize_key(metadata.get("code"))
    )


def _product_matches_plan(product: dict[str, Any], plan_key: str) -> bool:
    meta_key = _metadata_plan_key(product.get("metadata") or {})
    if meta_key:
        return meta_key == plan_key

    name = _normalize_key(product.get("name"))
    words = [part for part in re.split(r"[^a-z0-9]+", name) if part]
    return plan_key in words


def _price_interval(price: dict[str, Any]) -> str | None:
    recurring = price.get("recurring") or {}
    return price.get("interval") or recurring.get("interval")


def _is_active_recurring_price(price: dict[str, Any]) -> bool:
    return price.get("active", True) is not False and price.get("type") != "one_time" and bool(_price_interval(price))


def _stripe_id_from_value(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed.rsplit("/", 1)[-1] if trimmed else None
    if isinstance(value, dict):
        raw = value.get("id") or value.get("path") or value.get("_path")
        if isinstance(raw, str):
            return raw.strip().rsplit("/", 1)[-1] or None
    raw_id = getattr(value, "id", None)
    if isinstance(raw_id, str):
        return raw_id.strip() or None
    raw_path = getattr(value, "path", None)
    if isinstance(raw_path, str):
        return raw_path.strip().rsplit("/", 1)[-1] or None
    return None


def _default_price_id(product: dict[str, Any]) -> str | None:
    return _stripe_id_from_value(product.get("default_price"))


def _origin_from_request(request: Request) -> str:
    configured = (os.getenv("PUBLIC_APP_URL") or "").strip().rstrip("/")
    if configured:
        return configured

    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin:
        return origin

    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}".rstrip("/")

    return str(request.base_url).rstrip("/")


def _safe_return_url(candidate: str | None, origin: str) -> str:
    default = f"{origin}/billing"
    value = (candidate or default).strip()
    parsed_origin = urlparse(origin)
    parsed_value = urlparse(value)
    if parsed_value.scheme in {"http", "https"} and parsed_value.netloc == parsed_origin.netloc:
        return value
    if value.startswith("/billing"):
        return f"{origin}{value}"
    return default


def _firestore_client():
    try:
        from firebase_admin import firestore  # type: ignore

        return firestore.client()
    except Exception:
        log.exception("billing_firestore_client_error")
        raise HTTPException(status_code=500, detail="Billing is not available right now.")


def _stripe_api_key() -> str:
    configured = getattr(settings, "STRIPE_API_KEY", None) if settings is not None else None
    return str(configured or os.getenv("STRIPE_API_KEY") or "").strip()


def _stripe_headers() -> dict[str, str]:
    api_key = _stripe_api_key()
    if not api_key:
        raise RuntimeError("STRIPE_API_KEY is not configured")
    token = base64.b64encode(f"{api_key}:".encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {token}",
        "User-Agent": "lbpr-billing/1.0",
    }


def _stripe_request(method: str, path: str, *, params: dict[str, Any] | None = None) -> Any:
    with httpx.Client(base_url="https://api.stripe.com", timeout=20.0, headers=_stripe_headers()) as client:
        resp = client.request(method, path, params=params)
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


def _stripe_price_to_dict(price: dict[str, Any], fallback_product_id: str) -> dict[str, Any]:
    recurring = price.get("recurring") or {}
    return {
        "id": str(price.get("id") or "").strip(),
        "unit_amount": price.get("unit_amount"),
        "currency": price.get("currency"),
        "interval": recurring.get("interval") or price.get("interval"),
        "interval_count": recurring.get("interval_count") or price.get("interval_count"),
        "product": _stripe_id_from_value(price.get("product")) or fallback_product_id,
        "active": price.get("active"),
        "type": price.get("type"),
        "lookup_key": price.get("lookup_key"),
        "nickname": price.get("nickname"),
        "metadata": price.get("metadata") or {},
    }


def _stripe_product_to_dict(product: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    merged = dict(fallback)
    merged.update({
        "id": str(product.get("id") or fallback.get("id") or "").strip(),
        "name": product.get("name") or fallback.get("name"),
        "description": product.get("description") or fallback.get("description"),
        "active": product.get("active", fallback.get("active")),
        "default_price": _stripe_id_from_value(product.get("default_price")) or _default_price_id(fallback),
        "images": product.get("images") or fallback.get("images") or [],
        "metadata": product.get("metadata") or fallback.get("metadata") or {},
    })
    return merged


def _stripe_catalog_for_product(product: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    if not _stripe_api_key():
        return None
    product_id = str(product.get("id") or "").strip()
    if not product_id:
        return None
    try:
        stripe_product = _stripe_request("GET", f"/v1/products/{product_id}") or {}
        prices_payload = _stripe_request("GET", "/v1/prices", params={"product": product_id, "active": "true", "limit": 100}) or {}
    except Exception:
        log.exception("billing_stripe_catalog_fetch_error", extra={"product_id": product_id})
        return None

    merged_product = _stripe_product_to_dict(stripe_product, product)
    prices = [
        _stripe_price_to_dict(price, product_id)
        for price in prices_payload.get("data") or []
        if isinstance(price, dict)
    ]
    return merged_product, prices


def _doc_to_dict(doc: Any) -> dict[str, Any]:
    data = doc.to_dict() or {}
    data["id"] = getattr(doc, "id", data.get("id"))
    return data


def _list_active_products(db: Any) -> list[dict[str, Any]]:
    try:
        docs = db.collection("products").where("active", "==", True).stream()
        return [_doc_to_dict(doc) for doc in docs]
    except Exception:
        log.exception("billing_products_fetch_error")
        raise HTTPException(status_code=500, detail="Could not load billing plans.")


def _coerce_price_doc(price_id: str, data: dict[str, Any], fallback_product_id: str) -> dict[str, Any]:
    recurring = data.get("recurring") or {}
    return {
        "id": price_id,
        "unit_amount": data.get("unit_amount"),
        "currency": data.get("currency"),
        "interval": data.get("interval") or recurring.get("interval"),
        "interval_count": data.get("interval_count") or recurring.get("interval_count"),
        "product": _stripe_id_from_value(data.get("product")) or fallback_product_id,
        "active": data.get("active"),
        "type": data.get("type"),
        "lookup_key": data.get("lookup_key"),
        "nickname": data.get("nickname"),
        "metadata": data.get("metadata") or {},
    }


def _embedded_prices(product: dict[str, Any]) -> list[dict[str, Any]]:
    raw = product.get("prices")
    product_id = str(product.get("id") or "").strip()
    prices: list[dict[str, Any]] = []
    if isinstance(raw, dict):
        for price_id, value in raw.items():
            if isinstance(value, dict):
                prices.append(_coerce_price_doc(str(price_id), value, product_id))
    elif isinstance(raw, list):
        for value in raw:
            if isinstance(value, dict):
                price_id = str(value.get("id") or "").strip()
                if price_id:
                    prices.append(_coerce_price_doc(price_id, value, product_id))
    return prices


def _list_prices(db: Any, product: dict[str, Any] | str) -> list[dict[str, Any]]:
    if isinstance(product, dict):
        product_id = str(product.get("id") or "").strip()
        embedded = _embedded_prices(product)
    else:
        product_id = str(product).strip()
        embedded = []

    try:
        docs = db.collection("products").document(product_id).collection("prices").stream()
        subcollection_prices = [_doc_to_dict(doc) for doc in docs]
        return subcollection_prices or embedded
    except Exception:
        log.exception("billing_prices_fetch_error", extra={"product_id": product_id})
        raise HTTPException(status_code=500, detail="Could not load billing prices.")


def _choose_price(product: dict[str, Any], prices: list[dict[str, Any]]) -> dict[str, Any] | None:
    recurring_prices = [price for price in prices if _is_active_recurring_price(price)]
    default_price = _default_price_id(product)
    if default_price:
        for price in recurring_prices:
            if price.get("id") == default_price:
                return price

    for lookup_key in PRO_LOOKUP_KEYS:
        for price in recurring_prices:
            if _normalize_key(price.get("lookup_key")) == lookup_key:
                return price

    if len(recurring_prices) == 1:
        return recurring_prices[0]
    return None


def _select_price_for_plan(db: Any, plan_key: str) -> tuple[dict[str, Any], dict[str, Any]]:
    products = [product for product in _list_active_products(db) if _product_matches_plan(product, plan_key)]
    if not products:
        raise HTTPException(status_code=404, detail="The selected plan is not available.")

    for product in products:
        prices = _list_prices(db, product)
        selected = _choose_price(product, prices)
        if selected:
            return product, selected

        # Fallback to Stripe's live catalog when the Firebase extension has synced
        # the product doc but not its prices/default_price yet.
        stripe_catalog = _stripe_catalog_for_product(product)
        if stripe_catalog:
            stripe_product, stripe_prices = stripe_catalog
            selected = _choose_price(stripe_product, stripe_prices)
            if selected:
                return stripe_product, selected

    raise HTTPException(
        status_code=409,
        detail="Configure an active recurring Stripe price with lookup_key=pro_monthly or make it the only active recurring price for this plan.",
    )

def _create_checkout_doc(db: Any, uid: str, payload: dict[str, Any]) -> Any:
    try:
        _, doc_ref = db.collection("customers").document(uid).collection("checkout_sessions").add(payload)
        return doc_ref
    except Exception:
        log.exception("billing_checkout_doc_create_error", extra={"uid": uid})
        raise HTTPException(status_code=500, detail="Could not start checkout.")


def _read_checkout_doc(doc_ref: Any) -> dict[str, Any]:
    try:
        return doc_ref.get().to_dict() or {}
    except Exception:
        log.exception("billing_checkout_doc_read_error")
        raise HTTPException(status_code=500, detail="Could not start checkout.")


async def _wait_for_checkout_url(doc_ref: Any) -> str:
    deadline = time.monotonic() + CHECKOUT_POLL_SECONDS
    while time.monotonic() < deadline:
        data = await asyncio.to_thread(_read_checkout_doc, doc_ref)
        error = data.get("error")
        if error:
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise HTTPException(status_code=400, detail=message or "Checkout failed to start.")

        url = data.get("url")
        if isinstance(url, str) and url.startswith("http"):
            return url

        await asyncio.sleep(CHECKOUT_POLL_INTERVAL_SECONDS)

    raise HTTPException(status_code=504, detail="Checkout took too long to start. Please try again.")


@router.get("/catalog", response_model=CatalogOut)
async def get_billing_catalog(plan_key: PlanKey = "pro") -> CatalogOut:
    db = _firestore_client()
    product, price = await asyncio.to_thread(_select_price_for_plan, db, plan_key)
    return CatalogOut(
        product=CatalogProductOut(
            id=str(product.get("id") or ""),
            name=product.get("name"),
            description=product.get("description"),
            active=product.get("active"),
            default_price=_default_price_id(product),
            images=product.get("images") or [],
            metadata=product.get("metadata") or {},
        ),
        price=CatalogPriceOut(
            id=str(price.get("id") or ""),
            unit_amount=price.get("unit_amount"),
            currency=price.get("currency"),
            interval=_price_interval(price),
            interval_count=price.get("interval_count"),
            product=_stripe_id_from_value(price.get("product")) or str(product.get("id") or ""),
            active=price.get("active"),
            type=price.get("type"),
            lookup_key=price.get("lookup_key"),
            nickname=price.get("nickname"),
            metadata=price.get("metadata") or {},
        ),
    )


@router.post("/checkout", response_model=CheckoutOut)
async def create_checkout_session(
    payload: CheckoutIn,
    request: Request,
    user: SessionOut = Depends(get_current_user),
) -> CheckoutOut:
    db = _firestore_client()
    _, price = await asyncio.to_thread(_select_price_for_plan, db, payload.plan_key)

    origin = _origin_from_request(request)
    success_url = _safe_return_url(payload.success_url, origin)
    cancel_url = _safe_return_url(payload.cancel_url, origin)

    checkout_payload: dict[str, Any] = {
        "price": price["id"],
        "mode": payload.mode,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "quantity": payload.quantity,
        "allow_promotion_codes": payload.allow_promotion_codes,
        "trial_from_plan": payload.trial_from_plan,
        "metadata": {"app_plan_key": payload.plan_key},
    }

    doc_ref = await asyncio.to_thread(_create_checkout_doc, db, user.uid, checkout_payload)
    url = await _wait_for_checkout_url(doc_ref)
    log.info("billing_checkout_started", extra={"uid": user.uid, "plan_key": payload.plan_key, "price_id": price["id"]})
    return CheckoutOut(url=url, session_id=doc_ref.id, price_id=price["id"])
