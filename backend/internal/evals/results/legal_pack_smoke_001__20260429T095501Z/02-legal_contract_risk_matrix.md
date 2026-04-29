# Risk matrix baseline

- Workflow: `legal_contract_risk_matrix`
- Status: failed
- Duration: 151.32 ms
- Prompt version: legal-pack-v1
- Workflow version: workflow-engine-v1
- Config fingerprint: `db089f507c5128ba08118d96ec2527d938c93ba711368b36410a9214305488b9`
- Output fingerprint: `12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126`

## Error

No files were found for the current workflow selection

## Validation

- **ERROR** `workflow_failed`: No files were found for the current workflow selection
- **WARNING** `missing_required_section` `output_markdown`: Expected output section containing 'Risk'.
- **WARNING** `missing_required_section` `output_markdown`: Expected output section containing 'Recommendation'.
- **WARNING** `missing_metadata_key` `structured_metadata.risk_items`: Expected structured metadata key 'risk_items'.
- **WARNING** `insufficient_metadata_items` `structured_metadata.risk_items`: Expected at least 1 item(s) at 'risk_items', found 0.

## Rubric

- [ /5.0] **Risk rows are specific, non-duplicative, and tied to actual source terms** — weight 5.0
- [ /5.0] **Severity levels are reasonable for the configured review posture** — weight 4.0
- [ /5.0] **Recommendations are concrete enough to support approval or negotiation decisions** — weight 4.0

## Output

_No output._
