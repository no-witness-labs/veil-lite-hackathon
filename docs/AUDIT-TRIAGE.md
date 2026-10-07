# Audit triage: issues #53–#60

The audit reviewed an earlier `daml/Veil.daml` (its line numbers match the
pre-Season-3 contract, where `Liquidate` took a lender-supplied
`currentCollateralValue`). Each finding is classified here against `main` at
`c7c6681` (package 0.8.1). Fixes ship in package **0.9.0**, a Smart Contract
Upgrade of 0.8.1. Line numbers refer to `daml/Veil.daml` in 0.9.0.

| Issue | Severity | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- |
| [#53](https://github.com/no-witness-labs/veil-lite-hackathon/issues/53) H-01 Lender supplies the liquidation price | High | **Fixed already** (#36 `af524b5`, #38 `443837d`) | `Liquidate` takes only a `valuationCid` (568–581). `checkedPrice` (71–82) requires a `CollateralValuation` from the loan's `ValuationStream`, which lender, borrower and valuer all sign (20–31); it checks the counterparties, asset, stream and freshness (≤ 300 s). A liquidation also needs an open margin call whose deadline has passed and a breach at that mark. Origination checks LTV against a fresh mark too (126, 330). | 0.9.0 also records the liquidation mark, close time and seized/returned units on `LoanClosed`. |
| [#54](https://github.com/no-witness-labs/veil-lite-hackathon/issues/54) H-02 Regulator is a free choice of the lender | High (as filed) | **Partially valid**. Mitigated by design. | Since #36 every mark names the regulator and `checkedPrice` requires `mark.regulator == regulator` (77). The regulator is therefore fixed by the borrower-signed `ValuationStream` before any offer exists, and the borrower accepts the offer that names it. Nothing stopped the regulator from being the lender or the borrower. | 0.9.0: `MakeOffer`/`MakeCoinOffer` require `regulator /= lender && regulator /= borrower` (1085). **Won't fix:** a regulator-signed designation. Oversight in this demo is borrower-consented observer visibility, not a mandated regulator, and the regulator's consent would add a signatory to every stream. |
| [#55](https://github.com/no-witness-labs/veil-lite-hackathon/issues/55) M-01 Holdings have no issuer | Medium | **Fixed already** (#39 `e25da25`; #51 `01d24d0` for Canton Coin) | `CashHolding` and `CollateralHolding` are `signatory issuer, owner` (100, 218). `LoanOffer` is `signatory issuer, lender` and can only be created by consuming funded cash in `MakeOffer`, which acts as escrow. `Accept`, `TopUpCollateral`, `PartialRepay` and `Repay` check the issuer. Canton Coin collateral is real Amulet held in a CIP-112 committed allocation. The tests `testIssuerAuthorizationBoundaries`, `testCounterfeitIssuerRejectedAtAcceptTopUpAndRepay` and `testDirectOfferAcceptanceGuard` cover this. | None. The issuer stays trusted by design ([ADR 0002](adr/0002-controlled-issuer-and-funded-offers.md)). |
| [#56](https://github.com/no-witness-labs/veil-lite-hackathon/issues/56) M-02 Liquidation seizes all collateral | Medium | **Valid** for T-Bill `Loan` (both `Liquidate` and `LiquidateOverdue`) and for `CoinLoan` | 0.8.1 created a lender holding for the full `collateralQuantity` on both liquidation paths. | **Fixed for `Loan`** in 0.9.0 by `closeOut` (644), which does close-out netting. The lender gets `seizedQuantity locked owed price` (1055): the balance owed (principal + interest − amount repaid) divided by the mark, rounded up to the 10-decimal grain and capped at the locked quantity. The remainder goes back to the borrower in the same transaction. **`LiquidateOverdue`** takes a new trailing `valuationCid : Optional (ContractId CollateralValuation)` and **requires** a fresh mark on the loan's stream (587–598). Without a price, the surplus cannot be computed, and GMRA default close-out also values the collateral. Residual risk: if the valuer stops publishing, the lender cannot close an overdue loan until a mark exists. The borrower can still repay. **`CoinLoan`: known limitation, not fixed.** The committed allocation has one fixed collateral leg and `nextIterationFunding = None`. CIP-112 then settles exactly that leg, so a partial transfer is impossible. Iterated settlement would allow it, but registries only MAY support it and we have not verified Amulet on DevNet. A cash "refund" from the lender would not be equivalent and would need lender liquidity. The coin close record now states `collateralSeized = locked`, `collateralReturned = 0` and the mark (1027). |
| [#57](https://github.com/no-witness-labs/veil-lite-hackathon/issues/57) L-01 Loan terms are not bounded | Low | **Partially valid** | Fixed already: threshold ≤ 100 and window 60–86,400 s in every offer/loan `ensure` (313, 398, 776, 846). Origination LTV must be below the threshold at `MakeOffer` and at `Accept` (#38; 126, 330), so a loan cannot be liquidated immediately. Still valid: no upper bound on principal, interest or quantity (overflow of `principal + interest`), and no tenor bound. | 0.9.0 `validateOfferTerms` (1075), used by both offer choices: principal and quantity ≤ 10^12, 0 ≤ interest ≤ principal, maturity in the future and ≤ 3,660 days away. The bounds sit in the choices, not in `ensure`, so live 0.8.1 contracts keep upgrading cleanly. |
| [#58](https://github.com/no-witness-labs/veil-lite-hackathon/issues/58) L-02 Lender can archive `LoanClosed` alone | Low | **Valid** | 0.8.1 `Dismiss` was `controller lender`. | 0.9.0 `Dismiss` is `controller lender, borrower` (638–639). The demo reset already submits it with `actAs [issuer, lender, borrower]` (`frontend/src/ledger.ts` `resetDemo`). `LoanClosed` gains trailing optional `closedAt`, `liquidationUnitPrice`, `collateralSeized` and `collateralReturned`, as the auditor recommended. |
| [#59](https://github.com/no-witness-labs/veil-lite-hackathon/issues/59) L-03 Borrowers cannot reject offers; offers never expire | Low | **Partially valid** | Acceptance already lapses at maturity (`Accept` requires `now < maturity`), but the offer stays active and only the lender could archive it. The M-01 part was fixed by #39. This also applies to `CoinLoanOffer`. | 0.9.0: borrower `RejectOffer` (366) and `RejectCoinOffer` (816) refund the escrowed principal to the lender. An optional `expiresAt` is appended to both offer templates and both `Make*Offer` choices; it must be in the future and ≤ maturity. `assertOfferLive` (1090) refuses acceptance from the expiry instant. Withdraw and reject still work after expiry. The UI sets expiry to 24 h or maturity, whichever is sooner. |
| [#60](https://github.com/no-witness-labs/veil-lite-hackathon/issues/60) L-04 `Repay` requires the exact amount | Low | **Fixed already** (`9362877`), frontend residual valid | The unreachable change branch was removed when repay divulgence was closed. `Repay`/`RepayCoin` require the exact outstanding balance (539, 922), and the choice comment says to split first. The UI splits an exact holding before repaying (`findCash`). Residual: the UI computed the amount with JS `Number` arithmetic. | 0.9.0 frontend rounds repayment and pay-down amounts to Daml's 10 decimals before splitting (`toDecimal` in `frontend/src/ledger.ts`). **Won't add** `Merge`/overpayment: exact payment keeps the borrower's other cash private. |

## Upgrade compatibility (0.8.1 → 0.9.0)

- No template, choice or field was removed or renamed, and no choice return type changed.
- New template fields are `Optional` and appended last: `LoanOffer.expiresAt`,
  `CoinLoanOffer.expiresAt`, and the four `LoanClosed` fields.
- New choice arguments are `Optional` and appended last: `MakeOffer.expiresAt`,
  `MakeCoinOffer.expiresAt`, `LiquidateOverdue.valuationCid`. New choices:
  `LoanOffer.RejectOffer`, `CoinLoanOffer.RejectCoinOffer`.
- No `ensure` clause was tightened. The new bounds apply at offer creation only.
- Behaviour changes that clients must follow:
  - `LiquidateOverdue` without a mark now fails.
  - `Dismiss` needs both counterparties.
  - Deploy the 0.9.0 DAR before the frontend: the new UI sends `expiresAt`, which 0.8.1 does not know.
- Verified with `dpm build` and `upgrades:` pointing at the 0.8.1 DAR built from `c7c6681`. The build passes. It reports warnings only: changed controller expressions on `Dismiss`/`LiquidateOverdue` (intended), and a renamed compiler-generated helper in the unchanged `Loan`/`CoinLoan` preconditions.

# Audit triage: Canton Coin collateral (0.10.0)

A second review covered the Canton Coin path of package 0.9.0 (live on DevNet).
Each finding was proven with a Daml Script against 0.9.0; the scripts are ported
to `test/daml/Veil/CoinAudit.daml` as regression tests that now must fail to
exploit. Fixes ship in package **0.10.0**, a Smart Contract Upgrade of 0.9.0.
Line numbers refer to `daml/Veil.daml` in 0.10.0.

| Finding | Severity | Verdict | Evidence (0.9.0) | Fix (0.10.0) | Regression tests |
| --- | --- | --- | --- | --- | --- |
| C-01 Lender seizes Canton Coin outside Veil | High | **Fixed for new loans**; residual on 0.9.0 loans | `coinSettlement` made the lender the lock's only executor, so the lender alone could call the registry's `SettlementFactory_SettleBatch` with `actors = [lender]`: no margin call, healthy price, before maturity. The coin moved to the lender and the `CoinLoan` stayed open, owed and unrepayable. | `AcceptCoin` locks with `executors = [lender, borrower]` (`coinLoanExecutors`, 711) and records them in a new trailing `CoinLoan.settlementExecutors : Optional [Party]` (897). `releaseCoin` (1055) and `settleCoin` (1071) pass `actors = ` the loan's executors (`coinExecutorsOf`, 715); both executors are `CoinLoan` signatories, so the choice bodies hold that authority. `PrepareCoinReceipt` gives the receipt the same executors. Loans opened by 0.9.0 read `None` and keep `[lender]`, so they still repay, liquidate and write off; their lock stays settleable by the lender alone until they close (it cannot be re-locked without the borrower). | `testLenderAloneCannotSettleOrCancelCoinLock`, `testJointExecutorsLiquidateThroughVeil`, `testLegacyCoinLoansStillClose` |
| C-02 Borrower-supplied allocation factory | High | **Fixed** | `allocateCoin` trusted the factory's self-reported `PublicFetch` admin and never looked at the allocation it returned. A borrower template claiming the DSO as admin opened a loan with nothing locked and the principal paid out. Later `RepayCoin`/`WriteOffCoin` exercised `Allocation_Cancel` on that fake with `actors = [lender]`, and the fake used the lender's authority to write off another, genuinely secured loan. | `checkCoinAllocation` (759) fetches the allocation and requires the coin admin among its signatories (only the registry's own templates carry it) and a view equal to the request: settlement id, executors and `cid`, and the full specification (admin, authorizer, the one collateral leg with amount = `collateralQuantity` and the counterparty, settlement deadline, `committed`, no iteration funding). Top-level `meta` fields are not compared. It runs after every `Allocate` (lock and receipt) and on the receipt passed to `settleCoin`. Before `releaseCoin` and `settleCoin` hand the lock the executors' authority, `checkCoinSettlement` (767) re-checks its admin signature and settlement. It does not re-judge the terms of a 0.9.0 lock, so a live loan cannot be stranded by a view detail. A 0.9.0 loan opened through an impostor can therefore no longer leak the lender's authority. Such a loan closes with `CloseLapsedCoinLoan` after its deadline. | `testFakeFactoryCannotOpenUnsecuredCoinLoan`, `testAcceptCoinRejectsMismatchedAllocation`, `testFakeAllocationCannotBorrowLenderAuthority`, `testForgedReceiptRejected` |
| C-03 Zombie `CoinLoan` after the settlement deadline | Low | **Fixed** | A day after maturity the registry refuses to settle and the borrower may withdraw the lock. `LiquidateCoinOverdue`, `WriteOffCoin` and `RepayCoin` then all fail, and the loan has no terminal path. | New lender choice `CloseLapsedCoinLoan` (1044): only when `now > maturity + 1 day` (the instant settlement stops), it creates `LoanClosed` with reason `CollateralLapsed`, `collateralReleased = True`, `collateralSeized = None`, `collateralReturned = Some collateralQuantity` and the loan's `amountRepaid`, so the unpaid balance stays on record. It does not touch the allocation. | `testLapsedCoinLoanCloses`, `testLapsedCloseLeavesAllocation` |
| C-04 LTV divides by quantity × price | Low | **Fixed** | Every LTV check computed `owed / (quantity × price) × 100`. A collateral value that rounds to zero at 10 places (for example 0.1 units at 0.0000000001) aborted margin calls and liquidation with a division by zero. | `ltvBelow` / `ltvAtOrAbove` (95) compare `owed × 100` with `threshold × (quantity × price)` at all 14 call sites. The result equals the old one except where the old division's own rounding moved the LTV across the threshold (within 10⁻⁸ LTV points). There the new answer is the exact one, e.g. 100 owed on 150 units at 1.0 against a 66.6666666667 threshold. The keeper mirrors it (`ltvBreached`). | `testLtvAtNearZeroPrice`, `testLtvComparisonMatchesDivision` |

## Residual risks and design-level items (documented, not changed)

- **R-1 Settlement factory authenticity.** Only the coin admin is a stakeholder
  of the registry's `SettlementFactory`, so Daml cannot `fetch` it (verified: the
  fetch is refused for lack of a stakeholder authorizer), and `PublicFetch`
  returns whatever the factory's code says. `LiquidateCoin*` exercises
  `SettleBatch` on the factory the lender names with `actors = [lender,
  borrower]`. A lender who names a forged factory during a liquidation that is
  otherwise valid hands that code the borrower's authority. With that authority
  it could, for example, settle another lock between the same two parties or
  dismiss a shared `LoanClosed`. Both allocations are verified, so the
  liquidated loan itself is safe. This is narrower than C-01 in 0.9.0, where the
  lender could do this at any time with no conditions. The full fix is to settle
  the two verified allocations directly with `Allocation_Settle` and not call a
  factory at all. That depends on Amulet V2 accepting a direct settle, which has
  not been verified on DevNet.
- **Registry semantics assumed, not verified on DevNet.** The fix assumes that
  Amulet V2 requires the authority of every executor to settle or cancel, and
  that it accepts a lock whose authorizer (the borrower) is also an executor.
  The mocks in `test/daml/Veil/CoinMocks.daml` enforce `actors == executors`.
  Before relying on 0.10.0 Canton Coin loans, open one on DevNet. Then check
  that its allocation view shows both executors, that the lender alone cannot
  `SettleBatch` it, that the borrower alone cannot cancel it, and that repay and
  liquidation still work.
- **0.9.0 loans** keep the lender-only lock until they close (C-01). They cannot
  be migrated without the borrower re-locking.
- **Duplicate `settlementRef`.** The view check binds an allocation to its
  settlement id, executors and terms, not to one loan. If a lender issues two
  offers with identical terms and the same `settlementRef`, the borrower's
  factory could present one registry lock for both. The app uses a unique
  `veil-<timestamp>` per offer.
- Unchanged by design: interest is excluded from the LTV numerator (outstanding
  principal only), the cure rules (top-up, pay-down and price recovery each clear
  a call on a fresh mark), a `SubstitutionRequest` is not tied to a specific loan
  id (it names the collateral it releases), and `AcceptCoin` discloses the
  borrower's input holdings to the lender and regulator in the accepting
  transaction.

## Upgrade compatibility (0.9.0 → 0.10.0)

- No template, choice or field was removed or renamed, no field type changed, and
  no choice return type changed. No `ensure` clause changed.
- New template field: `CoinLoan.settlementExecutors : Optional [Party]`, appended
  last. `CoinLoanOffer` is unchanged: an offer has no allocation yet, so offers
  created by 0.9.0 lock jointly on acceptance as well.
- New choice: `CoinLoan.CloseLapsedCoinLoan`.
- Behaviour changes that clients must follow:
  - Registry requests for a new loan carry `executors = [lender, borrower]`, and
    the settlement batch carries `actors = [lender, borrower]`. A 0.9.0 loan
    (`settlementExecutors` absent or null) keeps `[lender]`. Commands are still
    submitted as the lender, or as the borrower for `AcceptCoin` and `RepayCoin`.
  - A Canton Coin lock or receipt that is not signed by the coin admin, or that
    differs from the requested settlement or terms, is now refused at
    acceptance, repay, write-off and liquidation.
  - After maturity + 1 day, use `CloseLapsedCoinLoan`: the frontend's overdue
    action and reset, `api/desk.js` close and the keeper (`closeLapsed`) do.
  - Order: upload the 0.10.0 DAR before deploying the app, because the new app
    sends `CloseLapsedCoinLoan` and joint-executor registry requests. The
    on-ledger lock and receipt specifications are built by Daml, not by the app.
    The old app sends the same commands, so it keeps working against 0.10.0,
    but its registry choice-context requests name `[lender]` for new loans.
    Whether Amulet's choice context depends on the executors is not verified,
    so deploy the app right after the upload. The keeper must be updated too:
    the old keeper may reuse a lender-only receipt for a new loan, which
    0.10.0 refuses.
- The check is permanent: `daml.yaml` names `vendor/veil-lite/veil-lite-0.9.0.dar`
  (built from `1e6f2c0`, SHA-256 in `vendor/veil-lite/SHA256SUMS`, verified in
  CI) under `upgrades:`, so every `dpm build` fails if the package stops being a
  valid upgrade of the live one. A deliberate breaking change (a changed choice
  return type) was confirmed to fail the build. The build passes with one
  warning on the unchanged `Loan`/`CoinLoan` preconditions: a renamed
  compiler-generated helper, the same as in the 0.8.1 → 0.9.0 check.

## Verified on DevNet after the 0.10.0 upload (Oct 5, 2026)

On hackcanton-01, with real DevNet Canton Coin and package `17fcd804…` (0.10.0) vetted
alongside `fbdd86ab…` (0.9.0):

- A Canton Coin loan opened through the live app recorded
  `settlementExecutors = [lender, borrower]`.
- The lender alone then made its own receiving allocation and called the registry's
  `SettlementFactory_SettleBatch` with `actors = [lender]`, outside Veil. Canton Coin
  refused it: *"'actors' does not have the same elements as one of 'allowed actors'"*.
  The borrower's 1,000 CC stayed locked.
- Repaying that loan through Veil (`RepayCoin`) released all 1,000 CC to the borrower.
- A second loan was margin-called and, after the deadline, liquidated by the keeper
  (`LiquidateCoin` with the joint executors). The 1,000 CC settled to the lender. It was
  then returned to the demo borrower.
- Both guided-demo tracks completed on the live site, with two visitors running at the
  same time.

Side effect: the refused attack left a lender-owned receive-side allocation holding no
funds; it expires with its settlement deadline.

## 0.9.0 removed from the node (Oct 7, 2026)

After a demo reset left no active contracts on `fbdd86ab…`, the node operator removed the
0.9.0 DAR from hackcanton-01; a package listing the same day shows only `17fcd804…`
(0.10.0). No new contract can be created or exercised under 0.9.0, and no lender-only
(`settlementExecutors = None`) Canton Coin loan remains on the node.
