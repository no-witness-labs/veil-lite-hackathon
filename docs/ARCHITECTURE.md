# Veil Architecture — end to end

How Veil goes from Daml source to a running, judge-clickable app, and exactly what each
action does on and off the ledger. For the contract visibility/lifecycle diagrams see the
[Contract model](../README.md#contract-model) in the README; for run commands see the
[Runbook](./RUNBOOK.md).

## The stack (5 layers)

```text
 5. Browser UI         frontend/src/App.tsx + components      what the judge clicks
 4. Off-chain client   frontend/src/ledger.ts (fetch)         speaks JSON to the ledger
       Vite dev proxy   /v2 → 127.0.0.1:6864
 3. JSON Ledger API v2  HTTP :6864   (gRPC Ledger API :6865)  the on/off-chain boundary
 2. Canton sandbox      participant + sequencer + mediator +  runs contracts, enforces
       synchronizer (dpm sandbox, in-memory, auth off)        privacy + authorization
 1. Contracts           daml/Veil.daml → veil-0.1.0.dar       the rules (on-ledger)
```

## 1. Contracts (on-ledger)

Five Daml templates in `daml/Veil.daml`:

| Template | Signatory / Observer | Purpose | Choices |
| --- | --- | --- | --- |
| `CashHolding` | owner | principal asset (USDC-like), bearer | `MakeOffer` |
| `CollateralHolding` | owner | tokenized T-Bill/MMF collateral, bearer | — |
| `LoanOffer` | sig lender · obs borrower, regulator | pre-funded private offer | `Accept`, `Withdraw` |
| `Loan` | sig lender, borrower · obs regulator | active bilateral position | `Repay`, `Liquidate` |
| `LoanClosed` | sig lender, borrower · obs regulator | terminal settlement record | `Dismiss` |

Two properties are enforced by Canton, not the app:
- **Privacy** — a party sees a contract only if it is a signatory or observer. Holdings are
  owner-only with no observers (private wallets); the outsider is on nothing, so its query is `[]`.
- **Authorization** — a choice body runs with the authority of its controller **plus the
  contract's signatories**, which is how cross-party atomic moves are authorized (see Accept).

## 2. Build & package

```bash
dpm build                       # daml/Veil.daml → .daml/dist/veil-0.1.0.dar
(cd test && dpm build && dpm test)
```

A **DAR** bundles the compiled templates (Daml-LF target `2.1`). Its package id
(`94cc3562…`) identifies this exact code; the app references templates by package *name*
(`#veil:Veil:LoanOffer`) so references survive recompiles. (`dpm codegen-js` could generate
TypeScript bindings; we hand-rolled a small client instead — see layer 4.)

## 3. Run & deploy

`scripts/start-sandbox.sh` (pinned to OpenJDK 17) starts `dpm sandbox`, waits for readiness,
then runs `scripts/bootstrap.sh`, which:

1. **Uploads the DAR** — `POST /v2/packages` (octet-stream) → templates exist on the participant.
2. **Allocates parties** — `POST /v2/parties {partyIdHint}` for Lender/Borrower/Regulator/Outsider
   → on-ledger identities like `Lender::<fingerprint>`.
3. **Seeds holdings** — lender `CashHolding(100)`, borrower `CashHolding(105)` + `CollateralHolding(150)`.
4. **Writes config** — `frontend/public/ledger-config.json` (the party ids the UI fetches at runtime).

The sandbox is in-memory: restarting it is a clean ledger.

## 4. Off-chain interaction model (JSON Ledger API v2)

Everything off-chain talks to the ledger over HTTP on `:6864`. Auth is disabled in dev, so the
acting party is named in each request (in production this would be a JWT). The client is
`frontend/src/ledger.ts`, a thin `fetch` wrapper (the npm `@daml/ledger` targets the old v1 API).

- **Reads** — `GET /v2/state/ledger-end` (offset) then `POST /v2/state/active-contracts` filtered
  to a party. You always query **as a party**, so the result is exactly that party's visible set —
  this is the privacy proof end to end.
- **Writes** — `POST /v2/commands/submit-and-wait-for-transaction` with a `CreateCommand` or
  `ExerciseCommand` and `actAs: [<party>]`. The ledger runs the choice, enforces authorization, and
  returns the committed transaction (`updateId`, `offset`, `synchronizerId`, created/archived events).
- **CORS** — the JSON API sends no CORS headers, so in dev the Vite server proxies `/v2` → `:6864`
  and the browser calls same-origin.

Decimals are sent as strings (`"100"`) and returned zero-padded. The client resolves contract ids
before each action (e.g. find the borrower's collateral before `Accept`) so the UI buttons stay simple.

## 5. Flow by flow

Each flow below lists: the **trigger** (UI/client), the **off-chain** calls, the **on-ledger**
effect (what the choice archives/creates and who authorizes it), and the **after** state.
Canonical numbers: principal 100, interest 5, repayment 105, collateral 150 units, LTV 66.7%,
liquidation threshold 90%.

### Create offer — `CashHolding.MakeOffer`
- **Trigger:** lender submits the Create-offer form → `createOffer(draft)`.
- **Off-chain:** read the lender's `CashHolding` with `amount ≥ principal` (`findCash`), then
  `ExerciseCommand` `#veil:Veil:CashHolding` · `MakeOffer` (terms), `actAs: [Lender]`.
- **On-ledger** (authority: cash owner = lender): assert `amount ≥ principal`; **archive** the
  `CashHolding`; create change if any; **create `LoanOffer`** (sig lender, obs borrower+regulator).
- **After:** principal is escrowed (lender cash consumed). Status **Offered**. Borrower/regulator
  can see the offer; outsider cannot.

### Accept — `LoanOffer.Accept` (the atomic, two-party one)
- **Trigger:** borrower clicks Accept → `acceptOffer(offerCid)`.
- **Off-chain:** read the borrower's `CollateralHolding` (`findCollateral`), then `ExerciseCommand`
  `#veil:Veil:LoanOffer` · `Accept {collateralCid}`, `actAs: [Borrower]`.
- **On-ledger** (authority: controller **borrower** + offer signatory **lender**):
  fetch & validate the collateral (owner/asset/quantity); **archive `CollateralHolding`** (collateral
  LOCKED); **create borrower `CashHolding(principal)`** (principal delivered from escrow); **create
  `Loan`** (sig lender+borrower, obs regulator, `collateralLocked=True`). The offer is consumed.
- **Why it works:** spending the lender-funded principal needs lender authority — present because the
  lender signed the `LoanOffer` the choice is exercised on. Locking the borrower's collateral needs
  borrower authority — present as the controller. One atomic transaction.
- **After:** Status **Active**. Borrower wallet: `Cash 100` (+ existing `Cash 105`), collateral gone
  (locked). Lender wallet: empty (funded).

### Repay — `Loan.Repay`
- **Trigger:** borrower clicks Repay → `repayLoan(loanCid, principal+interest)`.
- **Off-chain:** read the borrower's `CashHolding` with `amount ≥ 105` (`findCash`), then
  `ExerciseCommand` `#veil:Veil:Loan` · `Repay {repaymentCid}`, `actAs: [Borrower]`.
- **On-ledger** (authority: controller borrower + signatories lender+borrower): validate cash ≥ 105;
  **archive** the repayment `CashHolding`; **create lender `CashHolding(105)`**; create borrower change
  if surplus; **create borrower `CollateralHolding(150)`** (released); **create `LoanClosed`**
  (`reason="Repaid"`, `collateralReleased=True`). The loan is consumed.
- **After:** Status **Repaid**. Lender `Cash 105` (+5 interest), borrower `Cash 100` + collateral back.
  Net: lender +5, borrower −5, cash conserved.

### Liquidate — `Loan.Liquidate`
- **Trigger:** lender clicks Liquidate (enabled in the UI only after "simulate price drop") →
  `liquidateLoan(loanCid, currentCollateralValue)`.
- **Off-chain:** `ExerciseCommand` `#veil:Veil:Loan` · `Liquidate {currentCollateralValue}`,
  `actAs: [Lender]`.
- **On-ledger** (authority: controller lender): **assert breach** —
  `currentCollateralValue > 0 && principal / value × 100 ≥ liquidationThresholdLtv` (so a healthy
  mark is rejected); **create lender `CollateralHolding(150)`** (seized); **create `LoanClosed`**
  (`reason="Liquidated"`, `collateralReleased=False`). The loan is consumed.
- **Note:** the price is supplied off-ledger by the lender (no on-ledger oracle in the MVP); the
  *breach condition* is enforced on-ledger. See issues #17 and #20 for the productionization path.

### Withdraw — `LoanOffer.Withdraw`
- **Trigger:** lender withdraws an un-accepted offer → `withdrawOffer(offerCid)`.
- **On-ledger** (authority: lender): **create lender `CashHolding(principal)`** (refund the escrow);
  the offer is consumed.
- **After:** Status returns to **none**; lender's cash is restored.

### Reset / seed (client orchestration, not a single choice)
`resetDemo()` makes the run repeatable: as the lender it withdraws open offers, force-closes live
loans (`Liquidate` with a near-zero mark to satisfy the guard), and `Dismiss`es `LoanClosed`s; then
each owner **archives** its remaining holdings (built-in `Archive` choice); finally `seedDemo()`
re-creates the canonical holdings (lender 100, borrower 105 + 150). `bootstrap.sh` performs the same
initial seed on a fresh sandbox.

## On-chain vs off-chain boundary

| On-chain (Canton enforces) | Off-chain (app / assumed) |
| --- | --- |
| Per-contract visibility (privacy) | Party identity / KYC (known counterparties) |
| Per-choice authorization | "Simulate price drop" toggle (UI only) |
| Collateral lock/release, cash movement, double-entry | The collateral **mark** for `Liquidate` (lender-supplied in the MVP) |
| Liquidation only on real LTV breach | Demo seeding + reset orchestration |
| `LoanClosed` settlement record | Activity feed (derived from tx responses) |

## End-to-end trace (Accept)

```text
Borrower clicks "Accept offer"  (App.tsx)
  → ledger.acceptOffer(offerCid)
      → findCollateral(borrower)                    READ: ACS as borrower → 150-unit cid
      → POST /v2/commands/submit-and-wait-for-transaction
           ExerciseCommand LoanOffer.Accept {collateralCid}, actAs:[Borrower]
  → Vite proxy → Canton :6864
      → runs Accept ON-LEDGER (borrower + lender authority):
          archive CollateralHolding (LOCKED) · create borrower CashHolding(100) · create Loan
      → returns transaction (updateId, offset, created/archived)
  → ledger.ts → TxResult → App appends to Activity feed
  → App re-queries ACS as active party → UI re-renders (Active, holdings updated)
```
