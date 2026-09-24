# Season 3 — invited audit handoff

This handoff bounds review to the Veil 0.5.0 local model: the DAML contracts,
the client’s role/issuer selection, and the fresh Canton sandbox walkthrough.
It is a review starting point, not a completed external audit. DevNet/Seaport
integration, hosted deployment, independent signing, real custody/settlement,
and user interviews have not been completed for this increment.

Implementation reference: merged PR #39, commit
`e25da2561ce1c330aaf7bb6ce38e296f9e67dcba`. The local validation recorded on
September 22, 2026 ran on its source commit `404ab01`; see
[the evidence and scope record](SEASON3.md).

## Model under review

- `DemoIssuer` is a trusted signatory for simulated cash, simulated collateral,
  funded offers, loans, and settlement records. The holdings are not backed by
  external cash, Treasury/MMF units, or a legal repo. The issuer can authorize
  privileged minting and direct trusted construction by design; this is the
  principal issuance trust boundary, not proof of external funding or a defense
  against issuer collusion.
- `CashHolding.MakeOffer` consumes the lender’s cash and creates the
  issuer-signed `LoanOffer`. `Accept` or `Withdraw` consumes that offer and
  releases the reserved principal exactly once. Normal lifecycle choices inherit
  issuer authority from consumed contracts; ordinary browser submissions do not
  add issuer `actAs`.
- `ValuationStream` is jointly authorized by lender, borrower, and valuer.
  `PublishInitial` and each `Publish` preserve one stream lineage by consuming
  the predecessor. A used mark must be positive, current within 300 seconds,
  scoped to the deal’s parties/asset/stream, and cannot be future-dated.
- Origination requires principal-only LTV strictly below the agreed threshold at
  both `MakeOffer` and `Accept`. A 100 principal against 150 units at 0.62 is
  about 107.5% and must reject atomically. A margin breach is at or above the
  threshold; the borrower has a 60-second (demo) window to provide an exact
  50-unit issuer-matching top-up that restores LTV strictly below the threshold.
- Repayment consumes exactly 105 (100 principal plus 5 interest), returns all
  currently locked collateral, and creates a `LoanClosed` record. Liquidation is
  a separate consuming path requiring an expired call and a fresh breached mark;
  overdue maturity liquidation is distinct and does not use a price.

## Invariants to challenge

1. **Issuance and inherited authorization.** Counterparties alone cannot create
   trusted holdings, an offer, a loan, or a settlement naming the configured
   issuer. Every normal output preserves the consumed issuer and the expected
   signatories.
2. **Funding conservation.** Creating an offer moves the exact principal into
   offer escrow and retains exact change. Acceptance or withdrawal releases that
   principal once; failed acceptance leaves the offer available for withdrawal;
   no reused offer or cash holding can release it twice.
3. **Asset and owner identity.** Accept, top-up, and repayment reject a wrong
   issuer, owner, asset, quantity, or amount. Private `SplitCollateral` and cash
   splitting disclose only the exact input consumed by the shared workflow.
4. **Valuation lineage and freshness.** No wrong stream, counterparties, asset,
   source, future timestamp, stale mark, or archived mark can satisfy origination,
   margin, cure, or price-triggered liquidation. The valuer alone cannot fabricate
   a replacement because the mark retains all three valuation-stream signatories.
   All three signatories acting together can directly construct a duplicate mark
   carrying the same stream ID; ledger uniqueness is not enforced against that
   collusion. The operational UI rejects ambiguous active marks. Review these
   authority and client boundaries separately.
5. **Margin and close races.** A second call cannot extend a deadline. Top-up and
   recovery are before maturity; liquidation waits for the call deadline and a
   breached current mark; repayment and liquidation consume the same loan so
   only one close wins. Exact maturity boundaries and the overdue path must stay
   distinct.
6. **Visibility.** Lender and borrower see their shared offer/loan and the
   signed valuation; the regulator observes deal/settlement records and cannot
   act; the valuer sees valuation records but not the private loan; an outsider
   receives no active contracts. The issuer sees the holdings and associated
   loan lifecycle as a deliberate trust/visibility consequence.

## Role and client boundaries

The configured issuer is an operational selector: the client filters normal
deal/holding views to the configured issuer while `Raw ledger view` preserves
the party-scoped response, including other issuers. That filtering is not a
global security boundary and does not turn the local configuration into an
authorization system. The current sandbox adds [signed role tokens and Canton
user rights](AUTH.md), while the local signing key and demo operator remain
trusted. The recorded operator-tab walkthrough predates this change and is not
evidence of authenticated user isolation or privacy between independently
operated participants.

`Reset demo` is also operator functionality. It cooperatively archives offers,
loans, settlements, prices, and streams with the required issuer, lender,
borrower, and valuer authorities, burns the known holdings, and reseeds the
canonical stream and inventory. It is not a business cancellation or a
permission bypass for production use.

## Local evidence and commands

Run the focused local checks from the repository root:

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
(cd test && dpm build && dpm test)
npm --prefix frontend ci
npm --prefix frontend run build
git diff --check
```

The current local report is 34 named DAML scripts plus the shared `setup`
declaration. The runner emits a known non-fatal six-element fixture tuple
warning; it does not replace a failed assertion. The browser walkthrough is
against the fresh local sandbox started by `./scripts/start-sandbox.sh`, not
DevNet. Review the exact current output when reproducing rather than treating a
historical pass as a new external review.

The most relevant, line-agnostic regression references are named scripts in
[`test/daml/Veil/Test.daml`](../test/daml/Veil/Test.daml):

- **Direct-create and funding proof:** `testDirectOfferAcceptanceGuard`,
  `testIssuerAuthorizationBoundaries`,
  `testFundingConservationExactAndOversized`, `testEscrowOneShotChoices`, and
  `testFailedAcceptLeavesReserveForWithdraw`.
- **Issuer/asset mismatch and lifecycle:**
  `testCounterfeitIssuerRejectedAtAcceptTopUpAndRepay`,
  `testMarginCallTopUpAndRepay`, `testMarginCallDeadlineAndLiquidation`,
  `testResolveMarginCallAfterDeadline`, `testRepayDuringOpenAndExpiredCall`,
  `testOverdueLiquidation`, and `testOverdueLiquidationWithOpenCall`.
- **Valuation and origination guards:** `testValuationFreshnessAndGuards`,
  `testOriginationLtvGuards`, `testOriginationValuationGuards`,
  `testAcceptancePriceDropAndRecovery`,
  `testAcceptanceValuationGuards`, and `testAcceptanceFreshnessBoundary`.
- **Visibility and consuming choices:** `testAuthorizationAndReadVisibility`,
  `testIssuerVisibilityAndValuerOutsiderBoundaries`,
  `testStreamReplacementAndPrivacy`, `testArchivedMarkRejected`, and
  `testDuplicateCallAndReusedContracts`.

The contract and client context is in [`daml/Veil.daml`](../daml/Veil.daml),
[`docs/SEASON3.md`](SEASON3.md), [`docs/RUNBOOK.md`](RUNBOOK.md), and
[`docs/adr/0002-controlled-issuer-and-funded-offers.md`](adr/0002-controlled-issuer-and-funded-offers.md).

## Questions for the invited team

Please challenge the trust boundary, the funding proof, the stream and margin
math, and the role visibility claims. Also propose a better real-world use case,
a narrower workflow, or new ideas if the lender/treasury scenario is not the
most useful application. No claim of completed external review should be made
until that work has actually happened.
