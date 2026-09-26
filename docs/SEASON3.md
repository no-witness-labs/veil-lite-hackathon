# Veil — HackCanton Season 3 increment

## Starting point and ownership

Baseline: [`2455470f2521b1ce295252178f11507f8c881321`](https://github.com/no-witness-labs/veil-lite-hackathon/commit/2455470f2521b1ce295252178f11507f8c881321), prior to the September 18 delivery window.
Development began September 22, 2026. The margin-call increment merged in PR #36, origination guards in PR #38, and controlled issuance/funded offers in [PR #39](https://github.com/no-witness-labs/veil-lite-hackathon/pull/39), merged by `hadelive` at `e25da2561ce1c330aaf7bb6ce38e296f9e67dcba`.

The baseline already contained private offers, demo cash/collateral holdings, acceptance, repayment, lender-supplied liquidation prices, a role UI, and an earlier deployment/video. Those are prior work. PRs #24 (token standard), #32 (validation), and #34 (maturity) also predate this season. This branch adapts #34's ledger-time maturity policy to the new margin workflow; it does not claim that original idea or PR as new work or merge those PRs wholesale.

New scope: a jointly authorized valuation stream with consuming price updates, controlled demo issuance and funded offers, origination risk checks, timed margin calls, exact collateral top-ups, recovery resolution, collateral substitution, partial repayment, real Canton Coin collateral via CIP-112 committed allocations, maturity integration, UI integration, automated PR checks, and regression evidence. Track proposal: **Track 2 — Financial Applications**.

Proposed user: operations staff at a lender financing a known treasury counterparty against tokenized collateral. This is a product hypothesis; no institutional pilot or external user validation is claimed.

## Team presentation and review pack

The current source adds [authenticated role access](AUTH.md) after the recorded
0.5 walkthrough. Each ordinary role signs in separately; the operator retains
privileged reset and view switching. Existing recordings and slides describe the
earlier operator-tab interface and are not authentication evidence.

- [Current recordings](SEASON3-RECORDINGS.md): the three-minute local walkthrough, a one-minute unsafe-acceptance check, English subtitles, and captured ledger evidence.
- [Team presentation (PDF)](SEASON3-PRESENTATION.pdf), [browser slides](SEASON3-PRESENTATION.html), and [editable source](SEASON3-PRESENTATION.md): why Veil, proposed Track 2 fit, prior work versus this increment, current evidence, and the invited team's role.
- [Three-minute demo script](SEASON3-DEMO-SCRIPT.md): fresh-sandbox preflight, exact role/click sequence, timing, and recovery branches.
- [Audit handoff](SEASON3-AUDIT-HANDOFF.md): trust boundaries, invariants to challenge, named regression scripts, and reproduction commands.

The deck uses the repository's existing Marp format. To regenerate its HTML and
PDF from the Markdown source (Chrome and Marp CLI required):

```bash
npx --yes @marp-team/marp-cli@4.5.1 docs/SEASON3-PRESENTATION.md --html -o docs/SEASON3-PRESENTATION.html
npx --yes @marp-team/marp-cli@4.5.1 docs/SEASON3-PRESENTATION.md --html --pdf --allow-local-files -o docs/SEASON3-PRESENTATION.pdf
```

When sharing the generated HTML separately, include its `assets/season3-funded-offer.png`
file alongside it. The PDF contains the screenshot and can be shared alone.

## End-to-end demo

Run a **fresh local sandbox** using [RUNBOOK.md](RUNBOOK.md). Version 0.5.0 adds a demo issuer to holdings and deal records and needs the matching client and config; existing demos are not migrated. Seaport/DevNet and hosted deployment are deferred and do not block implementation. The prior public deployment and pitch remain prior-work artifacts until a separate deployment is validated.

Bootstrap co-authorizes simulated cash and collateral using the distinct demo issuer and each owner. The funded offer itself is escrow: `MakeOffer` consumes cash, while `Accept` or `Withdraw` consumes the offer and releases its principal once. Ordinary actions submit only the user role's authority; issuer authority is inherited from the contract. The issuer is trusted to authorize supply and sees the associated inventory and loan records. See [ADR 0002](adr/0002-controlled-issuer-and-funded-offers.md).

Bootstrap registers a valuation stream with lender, borrower, and valuer authority and publishes an initial unit price of 1. The demo operator supplies all three authorities, simulating consent. Independent onboarding/signing is outside this demo. If the price becomes stale, publish a fresh one as Valuer before creating an offer.

1. Lender creates a funded offer: 100 principal, 5 interest, 150 collateral units, 90% LTV threshold, a named valuation agent, and a 60-second margin-call window. The current price of 1 proves initial LTV is approximately 66.67%, below the threshold.
2. Borrower accepts using a fresh current price from the offer's agreed stream. Canton rechecks that LTV remains below 90%, then locks the 150 units and delivers 100 demo cash. The borrower retains a separate 50-unit collateral reserve.
3. Valuer publishes an attested unit price of 0.62. Canton archives the previous price and preserves the agreed stream identity. This role can see price records and counterparties, but not the loan.
4. Lender issues a margin call. LTV is approximately 107.53%; the loan records the deadline.
5. Before that deadline, borrower tops up exactly 50 units. Canton consumes that holding, replaces the loan with 200 locked units, and clears the call. LTV is approximately 80.65%.
6. Borrower repays exactly 105. All 200 locked units return to the borrower. The regulator can inspect the resulting settlement; the outsider's active contract query stays empty.

Alternative branch: leave a call unresolved, reach its deadline, then liquidate with a fresh breached valuation. Healthy, expired, future-dated, wrong-source, or wrong-asset marks must fail the relevant action. A fresh recovered price can resolve the call without a deposit.

Origination branch: publish 0.62 after an offer is created but before acceptance. The borrower cannot accept because LTV is approximately 107.53%; the offer and collateral remain unconsumed and no principal is delivered. A fresh price of 1 on the same stream restores eligibility. A stale or replaced price cannot be used to bypass this check. The lender's create-offer form also uses the current price in its LTV preview.

Maturity branch: a loan past its agreed repayment timestamp can be liquidated through `LiquidateOverdue`, even with healthy collateral. Since 0.9.0 the default close-out nets at a fresh attested price, so any collateral above the outstanding balance returns to the borrower. Repayment remains possible until either consuming close action commits. The terminal record distinguishes `LiquidatedAtMaturity` from price-triggered `Liquidated`.

## Explicit policies

| Policy | Contract behavior |
| --- | --- |
| Issuance | Cash, collateral, offers, loans, and settlements require the demo issuer's signature. Counterparties cannot create trusted records without its authority. The issuer can authorize privileged issuance, including direct offer creation; there is no claim of external backing or protection against issuer collusion. |
| Escrow | The funded offer holds reserved principal. Creation consumes the funding cash, with exact change; acceptance and withdrawal consume the same offer. Neither reused cash nor a spent offer can release more principal. |
| Asset identity | Acceptance and top-up collateral and repayment cash must match the position's issuer. Every output retains that issuer. The UI pins its configured issuer for holdings and deal selection; raw ledger inspection is preserved. |
| Stream authorization | `ValuationStream` is signed by lender, borrower, and valuer. Its `PublishInitial` choice is consuming: it archives the stream and creates the first price carrying the stream contract ID, so a stream can root exactly one price lineage and is not queryable afterwards. Prices retain all three signatories; the valuer's `Publish` choice can replace a price but cannot change stream identity or counterparties. |
| Source of value | Only the agreed valuer controls price publication. Agent must differ from lender, borrower, and regulator. The lender binds the offer to a fresh current price's stream; borrower accepts that binding. |
| Privacy | Price records name both counterparties and are visible to them and the regulator. The agent is not an observer of offers, loans, or settlements. The demo issuer sees its holdings and all associated deal records. |
| Price freshness | Publication stamps `observedAt` using ledger time. Every use requires `observedAt <= ledger time <= observedAt + 300 seconds`. |
| Price semantics | Positive **unit price**; collateral value is actual locked quantity × unit price. Multiple loans may use the current price from the same agreed stream. |
| Origination | `MakeOffer` and `Accept` each require a fresh scoped price and principal-only LTV strictly below the agreed liquidation threshold. Acceptance rechecks the offer's exact stream rather than relying on its creation-time price. At the threshold, origination is rejected. |
| Superseded prices | Publishing consumes the predecessor, so it cannot be fetched again. A same-asset price from another stream fails the loan's stream check. No single participant can fabricate a replacement carrying the agreed stream ID because prices require all three signatories. |
| Trust boundary | All three parties acting together can authorize a fabricated price or fork; this is not Byzantine consensus against colluding signatories. The valuer is trusted for economic accuracy and timely updates. |
| Breach | Principal-only LTV >= agreed threshold. Fixed interest is included in repayment, not this LTV formula. |
| Grace period | Agreed in the offer: 60–86,400 seconds; demo uses 60. Ledger time, not a browser timer, controls permissions. |
| Repeated calls | Cannot issue another call while one is open; its deadline cannot be extended by reissuing it. |
| Top-up | Borrower only, before both the call deadline and maturity, positive exact holding of the agreed asset, with a fresh current price proving resulting LTV is strictly below threshold. Partial cures are rejected atomically. |
| Deposit disclosure | `SplitCollateral` is controlled by the owner; its outputs are visible to the owner and issuer. Only the exact deposit is fetched by the shared loan workflow; the remainder stays outside the counterparty's view. |
| Margin liquidation | Lender only, open call, ledger time >= deadline, and fresh current breached valuation. Close-out netting (0.9.0): the lender receives the units covering the outstanding balance (principal + interest − amount repaid) at that mark, rounded up to the 10-decimal grain and capped at the locked quantity; the surplus returns to the borrower in the same transaction. `LoanClosed` records the mark, the units seized and returned, and the close time. |
| Maturity | Offers must be created and accepted strictly before maturity. New calls, top-ups, and recovery resolution also require ledger time < maturity; none extends it. After ledger time > maturity, lender may use `LiquidateOverdue` without a call; it requires a fresh mark on the loan's stream and nets exactly like a margin liquidation (0.9.0). At exact maturity, repayment remains allowed; overdue liquidation begins strictly after. |
| Recovery | Before maturity, borrower may resolve a call using a fresh healthy price, including after its call deadline. Healthy collateral does not excuse overdue repayment. |
| Substitution | Borrower escrows one whole holding of the other eligible asset in a `SubstitutionRequest` (signed by issuer and borrower, observed by lender and regulator; not visible to the valuer). The request names the collateral it releases, so a top-up or earlier swap invalidates it. Lender-only `ApplySubstitution` requires no open margin call, ledger time before maturity, and a fresh mark from the replacement asset's own jointly signed stream showing LTV strictly below the threshold. It then locks the replacement, rebinds the loan to that stream, and returns the released collateral in one transaction. Lender rejection or borrower cancellation returns the escrow exactly once. Eligible assets are Tokenized T-Bill and Tokenized MMF, each with its own stream. There are no haircuts beyond the shared LTV threshold. |
| Partial repayment | Borrower-only `PartialRepay` with an exact issuer-matching cash holding, before maturity, for less than the outstanding balance (a full payment must use `Repay`, the only choice that releases collateral). The lender receives the cash. Payments settle the fixed interest first, then principal. The loan keeps its agreed terms and records the running total in `amountRepaid`, which `LoanClosed` carries too. Every LTV check uses the outstanding principal. With a call open, the payment needs a fresh mark and must bring LTV strictly below the threshold, and then it clears the call. There is no partial collateral release and no interest recalculation. |
| Canton Coin collateral | `CoinLoanOffer.AcceptCoin` (borrower) locks the Canton Coin in the same transaction that checks LTV on a fresh CC mark: the registry's `AllocationFactory` (read via `PublicFetch`, admin must equal the offer's `coinAdmin`) creates a CIP-112 *committed* allocation with the lender as sole executor and a settlement deadline of maturity + 1 day. Amulet refuses the borrower's withdrawal before that deadline. `RepayCoin` cancels the allocation with the lender authority carried by `CoinLoan`; `LiquidateCoin` (expired call, fresh breached mark) and `LiquidateCoinOverdue` (after maturity) settle it to the lender through `SettlementFactory_SettleBatch`, pairing it with a lender receiving allocation from `PrepareCoinReceipt` that must mirror the collateral leg; `WriteOffCoin` lets the lender release it (the demo reset uses it). Margin calls, recovery and pay-down mirror `Loan`; there is no top-up or substitution. Known limitation: the committed allocation settles its one fixed collateral leg, so a Canton Coin liquidation transfers the whole locked quantity with no surplus refund; `LoanClosed` states `collateralReturned = 0`. `CoinLoanOffer` has the same expiry and borrower `RejectCoinOffer` as `LoanOffer`. Principal stays simulated USDC. Verified end to end on hackcanton-01 with real DevNet CC. |
| Repayment | Available before or after a call and after maturity until closed; exact outstanding balance (principal + interest − amount already repaid); releases all currently locked collateral. Competing close actions consume the same loan, so only one succeeds. |
| Offer expiry and rejection | 0.9.0 offers carry an optional `expiresAt` (future, no later than maturity; the UI sets 24 hours or maturity, whichever is sooner). Acceptance fails from the expiry instant. The borrower can `RejectOffer` at any time and the lender can `Withdraw` at any time; both refund the escrowed principal exactly once. Offers created by 0.8.1 have no expiry and still lapse for acceptance at maturity. |
| Term bounds | `MakeOffer` and `MakeCoinOffer` require principal and collateral quantity in (0, 10^12], interest between 0 and the principal, maturity in the future and at most 3,660 days away, and a regulator distinct from both counterparties. The threshold (0–100%] and window (60–86,400 s) bounds and the origination LTV check are unchanged. |
| Settlement record | `LoanClosed.Dismiss` needs both lender and borrower (0.9.0), so neither can erase the shared record alone. The demo reset submits with issuer, lender and borrower. |
| Reset | Demo-only cooperative archive using issuer/lender/borrower for loans and all three price signatories for prices, followed by issuer-authorized reseeding and a new agreed stream. It is not a business cancellation. |

