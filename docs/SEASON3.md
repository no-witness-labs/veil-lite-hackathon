# Veil — HackCanton Season 3 increment

## Starting point and ownership

Baseline: [`2455470f2521b1ce295252178f11507f8c881321`](https://github.com/no-witness-labs/veil-lite-hackathon/commit/2455470f2521b1ce295252178f11507f8c881321), prior to the September 18 delivery window.
Branch: `feat/season3-margin-calls`. Development began September 22, 2026.

The baseline already contained private offers, demo cash/collateral holdings, acceptance, repayment, lender-supplied liquidation prices, a role UI, and an earlier deployment/video. Those are prior work. Open PRs #24 (token standard), #32 (validation), and #34 (maturity) also predate this season and are not merged by this change.

New scope: a named valuation party, authenticated price records, timed margin calls, exact collateral top-ups, recovery resolution, UI integration, and regression evidence. Track proposal: **Track 2 — Financial Applications**.

Proposed user: operations staff at a lender financing a known treasury counterparty against tokenized collateral. This is a product hypothesis; no institutional pilot or external user validation is claimed.

## End-to-end demo

Run a **fresh local sandbox** using [RUNBOOK.md](RUNBOOK.md). Version 0.2.0 changes the contract schema; there is no migration of existing 0.1.0 loans. The prior public deployment and pitch remain prior-work artifacts until a separate deployment is validated.

1. Lender creates a funded offer: 100 principal, 5 interest, 150 collateral units, 90% LTV threshold, a named valuation agent, and a 60-second margin-call window.
2. Borrower accepts. Canton locks the 150 units and delivers 100 demo cash. The borrower retains a separate 50-unit collateral reserve.
3. Valuer publishes an attested unit price of 0.62. This role can see its price records, but not the loan.
4. Lender issues a margin call. LTV is approximately 107.53%; the loan records the deadline.
5. Before that deadline, borrower tops up exactly 50 units. Canton consumes that holding, replaces the loan with 200 locked units, and clears the call. LTV is approximately 80.65%.
6. Borrower repays exactly 105. All 200 locked units return to the borrower. The regulator can inspect the resulting settlement; the outsider's active contract query stays empty.

Alternative branch: leave a call unresolved, reach its deadline, then liquidate with a fresh breached valuation. Healthy, expired, future-dated, wrong-source, or wrong-asset marks must fail the relevant action. A fresh recovered price can resolve the call without a deposit.

## Explicit policies

| Policy | Contract behavior |
| --- | --- |
| Source of value | `CollateralValuation` is signed by the valuation agent specified in the offer. Agent must differ from lender, borrower, and regulator. |
| Privacy | Price records name both counterparties and are visible to them and the regulator. The agent is not an observer of offers, loans, or settlements. |
| Price freshness | `observedAt <= ledger time <= observedAt + 300 seconds`; future and older prices are rejected. |
| Price semantics | Positive **unit price**; collateral value is actual locked quantity × unit price. A price can be reused for the same asset and counterparties within its validity window. |
| Conflicting marks | There is no global latest-price guarantee. Any matching unarchived mark within the five-minute window is eligible. The valuer is trusted for accuracy and publication policy. |
| Breach | Principal-only LTV >= agreed threshold. Fixed interest is included in repayment, not this LTV formula. |
| Grace period | Agreed in the offer: 60–86,400 seconds; demo uses 60. Ledger time, not a browser timer, controls permissions. |
| Repeated calls | Cannot issue another call while one is open; its deadline cannot be extended by reissuing it. |
| Top-up | Borrower only, before the deadline, positive exact holding of the agreed asset, with a fresh mark proving resulting LTV is strictly below threshold. Partial cures are rejected atomically. |
| Deposit disclosure | `SplitCollateral` is an owner-only transaction. Only the exact deposit is fetched by the shared loan workflow; the remainder stays outside it. |
| Liquidation | Lender only, open call, ledger time >= deadline, and fresh breached valuation. No direct lender-price bypass. All currently locked units transfer. |
| Recovery | Borrower may resolve a call using a fresh healthy price, including after its deadline: liquidation also fails on that healthy price. |
| Repayment | Available during or after a call; exact principal + interest; releases all currently locked collateral. |
| Reset | Demo-only cooperative archive using both loan signatories, followed by clearing demo holdings and prices. It does not exercise a fake liquidation or model a business cancellation. |

## Verification

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
(cd test && dpm build && dpm test)
npm --prefix frontend ci
npm --prefix frontend run build
```

Verified on September 22, 2026:

- Production DAR build and frontend TypeScript/Vite build pass.
- All 15 named Daml regression scripts pass (the runner also executes the shared setup, reporting 16 declarations). Coverage includes cure/repayment, overdue liquidation, timing, unauthorized actions, bad attestations, collateral mismatch, rollback, consumed-contract reuse, and scoped visibility.
- Local Chrome walkthrough against Canton: offer → acceptance → attested 0.62 price → margin call → 50-unit top-up → repayment. The ledger returned all 200 collateral units and paid 105 to the lender; valuer could not query the loan, and outsider queried no contracts.
- A second browser walkthrough waited for the actual 60-second deadline. The UI enabled liquidation without a role switch; Canton transferred 150 locked units to the lender and preserved the borrower's 50-unit reserve.
- Both browser flows completed without JavaScript errors or failing Ledger API responses.

These are local demo checks, not independent audit results or DevNet validation.

## Review handoff for the invited team

Our implementation work covers contracts, client integration, role UI, local demo, and evidence. Proposed independent review responsibilities:

- Verify choice authorization and contract divulgence, including fetched valuations and collateral.
- Review time boundaries, stale/conflicting-price policy, arithmetic, collateral conservation, and races between cure, repayment, and liquidation.
- Challenge whether the proposed workflow matches a real lender's operating process and suggest a narrower or more useful scope if appropriate.

## Remaining boundaries

- Demo holdings are self-issued, not backed by actual cash or Treasury/MMF assets. No real settlement, custody, or legal repo agreement is established.
- Valuations are manually attested by a configured party, not an external oracle or proof of market value. One demo operator controls all role credentials.
- The local sandbox has authentication disabled. The existing shared DevNet proxy is a demo operator, not production user authorization. No new remote deployment is performed by this increment.
- Maturity remains the baseline descriptive text field; overdue maturity enforcement in PR #34 is a separate integration decision. The new margin-call deadline is enforced on-ledger.
- Single-participant role visibility is distinct from validating privacy between independently operated participants. No security certification or completed external audit is claimed.
