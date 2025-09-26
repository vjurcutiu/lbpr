# Billing Feature (Firestore Stripe Payments)

This frontend-only slice integrates with the **Firestore Stripe Payments** extension:
https://extensions.dev/extensions/invertase/firestore-stripe-payments

## What it does
- Lists active Stripe Products & Prices mirrored into Firestore by the extension.
- Starts a Checkout by writing a document to `customers/{uid}/checkout_sessions`.
- Opens the Billing Portal by writing a document to `customers/{uid}/portal_sessions`.
- Shows the user's current subscriptions from `customers/{uid}/subscriptions`.

## Assumptions
- Firebase Web SDK is installed (`firebase` v9+ modular).
- Your app initializes Firebase once. This slice tries to reuse the default app;
  if no app exists it will initialize from Vite env vars:
    - `VITE_FIREBASE_API_KEY`
    - `VITE_FIREBASE_AUTH_DOMAIN`
    - `VITE_FIREBASE_PROJECT_ID`
- User must be authenticated with Firebase Auth (this screen is behind your `ProtectedRoute`).
- The extension is already installed and configured in your Firebase project.

## Security Rules (sketch)
Use the rules recommended by the extension docs. Minimum: allow read on `products/*` and `products/*/prices/*` for signed-in users,
and allow writes to `customers/{uid}/checkout_sessions` and `customers/{uid}/portal_sessions` only by that user.
The extension completes these writes server-side and adds readonly fields like `url` or `sessionId`.

## Files
- `features/billing/api.ts`        — Firestore helpers (create checkout/portal sessions, load products, observe subscriptions).
- `features/billing/BillingPage.tsx` — A ready-to-use UI that plugs into your existing routes at `/billing`.
- `features/billing/index.ts`      — Barrel exports.

## Optional: Restrict visible products
If you want to pin which prices appear in UI, set `VITE_STRIPE_PRICE_ALLOWLIST` to a comma-separated list of price IDs
(e.g. `price_123,price_456`). Otherwise all active prices are shown.
