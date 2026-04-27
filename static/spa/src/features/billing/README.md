# Billing Feature (Stripe + Firestore)

## Current pricing source of truth

Stripe now controls the customer-facing Pro price.

The billing UI loads active Stripe products/prices mirrored into Firestore by the Stripe Firebase Extension. It selects the Pro catalog item by product metadata first, then product name fallback:

- preferred product metadata: `app_plan_key=pro`
- also supported: `plan_key=pro` or `code=pro`
- fallback: product name contains the word `pro`

For the selected product, the active recurring checkout/display price is chosen in this order:

1. the Stripe product `default_price`
2. a price with `lookup_key=pro_monthly`
3. the only active recurring price, when exactly one exists

The old frontend env-driven selection has been removed. Do not use `VITE_STRIPE_PRO_PRICE_ID` or `VITE_STRIPE_PRICE_ALLOWLIST` for normal pricing changes.

## Updating the Pro price

In Stripe, create a new recurring Price on the Pro product, set it as the product default price, and archive the old price if it should not be used for new checkouts.

Existing subscriptions on old prices continue unless they are intentionally migrated in Stripe. The backend still owns feature gates and usage limits through `/limits/me` and server-side plan configuration.

## Checkout flow

The frontend no longer sends a raw selected price ID as the authority. It calls:

```text
POST /billing/checkout
```

with `plan_key=pro`. The FastAPI backend resolves the active Stripe price from the synced Firestore catalog, writes the Stripe extension `checkout_sessions` document server-side, waits for the extension to attach the Checkout URL, and returns that URL to the browser.

This keeps pricing editable in Stripe while keeping plan limits and feature logic server-side.

## Catalog fallback behavior

The Billing page primarily listens to the Stripe/Firebase catalog in Firestore. If the extension has synced the product but not the nested price documents yet, the frontend calls `GET /billing/catalog?plan_key=pro`. The FastAPI billing route resolves the live Stripe product/price server-side using `STRIPE_API_KEY`, then checkout uses the same resolver. Feature limits remain controlled by the backend `/limits/me` path.
