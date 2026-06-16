# Grill With Docs: Scope Stress Test

This document applies the `grill-with-docs` approach: challenge the plan against Canton terminology, domain boundaries, and hackathon constraints.

## Question 1: What is the smallest real workflow?

Recommended answer: a bilateral secured loan with offer, accept, active loan, repay. Liquidation is optional.

Rationale: This is recognizable as lending while staying small enough for a hackathon.

## Question 2: What is the Canton-specific reason this must exist?

Recommended answer: private stakeholder visibility plus selective regulator disclosure. The demo must show outsider non-visibility.

Rationale: If we do not show privacy, this looks like a generic lending demo.

## Question 3: What should not be modeled yet?

Recommended answer: full Token Standard integration, wallet gateway, k-of-n oracles, reserves, partial liquidation, production compliance.

Rationale: These are valuable but distract from the hackathon proof.

## Question 4: What are the key Daml authorization boundaries?

Recommended answer:

- `LoanOffer`: lender signatory; borrower and regulator observers; borrower controls `Accept`.
- `Loan`: lender and borrower signatories; regulator observer; borrower controls `Repay`; lender controls optional `Liquidate`.
- `PriceFeed`: oracle signatory; relevant loan parties observers.

Rationale: This maps directly to Canton authorization semantics.

## Question 5: How do we prevent fuzzy language?

Use:

- “visible to stakeholders/observers,” not “encrypted for everyone.”
- “archive/create lifecycle,” not “mutate contract.”
- “controller exercises a choice,” not “caller invokes a function.”
- “outsider cannot query visible contracts,” not “nobody can know anything exists” unless proven by the specific participant view.

## Question 6: What is the biggest product risk?

Recommended answer: building too much infrastructure and not having a clean demo.

Mitigation: Daml-only proof first; UI second; production integrations after judging.

## Question 7: What is the biggest technical risk?

Recommended answer: trying to reuse the production lending code directly, which carries complexity not needed for the MVP.

Mitigation: create this separate directory and implement a small `VeilLite` model.

## Decision checkpoint

Proceed only when we agree on these scope constraints:

- Mandatory: offer, accept, repay, privacy views.
- Optional: liquidation.
- Deferred: production integrations.