## Verification

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
(cd test && dpm build && dpm test)
npm --prefix frontend ci
npm --prefix frontend run build
```

Version 0.5.0 verification on September 22, 2026:

- Production DAR and frontend TypeScript/Vite builds pass. All 34 named Daml scripts pass, plus shared `setup`. The six new scripts cover issuer authorization and role substitution, exact/oversized funding conservation, one-shot acceptance/refunds, rollback followed by withdrawal, other-issuer deposits/payments, and issuer/valuer/outsider visibility. Existing lifecycle tests now seed assets with issuer and owner authority and check issuer preservation. The runner emits a non-fatal six-element fixture tuple warning.
- Local Chrome rejected missing issuer config and disabled Reset until setup was valid. Direct lender attempts to mint trusted cash and an unfunded offer failed. Deliberately created foreign-issuer assets/offers stayed out of the operational UI and acceptance helper, while remaining in the raw ledger response.
- The browser created a funded offer, showed its reserved principal, withdrew it once, and verified a repeated withdrawal failed. Across funding, refund, acceptance, margin call, top-up, and repayment, the issuer's available cash plus offer reserves stayed at 205; free plus loan-locked collateral stayed at 200. Repayment transferred 105 to the lender and returned all 200 collateral units to the borrower.
- The same run exercised price-drop rejection with unchanged contracts, recovered acceptance, and stale-price UI timers. Captured ordinary browser commands did not include issuer `actAs`; issuance/reset commands explicitly did. The issuer could query the resulting settlement, the valuer could not, and the outsider returned no contracts. No JavaScript errors or unexpected failed browser Ledger API requests occurred; deliberate negative API requests failed as expected.
- Shell/Python bootstrap syntax, issuer-selection checks with synthetic foreign/trusted holdings, hosted issuer config checks, and `git diff --check` pass. The browser layout was visually inspected.

Earlier version 0.4.0 verification on September 22, 2026:

- Production DAR and frontend TypeScript/Vite builds pass. All 28 named Daml scripts pass, plus the shared `setup` declaration. The six new scripts cover strict origination LTV, valuation guards, acceptance price-drop rollback and recovery, replaced/wrong-stream prices, the exact 300/301-second freshness boundary, and acceptance of directly constructed offers at the threshold. The insufficient-funding test uses healthy LTV so it still exercises the cash guard.
- Local Chrome showed collateral value of 120 USDC and LTV of 83.3% at a unit price of 0.80. At 0.62, offer creation was disabled. Advancing only the browser clock by 301 seconds disabled creation and acceptance without switching roles; restoring the clock re-enabled them. Ledger-time freshness is separately covered by the Daml scripts.
- After creating an offer, replacing its price with 0.62 disabled borrower acceptance. A direct Ledger API acceptance attempt also failed with the LTV assertion; all borrower-visible contract IDs stayed unchanged, no loan was created, and no principal was delivered. A fresh price of 1 on the same stream allowed acceptance.
- The same browser run continued through a 0.62 price, margin call, 50-unit top-up, and repayment of 105. All 200 collateral units returned; the lender received 105. The valuer could not query the loan or settlement, and the outsider queried no contracts.
- The browser recorded no JavaScript errors or unexpected failed Ledger API responses. The intentional unsafe-acceptance request returned HTTP 400. Shell/Python bootstrap syntax and `git diff --check` pass.

Earlier version 0.3.0 verification on September 22, 2026:

- Production DAR build and frontend TypeScript/Vite build pass.
- All 22 named Daml regression scripts pass (the runner also executes the shared setup, reporting 23 declarations). Coverage includes consuming publication, superseded-price rejection across margin actions, parallel streams, unauthorized forks, freshness, exact maturity boundaries, cure/repayment, authorization, rollback, and scoped visibility. Test setup uses the current `actAs`/`submit` API.
- Local Chrome walkthrough against Canton: offer → acceptance → replacement 0.62 price → margin call → 50-unit top-up → repayment. The ledger returned all 200 collateral units and paid 105 to the lender; valuer could not query the loan, and outsider queried no contracts. Publication left exactly one active price with the original stream ID and archived its predecessor.
- A short-maturity loan with its price cooperatively archived unlocked the lender's overdue action without a refresh or role switch. Canton closed it as `LiquidatedAtMaturity`, transferred 150 locked units, and preserved the borrower's 50-unit reserve. No margin call or valuation was needed.
- An unaccepted offer expired in the borrower view without a refresh; acceptance disappeared while the offer remained available for lender withdrawal.
- A separate browser run waited for the actual 60-second margin-call deadline, then liquidated with the current breached price. The lender received 150 units, the borrower retained 50, and the outsider's active query remained empty.
- These browser flows completed without JavaScript errors or failing Ledger API responses. Shell/Python bootstrap syntax and `git diff --check` also pass.

The GitHub `CI` workflow builds the frontend and Daml packages and runs the Daml test package without deployment credentials. Review the PR checks for results on the exact submitted commit.

The [first GitHub CI run](https://github.com/no-witness-labs/veil-lite-hackathon/actions/runs/35696187576) on September 22 could not start either job: GitHub reported an account billing lock. Remote CI remains unverified until the account owner resolves that lock and reruns the workflow. This is separate from the passing local checks above.

The project owner authorized proceeding without CI; PRs #36, #38, and #39 merged with an admin bypass. On PR #39, neither CI job started because of the same account billing lock. The 0.5.0 increment uses local builds, contract regression tests, and browser checks against Canton sandbox; neither CI availability nor DevNet access is a prerequisite.

These are local demo checks, not independent audit results or DevNet validation.

## Review handoff for the invited team

Our implementation work covers contracts, client integration, role UI, local demo, and evidence. Proposed independent review responsibilities:

- Verify issuance and inherited choice authorization, reserve conservation, issuer mismatch rejection, and contract divulgence, including fetched valuations and collateral.
- Review stream authorization and replacement, time boundaries, arithmetic, collateral conservation, and races between publication, cure, repayment, and liquidation.
- Challenge whether the proposed workflow matches a real lender's operating process and suggest a narrower or more useful scope if appropriate.

## Remaining boundaries

- Demo holdings require a configured issuer's authority but are not backed by actual cash or Treasury/MMF assets. No real settlement, custody, or legal repo agreement is established.
- Lender-only direct offer creation is blocked by the issuer signature. The trusted issuer can still co-authorize direct holdings/offers/loans, so this is an issuance trust boundary, not cryptographic proof of external funding. Cash-plus-reserve conservation applies to normal choices between issuance and reset; the issuer also sees the loan records.
- Valuations are manually attested by a configured party, not an external oracle or proof of market value. One demo operator controls all role credentials.
- The current sandbox enforces signed role tokens and Canton user rights; the local credential issuer and demo operator remain trusted. The shared DevNet credential proxy has been removed. No DevNet deployment is performed by this increment; an automatic frontend preview is not evidence of a working hosted integration. See [AUTH.md](AUTH.md).
- Maturity and margin deadlines use ledger time, subject to the participant's configured time model. Independent signing, custody, and an external valuation source are still required for a real pilot.
- Single-participant role visibility is distinct from validating privacy between independently operated participants. No security certification or completed external audit is claimed.
