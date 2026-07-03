# Veil — Confidential Lending on Canton

> Hackathon-scoped Canton app for the Encode Build on Canton Hackathon.

**Live product:** Vercel DevNet deployment pending URL.

## Submission links

- **Repository:** <https://github.com/no-witness-labs/veil-lite-hackathon>
- **Live product:** Vercel DevNet deployment pending URL.
- **Presentation deck:** [`docs/PRESENTATION.pdf`](./docs/PRESENTATION.pdf)
- **Pitch video:** <https://no-witness-labs.github.io/veil-lite-hackathon/veil-pitch-video.mp4>

Veil is a deliberately small proof-of-concept for **private repo-style financing against tokenized collateral** on Canton.
A known borrower pledges tokenized collateral, such as tokenized Treasury bills or money-market fund units, to receive short-term financing from a known lender. The lender privately offers terms, the borrower accepts, collateral is locked, and only the lender, borrower, and optional regulator can see the resulting position.

## Why this exists

Institutional financing workflows cannot expose borrower identity, lender identity, terms, positions, collateral, or liquidation state to a public chain. At the same time, purely offchain workflows are fragmented across emails, PDFs, spreadsheets, custodians, and reconciliation processes. Canton is a strong fit because it gives us:

- **Need-to-know privacy**: contracts are visible only to signatories/observers.
- **Structural authorization**: signatories/controllers define who must authorize each lifecycle step.
- **Atomic multi-party workflows**: origination and settlement can be modeled as one transaction.
- **Selective disclosure**: a regulator/auditor can observe without making the market public.

## Hackathon scope

Build the smallest judge-friendly flow that proves Canton's advantage and satisfies the business criteria: strong real-world relevance, clear asset/financing logic, practical workflow design, and a use case where tokenization/onchain coordination genuinely helps.

Concrete demo framing: **private repo-style financing**. The borrower pledges 150 units of tokenized T-Bill/MMF collateral, receives 100 USDC-equivalent principal, owes 105 at repayment, and gets collateral released after repayment.

Build the flow:

1. Lender and borrower already know each other from an off-ledger private credit relationship.
2. Lender creates a private borrower-specific `LoanOffer`.
3. Borrower accepts and opens a loan.
4. Borrower's collateral becomes locked/escrowed in the loan state.
5. Regulator can observe the offer and loan.
6. Outsider cannot see either offer or loan.
7. Borrower repays and collateral is released.
8. Optional demo branch: lender submits a stressed collateral mark and liquidates if the on-ledger LTV guard permits it.
9. Future extension: lender publishes `LoanProgram`, borrower creates `BorrowRequest`, then lender offers.

## Contract model

Five Daml templates. Visibility is **structural** — a party sees a contract only if it is a
signatory (`S`) or observer (`O`); otherwise the contract does not exist for them. That is why the
outsider's ledger query returns nothing.

```text
 Who can see each contract            Lender   Borrower  Regulator  Outsider
 ─────────────────────────────────────────────────────────────────────────
 CashHolding        sig: owner          own       own        –         –     ← wallet is private:
 CollateralHolding  sig: owner          own       own        –         –       owner-only, no observers
 LoanOffer          sig: L  obs: B,R      S         O         O         –
 Loan               sig: L,B  obs: R      S         S         O         –
 LoanClosed         sig: L,B  obs: R      S         S         O         –
   S = signatory (authorizes + sees)   O = observer (sees only)   – = cannot see
```

Lifecycle and the money/collateral trail (canonical demo numbers):

```text
  seed ─ Lender wallet: Cash 100      Borrower wallet: Cash 105 · Collateral 150

  Lender ── MakeOffer(100) ─────────────►  LoanOffer            (principal pre-funded,
            [CashHolding choice]            sig L · obs B,R       escrowed in the offer)
                                               │
            Borrower ── Accept(collateral) ────┤  locks collateral, draws principal
                                               ▼
                                            Loan  (collateralLocked)      sig L,B · obs R
                                            ├─ borrower +Cash 100 (principal delivered)
                                            └─ collateral 150 → LOCKED (no free holding)
                                               │
                 ┌── Borrower Repay(cash ≥105) ─┴─ Lender Liquidate(value) ──┐
                 ▼          (only if LTV breaches threshold) ────────────────▼
            LoanClosed: Repaid                              LoanClosed: Liquidated
            ├─ collateral 150 → borrower (released)         └─ collateral 150 → lender (seized)
            └─ cash 105 → lender (principal + interest)

  (LoanOffer ── Withdraw ──► refunds Cash 100 to the lender, before acceptance)

  Net over a repay:  lender +5 · borrower −5 · collateral round-trips · total cash conserved
```

