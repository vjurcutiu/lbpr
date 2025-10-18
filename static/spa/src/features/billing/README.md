# Billing Feature (Stripe + Firestore) — v3

**Fix:** “Renews on” now reliably flips to **“Cancels on”** right after scheduling a cancellation.

Rules implemented per Stripe docs:
- `cancel_at_period_end` means cancel at end of the current period → show `current_period_end`.
- `cancel_at` is an explicit future timestamp → show that date.
- When actually canceled, `status` becomes `canceled` and `canceled_at` records that moment.

Timestamps are parsed defensively (`number` | `string` | `{seconds: number}`).
