
# Usage limits

Limits are enforced per user per billing period (Free = no refresh; Pro = rolling window anchored to Stripe).

Currently tracked metrics:
- **messages** (chat requests)
- **upload_tokens** / **file_processing_tokens** (estimated tokens extracted from uploaded documents)
- **workflow_tokens** (estimated tokens billed for workflow generation and refinement)
- **transcribe_seconds** (billed audio seconds)
- **ocr_images** (number of images/pages processed by OCR)

See `core/rate_limit.py` and `usage_snapshot()` for current-period diagnostics.