State: `none → Offered → Active → Repaid | Liquidated` (Withdraw returns `Offered → none`).

Authorization is structural too: the borrower can draw the lender's principal only because the lender
pre-signed the `LoanOffer`; `Liquidate` is rejected unless the supplied collateral value breaches the
LTV threshold; and the active `Loan` needs **both** signatures, so neither side can rewrite the deal.

For the full end-to-end picture — build, deploy, the JSON Ledger API, and a step-by-step walkthrough of
every flow (create offer, accept, repay, liquidate, withdraw, reset) — see **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

## Non-goals for hackathon

- Production Token Standard integration with real external providers.
- Wallet Gateway / external signing UX.
- PQS dashboard and production indexing.
- Oracle-signed `PriceFeed` / k-of-n oracle network.
- Partial liquidation, reserves, bad debt tranching.
- Real institution onboarding/compliance workflows.
- Mainnet/TestNet deployment guarantees.

## Submission requirements

This project explicitly tracks the Encode submission requirements in [`docs/SUBMISSION-CHECKLIST.md`](./docs/SUBMISSION-CHECKLIST.md):

- **Public repository** — publish this directory as a public GitHub repo with setup/demo docs.
- **Presentation deck** — create a concise 7–10 slide deck covering problem, solution, why Canton, demo flow, architecture, current status, and roadmap.
- **3 minute video pitch with demo** — record known-counterparty lender offer → borrower accept → regulator observes → outsider sees nothing → repay/release.
- **Link to live product** — host the live DevNet-backed role-based app on Vercel.

## Daml development

This repo uses Daml SDK `3.5.1` and Daml-LF target `2.2` for Canton-oriented development.

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
(cd test && dpm build && dpm test)
```

The root package contains deployable templates only. The `test/` package depends on the root DAR and contains Daml Script tests, keeping `daml-script` out of the deployable package.

## Run the role-based demo

The demo is a React UI wired to Canton over the JSON Ledger API v2. It can target
the local sandbox during development or the shared Seaport / Five North DevNet in
production. Each role queries the ledger as its own party, so the **Outsider tab
genuinely returns nothing** — the privacy claim is proven on-ledger, not mocked.

> Quick start below. For full operational detail, the demo walkthrough, and troubleshooting, see the
> **[Runbook](./docs/RUNBOOK.md)**.

> **JDK requirement:** Canton 3.5 must run on an LTS JDK. On Oracle JDK 20 the bundled BouncyCastle provider
> fails JCE authentication (`JCE cannot authenticate the provider BC`) and every transaction errors. The start
> script pins Homebrew **OpenJDK 17**; install it with `brew install openjdk@17`, or point `VEIL_JAVA_HOME` at
> your own JDK 17/21.

```bash
# 1. Start the sandbox on JDK 17, upload the DAR, allocate the four demo parties,
#    and write frontend/public/ledger-config.json.
./scripts/start-sandbox.sh

