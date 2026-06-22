# Veil — Confidential Lending on Canton

> Hackathon-scoped Canton app for the Encode Build on Canton Hackathon.

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
8. Optional demo branch: oracle price drops and lender liquidates.
9. Future extension: lender publishes `LoanProgram`, borrower creates `BorrowRequest`, then lender offers.

## Non-goals for hackathon

- Production Token Standard integration with real external providers.
- Wallet Gateway / external signing UX.
- PQS dashboard and production indexing.
- k-of-n oracle network.
- Partial liquidation, reserves, bad debt tranching.
- Real institution onboarding/compliance workflows.
- Mainnet/TestNet deployment guarantees.

## Submission requirements

This project explicitly tracks the Encode submission requirements in [`docs/SUBMISSION-CHECKLIST.md`](./docs/SUBMISSION-CHECKLIST.md):

- **Public repository** — publish this directory as a public GitHub repo with setup/demo docs.
- **Presentation deck** — create a 5–7 slide deck covering problem, solution, why Canton, demo flow, architecture, current status, and roadmap.
- **3 minute video pitch with demo** — record known-counterparty lender offer → borrower accept → regulator observes → outsider sees nothing → repay/release.
- **Link to live product** — host a judge-friendly role-based demo URL, preferably static and reliable.

## Daml development

This repo uses Daml SDK `3.5.1` and Daml-LF target `2.1` for Canton-oriented development.

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
(cd test && dpm build && dpm test)
```

The root package contains deployable templates only. The `test/` package depends on the root DAR and contains Daml Script tests, keeping `daml-script` out of the deployable package.

## Run the role-based demo

The demo is a React UI wired to a live Canton sandbox over the JSON Ledger API v2. Each role queries the
ledger as its own party, so the **Outsider tab genuinely returns nothing** — the privacy claim is proven
on-ledger, not mocked.

> Quick start below. For full operational detail, the demo walkthrough, and troubleshooting, see the
> **[Runbook](./docs/RUNBOOK.md)**.

> **JDK requirement:** Canton 3.5 must run on an LTS JDK. On Oracle JDK 20 the bundled BouncyCastle provider
> fails JCE authentication (`JCE cannot authenticate the provider BC`) and every transaction errors. The start
> script pins Homebrew **OpenJDK 17**; install it with `brew install openjdk@17`, or point `VEIL_JAVA_HOME` at
> your own JDK 17/21.

```bash
# 1. Start the sandbox on JDK 17, upload the DAR, allocate the four demo parties,
#    and write frontend/src/ledger-config.json.
./scripts/start-sandbox.sh

# 2. In a second terminal, run the UI (Vite dev server proxies /v2 to the sandbox).
npm --prefix frontend install
npm --prefix frontend run dev   # http://localhost:5173
```

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
| Runtime | single-process `dpm sandbox`, in-memory | Docker Compose LocalNet |
| Participants | one (privacy shown per-party on one node) | three (privacy across separate nodes) |
| Assets | demo `Decimal` fields | test Canton Coin / token standard |
| Auth | none (sandbox, dev only) | Keycloak OAuth2 / shared-secret |
| Extras | hand-rolled JSON Ledger API v2 client | backend, PQS, wallet, Scan, observability |
| Start | `./scripts/start-sandbox.sh` | `make setup && make build && make start` |

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
│   ├── BUSINESS-CASE.md
│   ├── PRD.md
│   ├── CONTEXT.md
│   ├── GRILL.md
│   ├── SUBMISSION-CHECKLIST.md
│   └── adr/
│       └── 0001-hackathon-scope.md
└── .hermes/
    └── plans/
        └── implementation-plan.md
```
