# Billing Feature (Firestore Stripe Payments)

This patch adds **targeted console logs** so we can diagnose Stripe Customer Portal issues quickly.

## New diagnostics
- Per-session **trace id** shown in every log line.
- `openBillingPortal` logs:
  - write attempt (uid + return_url)
  - created doc path `customers/{uid}/portal_sessions/{id}`
  - each snapshot tick (existence)
  - extension error details
  - redirect URL (and redirect failure, if any)
- `startCheckout` mirrors the same visibility.
- `BillingPage` logs button clicks and limits/subscription fetches.

## Optional: fixed test portal URL
If you pasted a static test link from Stripe Dashboard, set:
```
VITE_STRIPE_PORTAL_TEST_URL=https://billing.stripe.com/p/login/test_XXXX
```
When present, the **Cancel subscription** button will redirect directly to this URL, bypassing Firestore.

## Files
- `features/billing/api.ts`
- `features/billing/BillingPage.tsx`
- `features/billing/index.ts`
- `features/billing/README.md`