# 2. In a second terminal, run the UI (Vite dev server proxies /v2 to the sandbox).
npm --prefix frontend install
npm --prefix frontend run dev   # http://localhost:5173
```

For Canton DevNet / Seaport:

```bash
dpm build
cp frontend/.env.local.example frontend/.env.local   # add the Seaport client secret locally
set -a; . frontend/.env.local; set +a
python3 scripts/bootstrap-devnet.py
npm --prefix frontend run dev
```

See **[docs/DEVNET.md](./docs/DEVNET.md)** for the full DevNet setup. The DevNet package name is
`veil-lite` and the deployable DAR is `.daml/dist/veil-lite-0.1.0.dar`.
See **[docs/VERCEL.md](./docs/VERCEL.md)** for the Vercel deployment environment variables and smoke checks.

3-minute click path: **Lender** create offer → **Borrower** sees it → **Outsider** sees nothing →
**Borrower** accept (collateral LOCKED) → **Regulator** observes read-only → **Borrower** repay (collateral
RELEASED). Optional: **Lender** simulate price drop → liquidate. "Reset demo" clears the ledger for another run.

### What the UI proves it is really on Canton

The UI surfaces the ledger's own evidence, so nothing has to be taken on trust:

- **Party-ID strip** (under the header) — the four roles are distinct on-ledger Canton parties on one participant.
- **Deal card** — shows the real contract ID and ledger offset behind the position.
- **Ledger activity feed** — every action lists its committed transaction: `updateId`, ledger offset,
  synchronizer ID, and the contracts created/archived.
- **Raw ledger view** (collapsible) — the exact JSON each party gets from the `active-contracts` query.
  Switching to **Outsider** makes the strongest point: the same panel is literally `[]`.
- **Your holdings** — each party's own wallet (cash + tokenized collateral). Holdings are owner-signatory with
  no observers, so a party sees only its own. The full double-entry settles on-ledger: the borrower starts with
  150 collateral + 105 cash, accepting locks the collateral and delivers 100 principal, and repaying returns the
  collateral while the lender ends with 105 (principal + 5 interest).

Strongest single demo moment: view the deal as **Lender**, expand the raw ledger view, then switch to
**Outsider** — the same query returns nothing.

The sandbox runs with auth disabled for local development only.

> **Dev dependencies:** `esbuild` is pinned to `^0.25` (via `overrides`) to clear its dev-server advisory.
> One dev-server-only Vite advisory remains (fixable only by a major `vite@8` bump, deferred to avoid
> pre-demo regressions). It does not affect production build output — but run `npm run dev` on a trusted
> network only.

## Where Veil sits in the Canton stack

Veil deliberately runs on the lightest Canton runtime so the demo is dependency-light and judge-runnable.
The official docs define the **sandbox** as "Run a single Canton node via Daml SDK" (`dpm sandbox`) — a minimal
environment. Our startup logs confirm exactly that: one participant plus a local synchronizer (sequencer +
mediator), in-memory, with **no Splice, Super Validator, Canton Coin, or Scan**.

The next rung up is **LocalNet** — a Docker Compose environment that "mirrors the Canton Network topology": three
participants (App Provider, App User, Super Validator), test Canton Coin, and the wallet / SV / Scan UIs. The
[`cn-quickstart`](https://github.com/digital-asset/cn-quickstart) full-stack template builds on LocalNet and adds a
Spring Boot backend, PQS, Keycloak OAuth2, and the Splice token-standard apps (it targets Daml Enterprise).

| | **Veil (this repo)** | **LocalNet / cn-quickstart** |
| --- | --- | --- |
| Runtime | local `dpm sandbox` or shared Seaport DevNet | Docker Compose LocalNet |
| Participants | one (privacy shown per-party on one node) | three (privacy across separate nodes) |
| Assets | demo `CashHolding` / `CollateralHolding` (on-ledger double-entry) | test Canton Coin / token standard |
| Auth | none locally; OIDC client-credentials proxy on DevNet/Vercel | Keycloak OAuth2 / shared-secret |
| Extras | hand-rolled JSON Ledger API v2 client + Vercel `/v2` proxy | backend, PQS, wallet, Scan, observability |
| Start | `./scripts/start-sandbox.sh` or Vercel deployment | `make setup && make build && make start` |

Trade-off: the sandbox proves the **privacy model and financing lifecycle** with almost no setup, but privacy is
demonstrated on a single participant rather than across nodes, and there are no real tokenized assets or production
auth (all explicit non-goals above). The path toward production is to adopt the LocalNet/cn-quickstart stack:
multiple participants, the token standard, OAuth, and PQS.

Sources: [Canton development stack](https://docs.canton.network/appdev/modules/m1-development-stack.md) ·
[LocalNet](https://docs.canton.network/appdev/modules/m5-localnet-development.md) ·
[cn-quickstart](https://github.com/digital-asset/cn-quickstart)

## Directory map

```text
veil/
├── README.md
├── daml.yaml
├── daml/
│   └── Veil.daml
├── test/
│   ├── daml.yaml
│   └── daml/
│       └── Veil/
│           └── Test.daml
├── api/                  # Vercel functions: /v2 proxy + ledger config
├── vercel.json           # Vercel build/output/rewrites
├── scripts/
│   ├── start-sandbox.sh   # start Canton on JDK 17 + bootstrap
│   └── bootstrap.sh       # upload DAR, allocate parties, write config
├── frontend/              # Vite + React UI over the JSON Ledger API v2
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── ledger.ts      # JSON Ledger API v2 client
│       ├── state.ts       # view derivation
│       └── components/
├── docs/
│   ├── ARCHITECTURE.md    # e2e: build, deploy, JSON API, per-flow walkthroughs
│   ├── RUNBOOK.md         # run steps, demo walkthrough, troubleshooting
│   ├── BUSINESS-CASE.md
│   ├── PRD.md
│   ├── CONTEXT.md
│   ├── GRILL.md
│   ├── SUBMISSION-CHECKLIST.md
│   ├── DEVNET.md
│   ├── VERCEL.md
│   └── adr/
│       └── 0001-hackathon-scope.md
└── .hermes/
    └── plans/
        └── implementation-plan.md
```
