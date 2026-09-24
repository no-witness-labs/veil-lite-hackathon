# Veil Architecture — end to end

How Veil goes from Daml source to a running, judge-clickable app, and exactly what each
action does on and off the ledger. For the contract visibility/lifecycle diagrams see the
[Contract model](../README.md#contract-model) in the README; for run commands see the
[Runbook](./RUNBOOK.md).

## The stack (5 layers)

```text
 5. Browser UI         frontend/src/App.tsx + components      what the judge clicks
 4. Off-chain client   frontend/src/ledger.ts (fetch)         speaks JSON to the ledger
       Authenticated proxy   /v2 → 127.0.0.1:6864
 3. JSON Ledger API v2  HTTP :6864   (gRPC Ledger API :6865)  the on/off-chain boundary
 2. Canton sandbox      participant + sequencer + mediator +  runs contracts, enforces
       synchronizer (dpm sandbox, in-memory, JWT auth)        privacy + authorization
 1. Contracts           daml/Veil.daml → veil-lite-0.5.0.dar  the rules (on-ledger)
```

## 1. Contracts (on-ledger)

Seven Daml templates in `daml/Veil.daml`; detailed policies are in [SEASON3.md](SEASON3.md):

| Template | Signatory / Observer | Purpose | Choices |
| --- | --- | --- | --- |
| `CashHolding` | sig issuer, owner | issuer-authorized demo cash | `MakeOffer`, `Split` |
| `CollateralHolding` | sig issuer, owner | issuer-authorized demo T-Bill/MMF inventory | `SplitCollateral` |
| `ValuationStream` | sig valuer, lender, borrower · obs regulator | agreed price stream registration | `PublishInitial` |
| `CollateralValuation` | sig valuer, lender, borrower · obs regulator | current attested unit price | `Publish` |
| `LoanOffer` | sig issuer, lender · obs borrower, regulator | private offer holding reserved principal | `Accept`, `Withdraw` |
| `Loan` | sig issuer, lender, borrower · obs regulator | position with optional margin-call state | `IssueMarginCall`, `TopUpCollateral`, `ResolveMarginCall`, `Repay`, `Liquidate`, `LiquidateOverdue` |
| `LoanClosed` | sig issuer, lender, borrower · obs regulator | terminal settlement record | `Dismiss` |

Two properties are enforced by Canton, not the app:
- **Privacy** — active loan views are scoped to issuer, lender, borrower, and regulator. Valuer sees price records, not loans. Holdings start visible to owner and issuer; only exact deposits and repayments are fetched by shared transactions, keeping the owner's remaining inventory out of the counterparty's view.
- **Authorization** — a choice body runs with the authority of its controller **plus the
  contract's signatories**, which is how cross-party atomic moves are authorized (see Accept).

## 2. Build & package

```bash
dpm build                       # daml/Veil.daml → .daml/dist/veil-lite-0.5.0.dar
(cd test && dpm build && dpm test)
```

A **DAR** bundles the compiled templates (Daml-LF target `2.2`). Its package id
identifies this exact code; the app references templates by package *name*
(`#veil-lite:Veil:LoanOffer`) so references survive recompiles. (`dpm codegen-js` could generate
TypeScript bindings; we hand-rolled a small client instead — see layer 4.)

## 3. Run & deploy

`scripts/start-sandbox.sh` (pinned to OpenJDK 17) starts `dpm sandbox`, waits for readiness,
then runs `scripts/bootstrap.sh`, which:

1. **Uploads the DAR** — `POST /v2/packages` (octet-stream) → templates exist on the participant.
2. **Allocates parties** — `POST /v2/parties {partyIdHint}` for Lender/Borrower/Regulator/Valuer/Outsider/DemoIssuer
   → on-ledger identities like `Lender::<fingerprint>`.
3. **Seeds holdings** — issuer and each owner co-authorize lender `CashHolding(100)`, borrower `CashHolding(105)` + `CollateralHolding(150)` + a separate `CollateralHolding(50)` reserve. These are simulated assets.
4. **Writes config** — `frontend/public/ledger-config.json` (the party ids the UI fetches at runtime).
5. **Registers an agreed stream and initial price** — a demo `CreateAndExerciseCommand` carries lender, borrower, and valuer authority and exercises `PublishInitial` with price 1. This simulates their joint consent; it is not independent wallet signing.

The sandbox is in-memory: restarting it is a clean ledger.

## 4. Off-chain interaction model (JSON Ledger API v2)

The browser sends an expiring role token to the same-origin proxy. The proxy checks
the signed identity and requested parties, then forwards the same token to Canton
on `:6864`. Canton independently verifies the JWT and the user's ledger rights;
an `actAs` field alone grants no authority. See [AUTH.md](AUTH.md) for role rights
and the trusted local operator boundary. The client is
`frontend/src/ledger.ts`, a thin `fetch` wrapper (the npm `@daml/ledger` targets the old v1 API).

- **Reads** — `GET /v2/state/ledger-end` (offset) then `POST /v2/state/active-contracts` filtered
  to a party. You always query **as a party**, so the result is exactly that party's visible set —
  token permissions also limit which party the caller can name.
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
- **Terms:** `maturity` is an RFC3339 UTC timestamp and `valuationCid` identifies a fresh current price from the agreed stream. The offer stores that price's immutable `streamId`; a later parallel stream cannot replace it.
- **Off-chain:** read the lender's `CashHolding` with `amount ≥ principal` (`findCash`), then
  `ExerciseCommand` `#veil-lite:Veil:CashHolding` · `MakeOffer` (terms), `actAs: [Lender]`.
- **On-ledger** (authority: controller lender + cash signatory issuer): require a fresh scoped price and LTV strictly below the liquidation threshold; assert `amount ≥ principal`; **archive** the
  `CashHolding`; create change if any; **create `LoanOffer`** (sig issuer+lender, obs borrower+regulator). All outputs retain the issuer.
- **After:** principal is escrowed (lender cash consumed). Status **Offered**. Borrower/regulator
  can see the offer; outsider cannot.

### Accept — `LoanOffer.Accept`
- **Trigger:** borrower clicks Accept → `acceptOffer(offerCid)`.
- **Off-chain:** read the current valuation for the offer's exact stream and the borrower's `CollateralHolding` (`findCollateral`), then `ExerciseCommand`
  `#veil-lite:Veil:LoanOffer` · `Accept {collateralCid, valuationCid}`, `actAs: [Borrower]`.
- **On-ledger** (authority: controller **borrower** + offer signatories **issuer and lender**):
  require ledger time strictly before maturity and a fresh current price from the agreed stream showing LTV strictly below the liquidation threshold;
  fetch & validate the collateral (issuer/owner/asset/quantity); **archive `CollateralHolding`** (collateral
  LOCKED); **create borrower `CashHolding(principal)`** (principal delivered from escrow); **create
  `Loan`** (sig issuer+lender+borrower, obs regulator, `collateralLocked=True`). The offer is consumed.
- **Why it works:** the issuer and lender signed the funded offer; the borrower controls acceptance. Their combined authority moves the principal and collateral atomically. Acceptance and withdrawal consume the same offer, so the reserved principal cannot be spent twice. A lender cannot construct an offer under the trusted issuer without its authority. See the [issuer/escrow decision](adr/0002-controlled-issuer-and-funded-offers.md) for the privileged issuance boundary.
- **After:** Status **Active**. Borrower wallet: `Cash 100` (+ existing `Cash 105`), 150 collateral locked and 50 reserve available. Lender wallet: empty (funded).
- **Price changes:** a fall after offer creation can block acceptance. The offer remains withdrawable, and recovery on the same stream can make it acceptable again. A rejected acceptance leaves the offer and collateral unconsumed and delivers no principal.

### Repay — `Loan.Repay`
- **Trigger:** borrower clicks Repay → `repayLoan(loanCid, principal+interest)`.
- **Off-chain:** read the borrower's `CashHolding` with `amount ≥ 105` (`findCash`), then
  `ExerciseCommand` `#veil-lite:Veil:Loan` · `Repay {repaymentCid}`, `actAs: [Borrower]`.
- **On-ledger** (authority: controller borrower + signatories issuer+lender+borrower): validate cash issuer, owner, and amount == 105;
  **archive** the repayment `CashHolding`; **create lender `CashHolding(105)`**;
  **create borrower `CollateralHolding` for all currently locked units** (released); **create `LoanClosed`**
  (`reason="Repaid"`, `collateralReleased=True`). The loan is consumed.
- **After:** Status **Repaid**. Lender `Cash 105` (+5 interest), borrower `Cash 100` + collateral back.
  Net: lender +5, borrower −5, cash conserved.

### Margin call and cure
- The valuer exercises `Publish` on the current `CollateralValuation`. Canton archives it and creates a replacement with the same stream ID and a ledger timestamp. Economic accuracy remains trusted. Neither the valuer nor a counterparty alone has the authority to fabricate a price with all required signatories.
- Lender exercises `IssueMarginCall {valuationCid}`. The loan verifies stream identity, agent, counterparties, asset, freshness, and LTV. It replaces itself with a call carrying a ledger-time deadline. Reissuing an open call fails.
- Borrower exercises `TopUpCollateral {collateralCid, topUpQuantity, valuationCid}` before both deadline and maturity. The exact deposit must match the loan's issuer and asset and is consumed only if the current price proves the new total collateral restores LTV below the threshold; a replacement loan clears the call.
- Before maturity, borrower can `ResolveMarginCall {valuationCid}` on price recovery, including after the call deadline. Repayment remains allowed even after maturity.

### Liquidate — `Loan.Liquidate`
- Lender submits `Liquidate {valuationCid}`.
- Canton requires an open call whose deadline has passed and a fresh, correctly scoped price record that still shows a breach.
- The loan is consumed; a lender holding receives **all currently locked collateral** and `LoanClosed` records liquidation. The current price is read, not archived by this action.

### Maturity default — `Loan.LiquidateOverdue`
- Requires lender authority and ledger time strictly after the agreed maturity; no price or margin call is required.
- Transfers all currently locked collateral to the lender and creates a `LoanClosed` record with reason `LiquidatedAtMaturity`.
- Repayment and liquidation consume the same loan: once either commits the other cannot execute. An ongoing call or a prior top-up never changes maturity.

### Withdraw — `LoanOffer.Withdraw`
- **Trigger:** lender withdraws an un-accepted offer → `withdrawOffer(offerCid)`.
- **On-ledger** (authority: lender controller + issuer signatory): **create lender `CashHolding(principal)`** under the same issuer (refund the escrow);
  the offer is consumed.
- **After:** Status returns to **none**; lender's cash is restored.

### Reset / seed (client orchestration, not a single choice)
`resetDemo()` withdraws offers, cooperatively archives live loans using issuer, lender, and borrower authority, dismisses settlement records, and clears holdings and valuations/streams with all their signatories. It then seeds lender cash 100, borrower cash 105, borrower collateral 150 + 50, and a new agreed price stream. This is destructive **demo cleanup**, not a real cancellation or a liquidation bypass. Only issuance and reset submit with issuer `actAs`; normal user actions inherit issuer authority from their contracts.

## On-chain vs off-chain boundary

| On-chain (Canton enforces) | Off-chain (app / assumed) |
| --- | --- |
| Per-contract visibility (privacy) | Party identity / KYC (known counterparties) |
| Per-choice authorization and attestation source | Valuer's manually supplied unit price and its economic accuracy |
| Collateral lock/release, cash movement, double-entry | Demo holdings with no real asset backing |
| Maturity, margin deadline, price replacement/freshness, and LTV | Demo seeding + reset orchestration |
| `LoanClosed` settlement record | Activity feed (derived from tx responses) |

The client pins a configured issuer and excludes other issuers from operational holdings and deal selection. The raw ledger inspector still represents the party's returned data. Daml does not provide a global canonical issuer: each position records its issuer, and every deposit/payment must match it. The issuer can authorize fresh supply; conservation applies between issuance/reset operations, not against a malicious issuer.

## End-to-end trace (Accept)

```text
Borrower clicks "Accept offer"  (App.tsx)
  → ledger.acceptOffer(offerCid)
      → resolve current agreed-stream valuation     READ: ACS as borrower → current mark cid
      → findCollateral(borrower)                    READ: ACS as borrower → 150-unit cid
      → POST /v2/commands/submit-and-wait-for-transaction
           ExerciseCommand LoanOffer.Accept {collateralCid, valuationCid}, actAs:[Borrower]
  → Vite proxy → Canton :6864
      → runs Accept ON-LEDGER (borrower + issuer + lender authority):
          archive CollateralHolding (LOCKED) · create borrower CashHolding(100) · create Loan
      → returns transaction (updateId, offset, created/archived)
  → ledger.ts → TxResult → App appends to Activity feed
  → App re-queries ACS as active party → UI re-renders (Active, holdings updated)
```
