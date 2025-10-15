
# Usage limits (messages + upload tokens)

This deployment enforces per-user usage limits across **chat messages** and **file ingestion tokens**.

## Window policy
- **Paid plans:** window resets on **billing anchor + 30 days** (anchor = time of payment).
- **Free plan:** window **never refreshes** (cumulative use).

## Redis keys
- `rl:{uid}:meta` — per-user metadata (plan, caps, billing anchor)
- `rl:{uid}:usage:{period_id}` — per-window counters
  - For free plan, `period_id = "infinite"`

## Admin helpers

```python
from core.rate_limit import set_plan, set_caps, set_billing_anchor
import time
uid = "u_123"

# set plan
await set_plan(uid, "pro")      # or "free"

# set caps (override defaults)
await set_caps(uid, cap_messages=2000, cap_upload_tokens=500_000)

# set billing anchor to "now" (payment time)
await set_billing_anchor(uid, int(time.time()))
```
