# Contract review baseline

- Workflow: `legal_contract_review`
- Status: failed
- Duration: 5398.96 ms
- Prompt version: legal-pack-v1
- Workflow version: workflow-engine-v1
- Config fingerprint: `f65433714e4a7b17446c5c0ad3482dbc51d626cce5505401af516cd189d71315`
- Output fingerprint: `12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126`

## Error

No files were found for the current workflow selection

## Validation

- **ERROR** `workflow_failed`: No files were found for the current workflow selection
- **WARNING** `missing_required_section` `output_markdown`: Expected output section containing 'Risks'.
- **WARNING** `missing_required_section` `output_markdown`: Expected output section containing 'Open questions'.
- **WARNING** `missing_metadata_key` `structured_metadata.risk_items`: Expected structured metadata key 'risk_items'.
- **WARNING** `missing_metadata_key` `structured_metadata.open_questions`: Expected structured metadata key 'open_questions'.
- **WARNING** `insufficient_metadata_items` `structured_metadata.risk_items`: Expected at least 1 item(s) at 'risk_items', found 0.

## Rubric

- [ /5.0] **Identifies material legal and commercial risks from the source document** — weight 5.0
- [ /5.0] **Grounds findings in the selected source material without inventing clauses** — weight 5.0
- [ /5.0] **Provides practical approval, negotiation, or escalation recommendations** — weight 4.0
- [ /5.0] **Separates unresolved questions from known risks** — weight 3.0

## Output

_No output._
