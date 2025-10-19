# Billing Feature (Stripe + Firestore) — v3.2

**What changed**
- **Fix: Firestore Timestamp parsing.** Some Stripe Firebase Extension mirrors store time fields (e.g. `cancel_at`, `current_period_end`) as **Firestore `Timestamp`** objects. We now normalize **all** timestamp-like values (`number` seconds, `string`, `{seconds}`, or `Timestamp`) via a single `toMillis()` helper. This immediately fixes the case where the UI didn't flip to *"Ends on"* after cancelling in the customer portal.
- **New: Explicit renewal/end line on the Pro card.** Under the Pro button you'll now always see either **“Renews on …”** or **“Ends on …”** when a cancellation is scheduled.
- **Diagnostics.** Two small, targeted debug lines:
  - `diag:subscriptions` — emitted on snapshot with key fields (`status`, `cancel_at`, `current_period_end`).
  - `diag:view` — derived view state (computed `onPro`, renewal/ends dates).

**Rules (per Stripe)**
- `cancel_at_period_end = true` → show `current_period_end` as the end date.
- `cancel_at` populated (a specific timestamp) → that exact time is the end date.
- After that time passes, subscription `status` becomes `canceled`; UI downgrades to Free automatically when the snapshot updates.

Noisy or unrelated logs have been left untouched elsewhere.
