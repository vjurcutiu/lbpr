
# Usage limits

Limits are enforced per user per billing period (Free = no refresh; Pro = rolling window anchored to Stripe).

Currently tracked metrics:
- **messages** (chat requests)
- **upload_tokens** / **file_processing_tokens** (estimated tokens extracted from uploaded documents)
- **workflow_tokens** (estimated tokens billed for workflow generation and refinement)
- **transcribe_seconds** (billed audio seconds)
- **ocr_images** (number of images/pages processed by OCR)

Current Pro defaults:
- **2,000 messages** per month
- **20,000,000 file upload / file processing tokens** per month
- **5,000,000 workflow tokens** per month
- **60,000 transcription seconds** per month
- **1,000 OCR images** per month

See `core/rate_limit.py` and `usage_snapshot()` for current-period diagnostics.
