# Public Contract Eval Seed 001

Starter fixture set for legal workflow evals.

## Included files

This zip includes two SEC contracts fetched as plain-text files:

- `contracts/nda/sec_fusionio_sandisk_nda.txt`
- `contracts/nda/sec_aspac_confidentiality_agreement.txt`

The rest of the contract list is in `manifest.json` and `sources/download_links.csv`. Run `scripts/fetch_public_contracts.py` from this folder in a normal networked environment to fetch the remaining public sources.

## Why text files?

For eval ingestion, plain text is the least brittle format. SEC exhibits are usually HTML, while templates may be ODT/PDF. The fetch script converts SEC/Justia HTML pages into `.txt` files and saves binary PDF/ODT templates directly.

## Suggested first eval case

```json
{
  "eval_id": "legal_pack_smoke_001",
  "document_set": "public_contract_eval_seed_001",
  "workflows": [
    "legal_nda_review",
    "legal_risk_matrix",
    "legal_clause_extraction",
    "legal_negotiation_brief"
  ]
}
```

## Source notes

- Keep `manifest.json` with source URLs alongside eval outputs so the dataset stays auditable.
- SEC EDGAR exhibits are public filings, but check your redistribution/internal-use policy before committing copied contract text to your product repo.
- Cure53 templates are sourced from the public `cure53/Contracts` GitHub repository.
