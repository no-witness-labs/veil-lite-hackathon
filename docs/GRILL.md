# Grill With Docs: Scope Stress Test

This document applies the `grill-with-docs` approach: challenge the plan against Canton terminology, domain boundaries, and hackathon constraints.

## Question 1: What is the smallest real workflow?

Recommended answer: a known-counterparty bilateral secured loan with offer, accept, active loan, repay. Liquidation is optional.

Rationale: This is recognizable as lending while staying small enough for a hackathon. It intentionally models the execution layer after lender and borrower already know each other.

## Question 2: What is the Canton-specific reason this must exist?

Recommended answer: private stakeholder visibility plus selective regulator disclosure. The demo must show outsider non-visibility.

Rationale: If we do not show privacy, this looks like a generic lending demo.

## Question 3: What do judges look for?

Recommended answer: optimize the PRD, demo, and deck around four judging signals:

- **Clear use of privacy/confidentiality**: show lender/borrower/regulator visibility and outsider non-visibility as the core product value, not a footnote.
- **A real financial use case**: position the workflow as repo-style financing/private credit against tokenized collateral.
- **Strong product logic, not infra for infra's sake**: every step must map to financing logic — offer, accept, collateral lock, repayment, release, and optional liquidation.
- **Credible relevance to institutional or professional markets**: speak to treasury, repo, OTC secured lending, asset managers, auditors, and regulated/private-credit workflows.

Rationale: Canton privacy is only compelling if attached to a believable professional-market workflow. Avoid presenting Veil as generic privacy infrastructure or a toy DeFi clone.

## Question 4: Does this satisfy real-world business relevance?

Recommended answer: yes, if framed as private repo-style financing against tokenized collateral rather than generic DeFi lending. The real-world analogue is institutional repo, private credit, OTC secured lending, treasury financing, or RWA-backed credit.

Rationale: borrower/lender privacy, collateral confidentiality, and selective regulator visibility are real institutional requirements.

## Question 5: Is the asset / financing logic clear enough?

Recommended answer: make it explicit in every demo and deck: 100 USDC-equivalent principal, 5 interest, 105 repayment, 150 tokenized T-Bill/MMF collateral units, 66.7% initial LTV, collateral lock, repayment release.

Rationale: judges need to see a financing transaction, not just a generic private contract.

## Question 6: Where does tokenization/onchain coordination genuinely help?

Recommended answer: tokenized collateral and loan state become shared workflow facts among lender, borrower, and regulator while remaining invisible to outsiders.

Rationale: this sits between public-chain transparency and fragmented offchain documents/reconciliation.

## Question 7: What should not be modeled yet?

Recommended answer: lender/borrower discovery, marketplace loan programs, borrower request workflow, full Token Standard integration, wallet gateway, k-of-n oracles, reserves, partial liquidation, production compliance.

Rationale: These are valuable but distract from the hackathon proof.

## Question 8: What are the key Daml authorization boundaries?

Recommended answer:

- `LoanOffer`: lender signatory; borrower and regulator observers; borrower controls `Accept`; lender controls `Withdraw` if included.
- `Loan`: lender and borrower signatories; regulator observer; borrower controls `Repay`; lender controls optional `Liquidate`.
- `PriceFeed`: oracle signatory; relevant loan parties observers.

Rationale: This maps directly to Canton authorization semantics.

## Question 9: How do we prevent fuzzy language?

Use:

- “visible to stakeholders/observers,” not “encrypted for everyone.”
- “archive/create lifecycle,” not “mutate contract.”
- “controller exercises a choice,” not “caller invokes a function.”
- “outsider cannot query visible contracts,” not “nobody can know anything exists” unless proven by the specific participant view.
- “known-counterparty private lending MVP,” not “open lending marketplace.”

## Question 10: What is the biggest product risk?

Recommended answer: building too much infrastructure and not having a clean demo.

Mitigation: Daml-only proof first; UI second; production integrations after judging.

## Question 11: What is the biggest technical risk?

Recommended answer: trying to reuse the production lending code directly, which carries complexity not needed for the MVP.

Mitigation: create this separate directory and implement a small `Veil` model.

## Question 12: Should the lender offer first, before knowing the borrower?

Recommended answer for this MVP: yes, because the lender and borrower are assumed to know each other before the on-ledger workflow starts. This is a known-counterparty private credit flow, not a discovery marketplace.

Thuy's concern is valid for a marketplace product. If lender and borrower do not know each other, the better future model is:

1. Lender publishes a `LoanProgram`.
2. Borrower creates a private `BorrowRequest`.
3. Lender reviews that request and creates a borrower-specific `LoanOffer`.
4. Borrower accepts the offer to create the active `Loan`.

Decision: keep the hackathon MVP simple with borrower-specific `LoanOffer` first, and document `LoanProgram` / `BorrowRequest` as next step.

Important Canton caveat: `public LoanProgram` should not be described as Ethereum-style globally readable state. In Canton, visibility still comes from stakeholders/observers or off-ledger/app-provider discovery.

## Decision checkpoint

Proceed only when we agree on these scope constraints:

- Mandatory: known-counterparty offer, accept, repay, privacy views.
- Optional: liquidation.
- Next step: loan program + borrow request marketplace flow.
- Deferred: production integrations.

## Definition of complete checkpoint

The project is hackathon-complete only when these gates are satisfied:

- **Judge-readiness**: privacy/confidentiality is obvious, the financial use case is real, product logic is stronger than infrastructure novelty, and institutional/professional relevance is credible.
- **Functional demo**: lender offer, borrower accept, collateral lock, regulator observe, outsider non-visibility, borrower repay, and collateral release all work in one rehearsed flow.
- **Asset logic**: demo terms include 100 USDC-equivalent principal, 5 interest, 105 repayment, 150 tokenized T-Bill/MMF collateral units, and 66.7% initial LTV or an equivalent fixture.
- **Engineering**: Daml build/tests pass, lifecycle/privacy tests exist, and the frontend/demo path runs locally or from a hosted URL.
- **Submission**: public repo, live product URL, deck, 3-minute video, and README links are ready.
