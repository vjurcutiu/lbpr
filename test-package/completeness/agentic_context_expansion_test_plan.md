# Agentic Context Expansion Test Plan

Use this with `synthetic_msa_context_expansion_contract.md`.

The contract is intentionally structured so that correct answers require more than a single top-k result. Many answers require:
- the initially retrieved clause,
- neighboring chunks,
- definitions,
- referenced sections,
- and one or more exhibits.

## Primary Evaluation Questions

### 1. Termination for convenience
**Question:** If Customer terminates for convenience, what does it still have to pay, and what help does Provider still need to provide?

**Expected context expansion:**
- Section 14.2 — termination for convenience right
- Section 4.4 — payment after termination
- Section 14.6 — transition/post-termination assistance
- Exhibit D — exit assistance fees and limits
- Section 7.7 or 10.5 — limited post-termination use rights
- Section 14.7 — survival

**What good behavior looks like:** The answer should not stop at “60 days’ notice.” It should mention unpaid committed subscription fees, approved pass-through charges, exit assistance fees, data export/transition assistance, and limited use during exit.

---

### 2. Restricted Data model training
**Question:** Can Provider use Restricted Data to train or improve models?

**Expected context expansion:**
- Definition of Restricted Data in Section 1.1
- Section 6.6 — Restricted Data handling
- Section 9.3 — Restricted Data controls
- Exhibit A.3 — Customer Data in AI Features
- Exhibit B.4 — Model Improvement Restriction
- Section 7.5 / 9.5 — Derived Insights and anonymized usage data

**What good behavior looks like:** The answer should distinguish Restricted Data from Derived Insights and aggregated/anonymized data. It should say Restricted Data cannot be used for shared model training/improvement unless expressly approved.

---

### 3. Liability for Restricted Data breach
**Question:** What liability cap applies if Provider breaches Restricted Data controls?

**Expected context expansion:**
- Section 12.1 — general cap
- Section 12.3 — super-cap and uncapped exceptions
- Sections 6.6, 9.3, 9.4 — the specific obligations
- Section 11.4 — data claims
- Section 13.4 — Critical Service Failure remedy, if relevant

**What good behavior looks like:** The answer should not only cite the general 12-month fee cap. It should identify the 3x fees super-cap for certain Restricted Data breaches and the uncapped liability for unauthorized public disclosure of trade secrets or credentials.

---

### 4. Business Output ownership
**Question:** Who owns the workflow outputs, risk matrices, and negotiation briefs?

**Expected context expansion:**
- Definitions of Business Output, Deliverables, Provider Tools, Foreground IP
- Section 7.2 — ownership of Business Output and Deliverables
- Section 7.3 — Provider Tools
- Exhibit B.1 — Customer-owned Business Output
- Exhibit B.2 — reusable workflow components
- Exhibit B.4 — model improvement restriction

**What good behavior looks like:** The answer should say Customer owns Business Output after payment, but Provider keeps reusable workflow components, tools, templates, orchestration logic, and Background IP.

---

### 5. Service credits vs termination
**Question:** Are Service Credits the only remedy for an outage?

**Expected context expansion:**
- Section 8.2 — Service levels
- Exhibit C.2 and C.3 — credit amounts and process
- Exhibit C.4 — exceptions
- Section 13.4 — Critical Service Failure remedy
- Section 14.3 — termination for cause
- Section 12.4 — Service Credits and liability cap

**What good behavior looks like:** The answer should state Service Credits are generally the exclusive financial remedy for availability failures, but not for Critical Service Failures, data incidents, confidentiality breaches, Restricted Data breaches, or uncured material breach.

---

### 6. Customer use restrictions and competitor use
**Question:** Can Customer use the Services for a competitor or upload restricted customer purchase data?

**Expected context expansion:**
- Definition of Competitor Use
- Section 5.2 — use restrictions
- Exhibit A.4 — Competitor Use Controls
- Exhibit A.1/A.2 — Restricted Data classes and handling
- Exhibit A.6 — prohibited data
- Section 9.3 — restricted data controls

**What good behavior looks like:** The answer should separate competitor use from restricted data use. Competitor Use is prohibited unless expressly permitted in an SOW and controls are enabled. Restricted customer purchase history is Restricted Data and requires enhanced handling.

---

### 7. Return and deletion after termination
**Question:** What happens to Customer Data and Restricted Data in support tickets after termination?

**Expected context expansion:**
- Section 9.7 — return and deletion
- Exhibit A.5 — Support Materials
- Section 14.6 — transition assistance
- Exhibit D.1/D.4 — exit assistance and survival of controls
- Section 14.7 — survival

**What good behavior looks like:** The answer should mention 30-day export availability, production deletion within 60 days after export period, backup deletion up to 180 days, and support-ticket Restricted Data deletion within 30 days after the ticket closes.

---

### 8. Critical Service Failure
**Question:** What counts as a Critical Service Failure and what remedies does Customer have?

**Expected context expansion:**
- Definition of Critical Service Failure
- Section 13.4 — remedy
- Section 8.2 — service levels
- Exhibit C.4 — Service Credit exceptions
- Section 14.3 — termination for cause
- Section 4.4 — refund if terminated for Provider breach

**What good behavior looks like:** The answer should connect the definition to remediation obligations, two-business-day restoration, termination right for affected SOW, and pro-rata refund of prepaid unused subscription fees.

---

## Quick Pass/Fail Signals

A run is probably working if:
- The retrieval trace shows more than one retrieval round for questions 1–5.
- It fetches sections that are not semantically identical to the user question but are legally required.
- It pulls exhibits when referenced by the operative clause.
- It includes definitions when the answer turns on defined terms.
- It does not answer from the first obvious clause only.

A run is probably failing if:
- Termination answers only cite Section 14.2.
- Restricted Data answers miss Exhibit A or Exhibit B.4.
- Liability answers only cite Section 12.1 and miss Section 12.3.
- Ownership answers miss Provider Tools / reusable workflow components.
- Service credit answers fail to mention Critical Service Failure exceptions.
