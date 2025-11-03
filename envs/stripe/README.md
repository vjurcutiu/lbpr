# Stripe Env SDK (SSOT-driven)

A tiny, build-friendly toolkit to **pull** your Stripe settings into a local Single Source of Truth (SSOT) JSON file and **apply** changes back to Stripe. Designed for environment bootstrapping and drift control.

> Works with your existing stack (Firebase Auth/Firestore/Storage/Functions and the Stripe extension). This module manages Stripe **API** configuration (products/prices, webhooks, portal, tax, coupons, shipping rates). It does **not** mutate Firebase Extension instance settings.

## What it does
- `pull` → snapshots selected Stripe settings into `ssot.stripe.json` (you can keep one per env).
- `diff` → shows a high-level diff between local SSOT and remote Stripe.
- `apply` → upserts settings to match the SSOT (idempotent).

## Install
```bash
cd envs/stripe
# Node 18+ recommended
pnpm i   # or npm i / yarn
cp .env.example .env
# put your STRIPE_API_KEY in .env (test or live)
```

## Commands
```bash
# Pull remote -> local
pnpm pull                  # writes ssot.stripe.json
pnpm pull --file ssot.live.json

# Compare local vs remote
pnpm diff                  # reads ssot.stripe.json
pnpm diff --file ssot.live.json

# Apply local -> remote (idempotent upsert)
pnpm apply                 # reads ssot.stripe.json
pnpm apply --file ssot.live.json
```

## Configuration
Environment variables (place in `.env`):
- `STRIPE_API_KEY` (required): Your secret key for the target env (test or live).
- `STRIPE_API_VERSION` (optional): Override API version if needed (otherwise uses SDK pinned version).
- `STRIPE_ACCOUNT_ID` (optional): For Connect platforms when targeting a specific connected account for some actions.
- `HTTP_PROXY` (optional): Proxy for Stripe client if your environment requires it.

CLI flags:
- `--file`: Path to SSOT JSON. Default: `ssot.stripe.json` in this folder.
- `--verbose`: Print extra logs.
- `--dry`: For `apply`, show what would change without mutating.

## SSOT fields
The SSOT is intentionally **simple**. Minimal shape you can start with:

```jsonc
{
  "products": [
    {
      "code": "pro",              // your stable key for idempotency (stored in product.metadata.code)
      "name": "Pro Plan",
      "description": "Full access",
      "active": true,
      "metadata": { "tier": "paid" },
      "prices": [
        {
          "lookup_key": "pro_monthly",    // your stable key for upsert
          "currency": "usd",
          "unit_amount": 1900,
          "recurring": { "interval": "month", "interval_count": 1 },
          "tax_behavior": "exclusive"
        }
      ]
    }
  ],
  "webhooks": [
    {
      "url": "https://api.example.com/stripe/webhook",
      "connect": false,
      "enabled_events": ["checkout.session.completed","customer.subscription.updated"],
      "description": "Primary app webhook"
    }
  ],
  "portal": {
    "configurations": [
      {
        "is_default": true,
        "business_profile": { "headline": "LexBot PRO", "privacy_policy_url": "https://lexbot.pro/privacy", "terms_of_service_url": "https://lexbot.pro/terms" },
        "features": {
          "customer_update": { "enabled": true, "allowed_updates": ["email","address","name","phone","shipping","tax_id"] },
          "invoice_history": { "enabled": true },
          "payment_method_update": { "enabled": true },
          "subscription_cancel": { "enabled": true, "cancellation_reason": { "enabled": true } },
          "subscription_pause": { "enabled": false },
          "subscription_update": { "enabled": true }
        }
      }
    ]
  },
  "tax_settings": {
    "head_office": { "line1": "Strada Exemplu 123", "city": "București", "country": "RO", "postal_code": "010101" },
    "automatic_tax": { "enabled": true }
  },
  "coupons": [
    { "id_or_code": "WELCOME10", "percent_off": 10, "duration": "once", "name": "Welcome 10%" }
  ],
  "shipping_rates": [
    { "display_name": "Standard Shipping", "fixed_amount": { "amount": 500, "currency": "usd" }, "tax_behavior": "exclusive", "type": "fixed_amount" }
  ]
}
```

> ⚠️ Secrets: Webhook **signing secrets** are never pulled or written. Create/rotate those manually in your secret manager.

## Notes
- **Products/Prices** use `metadata.code` and `price.lookup_key` for idempotent updates.
- **Webhooks** are managed by `url` + `connect` flag. We update `enabled_events`, `description`, and `status` (enabled/disabled). We do *not* change secrets.
- **Portal** manages *configurations* (you can have multiple; one can be default).
- **Tax Settings** uses the API to configure head office and automatic tax.
- **Coupons & Shipping Rates** are optional helpers you can delete if you don't use them.

Keep your SSOT in Git per env (e.g., `ssot.dev.json`, `ssot.staging.json`, `ssot.live.json`).

---

MIT License © 2025 LBP-REACT
