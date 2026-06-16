# PRD: Veil Lite Hackathon MVP

## Problem statement

Institutional lending workflows cannot run on fully transparent public ledgers when borrower identity, lender identity, loan terms, collateral, health, and liquidation timing are public. Existing DeFi-style lending demonstrates useful mechanics, but its public-state model leaks exactly the information professional counterparties need to protect.

## Product hypothesis

A small Canton application can demonstrate a better primitive: **private bilateral secured lending** where only relevant parties see the deal, while an optional regulator can receive selective disclosure.

## Target users

### Primary user: institutional lender

Wants to extend secured credit without publicly revealing counterparties, terms, pricing, or liquidation state.

### Primary user: institutional borrower

Wants credit while keeping treasury activity, collateral, and borrowing terms confidential.

### Secondary user: regulator/auditor

Needs visibility into the transaction for compliance/audit without making the transaction public.

### Negative user: outsider

Used in the demo to prove Canton privacy: this party should not see the offer or loan.

## Goals

1. Demonstrate private loan offer visibility.
2. Demonstrate borrower acceptance into an active loan.
3. Demonstrate collateral lock during active loan.
4. Demonstrate repayment and collateral release.
5. Demonstrate regulator observer visibility.
6. Demonstrate outsider non-visibility.
7. Optionally demonstrate private liquidation after oracle price drop.

## Non-goals

1. No real money movement.
2. No production Token Standard integration.
3. No external wallet signing.
4. No PQS-backed analytics dashboard.
5. No production oracle network.
6. No partial liquidation.
7. No reserve/bad-debt waterfall.
8. No mainnet readiness claim.

## User stories

### US1: Create private offer

As a lender, I can create a loan offer for a specific borrower so only the lender, borrower, and regulator can see the terms.

Acceptance criteria:

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

- Outsider query returns no offers or loans.
- UI explicitly labels this as Canton privacy.

### US6: Optional liquidation branch

As a lender, I can liquidate when an oracle price drop makes collateral insufficient.

Acceptance criteria:

- Oracle publishes price.
- Liquidation only succeeds below threshold.
- Outsider cannot see liquidation-relevant loan state.

## Proposed modules

### Deep module 1: Daml lending lifecycle

A compact Daml module containing templates and choices:

- `LoanOffer`
- `Loan`
- `PriceFeed`
- minimal local holding/lock representation

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

## Demo script

1. Open app as lender.
2. Create offer: 100 USDC principal, 5 USDC interest, 150 RWA collateral.
3. Switch to borrower: offer is visible.
4. Switch to outsider: offer is not visible.
5. Switch to borrower: accept offer.
6. Switch to lender/borrower/regulator: active loan is visible.
7. Switch to outsider: active loan is not visible.
8. Repay loan: loan closes and collateral releases.
9. Optional: reset, accept, price drops, lender liquidates.

## Technical acceptance criteria

- Daml package builds.
- Daml Script tests pass.
- Tests include positive lifecycle and privacy checks.
- Frontend can run locally.
- README includes one-command or short-command demo instructions.
- Demo can be completed in under 3 minutes.

## Success metrics for hackathon

- A judge can understand the product in 30 seconds.
- The demo clearly shows outsider non-visibility.
- The codebase is small enough to inspect.
- The README is honest about demo vs production.
- The final video has no dependency on live external infrastructure.

## Open questions

1. Should the hackathon name be `Veil Lite`, `No Witness Lending`, or something else?
2. Should the MVP use pure local Daml holdings, or keep a thin compatibility path toward the current `lending/protocol` assets?
3. Should liquidation be in the mandatory demo, or kept as bonus if time allows?
4. Should the first implementation be Daml-only before adding backend/frontend?

## Recommendation

Start Daml-only, prove privacy and lifecycle with scripts, then wrap the proof in a tiny UI. Do not port the full existing lending protocol.
