# Public Contract Eval Seed 001

Starter public-contract fixture set for Legal Pro workflow evals.

## Included text fixtures

Use these `.txt` files for the internal workflow eval manifest:

### NDA / confidentiality

- `contracts/nda/sec_fusionio_sandisk_nda.txt`
- `contracts/nda/sec_aspac_confidentiality_agreement.txt`
- `contracts/nda/sec_sequans_renesas_mutual_nda.txt`
- `contracts/nda/sec_csr_qualcomm_nda.txt`
- `contracts/nda/sec_hifn_exar_confidentiality_nda.txt`

### MSA / SaaS

- `contracts/msa_saas/sec_anebulo_potrero_msa.txt`
- `contracts/msa_saas/sec_indegene_cingulate_msa.txt`
- `contracts/msa_saas/sec_proquest_ibm_msa.txt`
- `contracts/msa_saas/sec_anthem_castlight_saas.txt`

### DPA / data-heavy

- `contracts/dpa/sec_relativity_kldiscovery_master_terms_dpa.txt`

## Binary fixtures

These are kept as source references, but the default eval manifest does not use them:

- `contracts/nda/cure53_nda_template.odt`
- `contracts/msa_saas/cure53_msa_template.odt`
- `contracts/dpa/cure53_dpa_template.odt`
- `contracts/dpa/github_data_protection_agreement.pdf`

Plain text is less brittle for this eval path. Convert binary fixtures to `.txt` before adding them to workflow eval cases.

## Main eval case

Use:

```text
backend/internal/evals/cases/legal_pro_public_contracts.example.json
```

That case runs each Legal Pro workflow against three targeted contracts:

```text
legal_nda_review              → 3 NDA sources
legal_msa_review              → 3 MSA/SaaS sources
legal_contract_review         → 3 complex commercial sources
legal_contract_risk_matrix    → 3 risk-varied sources
legal_clause_extraction       → 3 clause-rich sources
legal_fallback_language       → 3 contracts with negotiable clause issues
legal_negotiation_brief       → 3 negotiation-suitable sources
legal_obligation_tracker      → 3 obligation-heavy sources
legal_matter_handoff          → 3 larger handoff-suitable sources
```

## Source notes

- Keep `manifest.json` with source URLs alongside eval outputs so the dataset stays auditable.
- SEC EDGAR exhibits are public filings, but check your redistribution/internal-use policy before committing copied contract text to your product repo.
- Cure53 templates are sourced from the public `cure53/Contracts` GitHub repository.
