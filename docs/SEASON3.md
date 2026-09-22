# Veil — HackCanton Season 3 increment

## Starting point and ownership

Baseline: [`2455470f2521b1ce295252178f11507f8c881321`](https://github.com/no-witness-labs/veil-lite-hackathon/commit/2455470f2521b1ce295252178f11507f8c881321), prior to the September 18 delivery window.
Branch: `feat/season3-margin-calls`. Development began September 22, 2026.

The baseline already contained private offers, demo cash/collateral holdings, acceptance, repayment, lender-supplied liquidation prices, a role UI, and an earlier deployment/video. Those are prior work. PRs #24 (token standard), #32 (validation), and #34 (maturity) also predate this season. This branch adapts #34's ledger-time maturity policy to the new margin workflow; it does not claim that original idea or PR as new work or merge those PRs wholesale.

New scope: a jointly authorized valuation stream with consuming price updates, timed margin calls, exact collateral top-ups, recovery resolution, maturity integration, UI integration, automated PR checks, and regression evidence. Track proposal: **Track 2 — Financial Applications**.

Proposed user: operations staff at a lender financing a known treasury counterparty against tokenized collateral. This is a product hypothesis; no institutional pilot or external user validation is claimed.

## End-to-end demo

Run a **fresh local sandbox** using [RUNBOOK.md](RUNBOOK.md). Version 0.3.0 changes the contract schema; there is no migration of existing 0.1.0 or 0.2.0 loans. The prior public deployment and pitch remain prior-work artifacts until a separate deployment is validated.

Bootstrap registers a valuation stream with lender, borrower, and valuer authority and publishes an initial unit price of 1. The demo operator supplies all three authorities, simulating consent. Independent onboarding/signing is outside this demo. If the price becomes stale, publish a fresh one as Valuer before creating an offer.

1. Lender creates a funded offer: 100 principal, 5 interest, 150 collateral units, 90% LTV threshold, a named valuation agent, and a 60-second margin-call window.
2. Borrower accepts. Canton locks the 150 units and delivers 100 demo cash. The borrower retains a separate 50-unit collateral reserve.
3. Valuer publishes an attested unit price of 0.62. Canton archives the previous price and preserves the agreed stream identity. This role can see price records and counterparties, but not the loan.
4. Lender issues a margin call. LTV is approximately 107.53%; the loan records the deadline.
5. Before that deadline, borrower tops up exactly 50 units. Canton consumes that holding, replaces the loan with 200 locked units, and clears the call. LTV is approximately 80.65%.
6. Borrower repays exactly 105. All 200 locked units return to the borrower. The regulator can inspect the resulting settlement; the outsider's active contract query stays empty.

Alternative branch: leave a call unresolved, reach its deadline, then liquidate with a fresh breached valuation. Healthy, expired, future-dated, wrong-source, or wrong-asset marks must fail the relevant action. A fresh recovered price can resolve the call without a deposit.

Maturity branch: a loan past its agreed repayment timestamp can be liquidated through `LiquidateOverdue`, even with healthy collateral or without a usable price. Repayment remains possible until either consuming close action commits. The terminal record distinguishes `LiquidatedAtMaturity` from price-triggered `Liquidated`.

## Explicit policies

| Policy | Contract behavior |
| --- | --- |
| Stream authorization | `ValuationStream` is signed by lender, borrower, and valuer. Its `PublishInitial` choice is consuming: it archives the stream and creates the first price carrying the stream contract ID, so a stream can root exactly one price lineage and is not queryable afterwards. Prices retain all three signatories; the valuer's `Publish` choice can replace a price but cannot change stream identity or counterparties. |
| Source of value | Only the agreed valuer controls price publication. Agent must differ from lender, borrower, and regulator. The lender binds the offer to a fresh current price's stream; borrower accepts that binding. |
| Privacy | Price records name both counterparties and are visible to them and the regulator. The agent is not an observer of offers, loans, or settlements. |
| Price freshness | Publication stamps `observedAt` using ledger time. Every use requires `observedAt <= ledger time <= observedAt + 300 seconds`. |
| Price semantics | Positive **unit price**; collateral value is actual locked quantity × unit price. Multiple loans may use the current price from the same agreed stream. |
| Superseded prices | Publishing consumes the predecessor, so it cannot be fetched again. A same-asset price from another stream fails the loan's stream check. No single participant can fabricate a replacement carrying the agreed stream ID because prices require all three signatories. |
| Trust boundary | All three parties acting together can authorize a fabricated price or fork; this is not Byzantine consensus against colluding signatories. The valuer is trusted for economic accuracy and timely updates. |
| Breach | Principal-only LTV >= agreed threshold. Fixed interest is included in repayment, not this LTV formula. |
| Grace period | Agreed in the offer: 60–86,400 seconds; demo uses 60. Ledger time, not a browser timer, controls permissions. |
| Repeated calls | Cannot issue another call while one is open; its deadline cannot be extended by reissuing it. |
| Top-up | Borrower only, before both the call deadline and maturity, positive exact holding of the agreed asset, with a fresh current price proving resulting LTV is strictly below threshold. Partial cures are rejected atomically. |
| Deposit disclosure | `SplitCollateral` is an owner-only transaction. Only the exact deposit is fetched by the shared loan workflow; the remainder stays outside it. |
| Margin liquidation | Lender only, open call, ledger time >= deadline, and fresh current breached valuation. All currently locked units transfer. |
| Maturity | Offers must be created and accepted strictly before maturity. New calls, top-ups, and recovery resolution also require ledger time < maturity; none extends it. After ledger time > maturity, lender may use `LiquidateOverdue` without a price or call. At exact maturity, repayment remains allowed; overdue liquidation begins strictly after. |
| Recovery | Before maturity, borrower may resolve a call using a fresh healthy price, including after its call deadline. Healthy collateral does not excuse overdue repayment. |
| Repayment | Available before or after a call and after maturity until closed; exact principal + interest; releases all currently locked collateral. Competing close actions consume the same loan, so only one succeeds. |
| Reset | Demo-only cooperative archive using both loan signatories and all three price signatories, followed by reseeding demo assets and a new agreed stream. It is not a business cancellation. |

## Verification

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
(cd test && dpm build && dpm test)
npm --prefix frontend ci
npm --prefix frontend run build
```

Version 0.3.0 verification on September 22, 2026:

- Production DAR build and frontend TypeScript/Vite build pass.
- All 22 named Daml regression scripts pass (the runner also executes the shared setup, reporting 23 declarations). Coverage includes consuming publication, superseded-price rejection across margin actions, parallel streams, unauthorized forks, freshness, exact maturity boundaries, cure/repayment, authorization, rollback, and scoped visibility. The SDK reports three `submitMulti` deprecation warnings in test setup.
- Local Chrome walkthrough against Canton: offer → acceptance → replacement 0.62 price → margin call → 50-unit top-up → repayment. The ledger returned all 200 collateral units and paid 105 to the lender; valuer could not query the loan, and outsider queried no contracts. Publication left exactly one active price with the original stream ID and archived its predecessor.
- A short-maturity loan with its price cooperatively archived unlocked the lender's overdue action without a refresh or role switch. Canton closed it as `LiquidatedAtMaturity`, transferred 150 locked units, and preserved the borrower's 50-unit reserve. No margin call or valuation was needed.
- An unaccepted offer expired in the borrower view without a refresh; acceptance disappeared while the offer remained available for lender withdrawal.
- A separate browser run waited for the actual 60-second margin-call deadline, then liquidated with the current breached price. The lender received 150 units, the borrower retained 50, and the outsider's active query remained empty.
- These browser flows completed without JavaScript errors or failing Ledger API responses. Shell/Python bootstrap syntax and `git diff --check` also pass.

The GitHub `CI` workflow builds the frontend and Daml packages and runs the Daml test package without deployment credentials. Review the PR checks for results on the exact submitted commit.

These are local demo checks, not independent audit results or DevNet validation.

## Review handoff for the invited team

Our implementation work covers contracts, client integration, role UI, local demo, and evidence. Proposed independent review responsibilities:

- Verify choice authorization and contract divulgence, including fetched valuations and collateral.
- Review stream authorization and replacement, time boundaries, arithmetic, collateral conservation, and races between publication, cure, repayment, and liquidation.
- Challenge whether the proposed workflow matches a real lender's operating process and suggest a narrower or more useful scope if appropriate.

## Remaining boundaries

- Demo holdings are self-issued, not backed by actual cash or Treasury/MMF assets. No real settlement, custody, or legal repo agreement is established.
- Funding and stream binding are checked through `CashHolding.MakeOffer`. The demo's lender-signed `LoanOffer` can also be created directly, bypassing those checks; acceptance does not prove escrow provenance. This pre-existing constructor limitation must be addressed when integrating issuer-backed assets for a real pilot.
- Valuations are manually attested by a configured party, not an external oracle or proof of market value. One demo operator controls all role credentials.
- The local sandbox has authentication disabled. The existing shared DevNet proxy is a demo operator, not production user authorization. No DevNet ledger deployment is performed by this increment; an automatic frontend preview is not evidence of a working 0.3.0 DevNet integration.
- Maturity and margin deadlines use ledger time, subject to the participant's configured time model. Independent signing, custody, and an external valuation source are still required for a real pilot.
- Single-participant role visibility is distinct from validating privacy between independently operated participants. No security certification or completed external audit is claimed.
