# Billing Feature (Stripe + Firestore) — v3.1

**Fixes**
- **Renews on → Ends on**: when a cancellation is scheduled (`cancel_at` or `cancel_at_period_end`), the Pro card now shows **Ends on** with the correct date. 
- **Robust timestamp parsing**: handles Firestore `Timestamp` objects via `toDate()` in addition to `number|string|{seconds}`.
- **Targeted diagnostics only**: removed noisy console logs and added two concise debug points:
  - `diag:subscriptions` — emitted when the subscriptions snapshot updates (status + key fields).
  - `diag:view` — emitted when the derived view state changes (onPro, ends/renews date, etc.).

**Rules per Stripe docs**
- `cancel_at_period_end = true` → show `current_period_end` as the end date.
- `cancel_at` is a specific UNIX timestamp → use that as the end date.
- After the period, the subscription `status` becomes `canceled` and `canceled_at` is set; Pro UI downgrades accordingly.
