# PRD: Veil Hackathon MVP

## Problem statement

Institutional financing workflows cannot run on fully transparent public ledgers when borrower identity, lender identity, loan terms, collateral, health, and liquidation timing are public. Existing DeFi-style lending demonstrates useful mechanics, but its public-state model leaks exactly the information professional counterparties need to protect.

At the same time, purely offchain private credit workflows are fragmented across emails, PDFs, spreadsheets, custodians, and reconciliation processes. Veil targets the middle ground: shared workflow state for relevant parties, without global public disclosure.

## Product hypothesis

A small Canton application can demonstrate a better primitive: **private repo-style financing against tokenized collateral** where lender and borrower already know each other, only relevant parties see the deal, and an optional regulator can receive selective disclosure.

## Scope decision: known-counterparty MVP

For the hackathon MVP, lender and borrower are assumed to know each other before the on-ledger flow starts. Discovery, borrower acquisition, and marketplace matching are intentionally out of scope.

This means the app models the **execution layer** of a private bilateral credit deal, not a public lending marketplace:

1. Off-ledger relationship / negotiation already identifies lender, borrower, desired principal, collateral, and rough terms.
2. Lender creates a borrower-specific `LoanOffer` on Canton.
3. Borrower accepts the offer.
4. The resulting loan is visible only to lender, borrower, and optional regulator.

This is realistic for institutional private credit, repo, OTC lending, and relationship-based treasury lending.

## Target users

### Primary user: institutional lender

Wants to extend secured credit to a known borrower without publicly revealing counterparties, terms, pricing, or liquidation state.

### Primary user: institutional borrower

Wants credit from a known lender while keeping treasury activity, collateral, and borrowing terms confidential.

### Secondary user: regulator/auditor

Needs visibility into the transaction for compliance/audit without making the transaction public.

### Negative user: outsider

Used in the demo to prove Canton privacy: this party should not see the offer or loan.

## Hackathon evaluation criteria

Veil should be judged against four business/product criteria:

1. **Strong real-world business relevance** — institutional repo, private credit, OTC secured lending, treasury financing, and RWA-backed credit are real workflows.
2. **Clear asset / financing logic** — the demo must show principal asset, collateral asset, haircut/LTV, repayment amount, collateral lock, and collateral release.
3. **Practical workflow design** — known-counterparty execution is realistic for institutional financing and avoids fake marketplace discovery scope.
4. **Tokenization/onchain coordination genuinely helps** — tokenized collateral and loan state are coordinated across lender, borrower, and regulator with Canton privacy.

## What judges look for

The pitch, demo, PRD, and deck should make these judging signals obvious:

1. **Clear use of privacy/confidentiality** — the demo must show that lender, borrower, and regulator can see the deal while an outsider cannot query the offer, loan, collateral state, or liquidation-relevant data.
2. **A real financial use case** — frame Veil as private repo-style financing/private credit against tokenized collateral, not generic lending or generic privacy infrastructure.
3. **Strong product logic, not infrastructure for infrastructure's sake** — every contract, UI state, and demo step should explain a financing workflow: offer, accept, collateral lock, repayment, release, and optional liquidation.
4. **Credible relevance to institutional or professional markets** — emphasize institutional treasury, repo, OTC secured lending, asset managers, auditors, and regulated/private-credit workflows.

## Concrete asset / financing logic

Recommended demo story:

```text
Borrower pledges 150 tokenized T-Bill/MMF collateral units
Lender provides 100 USDC-equivalent principal
Borrower owes 105 at repayment
Initial LTV = 100 / 150 = 66.7%
Collateral remains locked until repayment or optional liquidation
```

Core fields:

- principal asset: USDC, Canton Coin, or another cash-like token for the demo;
- principal amount: `100`;
- interest: `5`;
- repayment amount: `105`;
- collateral asset: tokenized T-Bill/MMF/fund/invoice/RWA claim;
- collateral quantity/value: `150`;
- maturity date;
- optional oracle price for liquidation.

## Goals

1. Demonstrate private borrower-specific loan offer visibility.
2. Demonstrate borrower acceptance into an active loan.
3. Demonstrate collateral lock during active loan.
4. Demonstrate repayment and collateral release.
5. Demonstrate regulator observer visibility.
6. Demonstrate outsider non-visibility for offer and loan.
7. Optionally demonstrate private liquidation after oracle price drop.

## Non-goals

1. No lender/borrower discovery marketplace.
2. No `LoanProgram` catalog in the MVP.
3. No borrower-created `BorrowRequest` in the MVP.
4. No real money movement.
5. No production Token Standard integration.
6. No external wallet signing.
7. No PQS-backed analytics dashboard.
8. No production oracle network.
9. No partial liquidation.
10. No reserve/bad-debt waterfall.
11. No mainnet readiness claim.

## User stories

### US1: Create private offer

As a lender, I can create a loan offer for a known borrower so only the lender, borrower, and regulator can see the terms.

Acceptance criteria:

- Lender controls offer creation and withdrawal.
- Offer includes lender, borrower, regulator, principal, interest, collateral asset, collateral quantity, and maturity.
- Lender sees the offer.
- Borrower sees the offer.
- Regulator sees the offer.
- Outsider does not see the offer.

### US2: Accept offer

As a borrower, I can accept the offer so an active loan is created and collateral is locked.

Acceptance criteria:

- Borrower controls the accept choice.
- Active loan records lender, borrower, regulator, principal, interest, collateral asset, collateral quantity, maturity, and status.
- The accepted offer is archived or no longer active.
- Outsider cannot see the loan.

### US3: Repay loan

As a borrower, I can repay the loan so the loan closes and collateral is released.

Acceptance criteria:

- Borrower controls repayment.
- Loan is archived or status moves to closed.
- Borrower-visible state shows collateral released.
- Lender-visible state shows repayment received.

### US4: Observe as regulator

As a regulator, I can view offer and loan state without being able to accept, repay, or liquidate.

Acceptance criteria:

- Regulator is an observer, not a controller.
- UI shows read-only regulator role.
- Daml tests prove regulator visibility.

### US5: Prove outsider privacy

As the demo presenter, I can switch to outsider view and show no sensitive contracts.

Acceptance criteria:

- Outsider query returns no borrower-specific offers or loans.
- UI explicitly labels this as Canton privacy.

### US6: Optional liquidation branch

As a lender, I can liquidate when an oracle price drop makes collateral insufficient.

Acceptance criteria:

- Oracle publishes price.
- Liquidation only succeeds below threshold.
- Outsider cannot see liquidation-relevant loan state.

## Future marketplace extension

The comment about lender programs and borrow requests is valid for a marketplace-style product:

```text
Lender publishes LoanProgram
        ↓
Borrower creates BorrowRequest
        ↓
Lender creates LoanOffer
        ↓
Borrower accepts
```

We are not implementing that in the hackathon MVP because it adds discovery and matching scope. It should be documented as the first post-MVP extension if the core contract remains simple.

Canton caveat: a “public loan program” is not Ethereum-style global readable state. Discovery would likely be app-provider mediated, off-ledger, or scoped to an allowlisted borrower cohort.

## Proposed modules

### Deep module 1: Daml financing lifecycle

A compact Daml module containing templates and choices:

- `LoanOffer`
- `Loan`
- `CashHolding` or equivalent local demo principal representation
- `CollateralHolding` or equivalent local demo collateral representation
- `PriceFeed` for optional liquidation
- collateral lock/release representation

Why deep: most product logic and authorization live here and can be tested with Daml Script.

### Deep module 2: Demo scenario runner

A deterministic script/API layer that runs the same lifecycle every time:

- reset demo state
- create offer
- accept
- repay
- price drop
- liquidate
- query by role

Why deep: keeps UI simple and ensures the 3-minute demo never depends on fragile manual ledger setup.

### Shallow module: Role-based UI

A simple browser UI for judges:

- role tabs
- current visible contracts
- action buttons
- explanation panel

Why shallow: it should show the domain, not become a product platform.

## UX requirements

The UI must answer these questions immediately:

1. Who am I viewing as?
2. What can this party see?
3. What can this party do?
4. Why is this different from public-chain lending?
5. Why does this MVP assume known counterparties?

## Demo script

1. Explain that lender and borrower already know each other from an off-ledger private credit relationship.
2. Open app as lender.
3. Create offer: 100 USDC-equivalent principal, 5 interest, 150 tokenized T-Bill/MMF collateral units, 66.7% initial LTV.
4. Switch to borrower: offer is visible.
5. Switch to outsider: offer is not visible.
6. Switch to borrower: accept offer.
7. Switch to lender/borrower/regulator: active loan is visible.
8. Switch to outsider: active loan is not visible.
9. Repay loan: loan closes and collateral releases.
10. Optional: reset, accept, price drops, lender liquidates.

## Definition of complete for hackathon

Veil is complete enough for hackathon submission when all of these gates are true:

### Product / judge-readiness gate

- The demo clearly uses privacy/confidentiality: lender, borrower, and regulator can see the deal; outsider cannot see offer, loan, collateral state, or liquidation-relevant data.
- The demo is recognizably a real financial use case: private repo-style financing/private credit against tokenized collateral.
- The demo shows strong product logic, not infrastructure for infrastructure's sake: offer, accept, collateral lock, repayment, collateral release, and optional liquidation all map to financing logic.
- The story is credible for institutional/professional markets: treasury financing, repo, OTC secured lending, asset managers, auditors, or regulated private credit.

### Functional demo gate

- Lender can create a borrower-specific offer with concrete terms: 100 USDC-equivalent principal, 5 interest, 105 repayment, 150 tokenized T-Bill/MMF collateral units, and 66.7% initial LTV.
- Borrower can accept the offer and create an active loan.
- Collateral is represented as locked/encumbered while the loan is active.
- Borrower can repay and release collateral.
- Regulator/auditor role can observe but cannot act.
- Outsider role has an explicit empty/non-visible view.
- Optional bonus: oracle price drop enables lender liquidation.

### Engineering gate

- Daml package builds.
- Daml Script tests pass.
- Tests include positive lifecycle and privacy checks.
- Tests include the concrete asset/financing numbers or their equivalent fixture.
- Frontend can run locally or via hosted link.
- README includes short setup/demo instructions.
- Demo can be completed in under 3 minutes.

### Submission gate

- Public repo URL exists.
- Live product URL exists.
- Presentation deck exists.
- 3-minute video exists and shows the working demo.
- README includes all final submission links and honest non-goals.

## Success metrics for hackathon

- A judge can understand the product in 30 seconds.
- The demo clearly shows outsider non-visibility.
- The codebase is small enough to inspect.
- The README is honest about known-counterparty MVP vs marketplace future work.
- The final video has no dependency on live external infrastructure.

## Open questions

1. Should the hackathon name be `Veil`, `No Witness Lending`, or something else?
2. Should liquidation be in the mandatory demo, or kept as bonus if time allows?
3. Should the first implementation be Daml-only before adding backend/frontend?

## Recommendation

Start Daml-only, prove privacy and lifecycle with scripts, then wrap the proof in a tiny UI. Do not port the full existing lending protocol. Keep `LoanProgram` / `BorrowRequest` as a documented next step, not MVP scope.
