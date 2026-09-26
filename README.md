# Veil — Confidential Lending on Canton

> HackCanton Season 3 development: private financing with controlled demo issuance, funded offers, attested prices, margin calls, collateral top-ups, and enforced maturity.

**Live demo:** <https://veil-lite-hackathon.vercel.app/> runs the current Season 3 version on the HackCanton DevNet node. Sign in by choosing a party and entering the demo passcode from the submission notes; each party is a separate five-minute session, so sign out and back in to switch.

**Try it:**

0. **Valuer** → `Healthy · 1.00` → `Publish mark`. A price is usable for five minutes, so start here whenever the offer or acceptance button reports a stale valuation.
1. **Lender** → `Create offer`.
2. **Borrower** → `Accept offer`.
3. **Valuer** → `Stress · 0.62` → `Publish mark`.
4. **Lender** → `Issue margin call`.
5. **Borrower** → `Top up 50 units`, then `Repay`.
6. **Regulator** sees the settlement; **Outsider** → `Raw ledger` shows `[]`.

Paying down instead of topping up (step 5 alternative): **Borrower** → `Pay down` 30. It settles the 5 interest and 25 principal, bringing LTV to about 80.6% at the 0.62 price, so Canton clears the call. The final `Repay` is then 75.

Collateral substitution (between steps 2 and 5, with no margin call open): **Borrower** → `Propose substitution` escrows 160 units of Tokenized MMF against the 150 locked T-Bills → **Valuer** selects `Tokenized MMF` → `Healthy · 1.00` → `Publish mark` → **Lender** → `Approve substitution`. In one transaction Canton rechecks LTV on the MMF price, locks the MMF, rebinds the loan to the MMF price stream, and returns the T-Bills. The lender approves without ever seeing the borrower's wallet.

**Current scope, baseline, policies, and review handoff:** [Season 3](docs/SEASON3.md).

## Season 3 team pack

- **Current recordings:** [three-minute walkthrough](docs/veil-season3-demo.mp4) · [unsafe acceptance check](docs/veil-season3-unsafe-acceptance.mp4) · [evidence and recording notes](docs/SEASON3-RECORDINGS.md).
- **Team presentation:** [PDF](docs/SEASON3-PRESENTATION.pdf) · [browser slides](docs/SEASON3-PRESENTATION.html) · [editable Markdown](docs/SEASON3-PRESENTATION.md).
- **Repeatable three-minute demo:** [script and preflight](docs/SEASON3-DEMO-SCRIPT.md).
- **Invited Canton reviewers:** [audit scope, invariants, and reproduction commands](docs/SEASON3-AUDIT-HANDOFF.md).

The presentation covers why we chose to improve Veil, the proposed Track 2 fit,
the Season 3 changes, verified local behavior, and what remains before a pilot.
The pack does not claim external audit, customer validation, or a current hosted deployment.

## Prior submission links (pre-Season 3)

- **Repository:** <https://github.com/no-witness-labs/veil-lite-hackathon>
- **Live product:** <https://veil-lite-hackathon.vercel.app/>
- **Presentation deck:** [`docs/PRESENTATION.pdf`](./docs/PRESENTATION.pdf)
- **Pitch video:** <https://no-witness-labs.github.io/veil-lite-hackathon/veil-pitch-video.mp4>

Veil is a deliberately small proof-of-concept for **private repo-style financing against tokenized collateral** on Canton.
A known borrower pledges tokenized collateral, such as tokenized Treasury bills or money-market fund units, to receive short-term financing from a known lender. The lender privately offers terms, the borrower accepts, and collateral is locked. In this sandbox model, the lender, borrower, demo issuer, and optional regulator see the position; the issuer authorizes simulated cash and collateral, with no real asset backing.

## Why this exists

Institutional financing workflows cannot expose borrower identity, lender identity, terms, positions, collateral, or liquidation state to a public chain. At the same time, purely offchain workflows are fragmented across emails, PDFs, spreadsheets, custodians, and reconciliation processes. Canton is a strong fit because it gives us:

- **Need-to-know privacy**: role-scoped contract views, with disclosure checked at each workflow step.
- **Structural authorization**: signatories/controllers define who must authorize each lifecycle step.
- **Atomic multi-party workflows**: origination and settlement can be modeled as one transaction.
- **Selective disclosure**: a regulator/auditor can observe without making the market public.

## Hackathon scope

Build the smallest judge-friendly flow that proves Canton's advantage and satisfies the business criteria: strong real-world relevance, clear asset/financing logic, practical workflow design, and a use case where tokenization/onchain coordination genuinely helps.

Concrete demo framing: **private repo-style financing**. The borrower pledges 150 units of tokenized T-Bill/MMF collateral, receives 100 USDC-equivalent principal, owes 105 at repayment, and gets collateral released after repayment.

Build the flow:

1. Lender and borrower already know each other from an off-ledger private credit relationship.
2. Lender consumes issuer-authorized cash to create a private borrower-specific `LoanOffer` holding the reserved principal, binding it to the jointly authorized valuation stream and a future repayment timestamp. A fresh current price must show LTV below the agreed liquidation threshold.
3. Borrower accepts and opens a loan only while a fresh current price from that same stream still shows LTV below the agreed liquidation threshold.
4. Borrower's collateral becomes locked/escrowed in the loan state.
5. Regulator can observe the offer and loan.
6. Outsider cannot see either offer or loan.
7. Borrower repays and collateral is released.
8. A separately named valuation agent replaces the current attested price. The old price is archived; the agent cannot see the loan.
9. The lender opens a margin call when a fresh valuation shows an LTV breach. Canton records a cure deadline.
10. The borrower deposits an exact 50-unit reserve before the deadline, bringing locked collateral to 200 and clearing the call. Repayment returns all 200 units.
11. Alternatively, an expired call can be liquidated only if a fresh valuation still shows a breach. A recovered price can resolve the call without a deposit.
12. Past the repayment timestamp, the lender may instead liquidate for nonpayment without a price check. Repayment remains available until the loan closes.

## Contract model

Eight Daml templates. Loan states are scoped to issuer, lender, borrower, and regulator. The valuation agent sees price attestations but is not a loan observer. These active-contract views are not a claim that historical disclosures can be revoked.

```text
 Contract              Issuer   Lender   Borrower   Regulator   Valuer   Outsider
 ──────────────────────────────────────────────────────────────────────────────
 CashHolding              S      own       own          –         –        –
 CollateralHolding        S      own       own          –         –        –
 LoanOffer                S       S         O           O         –        –
 Loan                     S       S         S           O         –        –
 LoanClosed               S       S         S           O         –        –
 SubstitutionRequest      S       O         S           O         –        –
 ValuationStream          –       S         S           O         S        –
 CollateralValuation      –       S         S           O         S        –
   S = signatory (authorizes + sees)   O = observer (sees only)   – = cannot see
```

Lifecycle and the money/collateral trail (canonical demo numbers):

```text
  seed ─ Lender wallet: Cash 100      Borrower: Cash 105 · Collateral 150 + reserve 50

  Lender ── MakeOffer(100) ─────────────►  LoanOffer            (principal pre-funded,
            [CashHolding choice]          sig I,L · obs B,R       escrowed in the offer)
                                               │
            Borrower ── Accept(collateral) ────┤  locks collateral, draws principal
                                               ▼
                                            Loan  (collateralLocked)    sig I,L,B · obs R
                                            ├─ borrower +Cash 100 (principal delivered)
                                            └─ collateral 150 → LOCKED (no free holding)
                                               │
             ┌── Borrower Repay(exact 105)       └── fresh attested breach
             ▼                                          │
        LoanClosed: Repaid                        IssueMarginCall
        all collateral → borrower                       │
        cash 105 → lender                   ┌───────────┴────────────┐
                                     TopUp / recovered price     deadline + fresh breach
                                            │                     │
                                         Active             LoanClosed: Liquidated
                                                            all collateral → lender

  (LoanOffer ── Withdraw ──► refunds Cash 100 to the lender, before acceptance)

  Net over a repay:  lender +5 · borrower −5 · collateral round-trips · total cash conserved
```

State: `none → Offered → Active → Margin call → Active | Liquidated`. Repayment is available from Active or Margin call; withdrawal refunds an unaccepted offer.

Authorization is structural too: the borrower draws principal from an issuer-and-lender-signed `LoanOffer`. The offer itself is escrow; acceptance and withdrawal consume the same contract, so only one can release its principal. Normal spending preserves issuer and supply, and counterparties cannot directly create contracts under the configured issuer without its authority. The trusted issuer can authorize new supply, including privileged direct offer creation; this is controlled demo issuance, not custody or external backing. See the [issuer decision](docs/adr/0002-controlled-issuer-and-funded-offers.md).

Margin liquidation requires an expired call and a fresh current price from the agreed stream. A separate maturity-default action requires ledger time strictly after the repayment timestamp. Each loan replacement retains issuer, lender, and borrower signatures and the regulator observer.

For the full end-to-end picture — build, deploy, the JSON Ledger API, and a step-by-step walkthrough of
every flow (create offer, accept, repay, liquidate, withdraw, reset) — see **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

## Non-goals for hackathon

- Production Token Standard integration with real external providers.
- Wallet Gateway / external signing UX.
- PQS dashboard and production indexing.
- External market-price integration / k-of-n oracle network. This iteration authenticates manually submitted valuations.
- Partial liquidation, reserves, bad debt tranching.
- Real institution onboarding/compliance workflows.
- Mainnet/TestNet deployment guarantees.

## Earlier Encode submission requirements

The earlier Encode submission tracked these requirements in [`docs/SUBMISSION-CHECKLIST.md`](./docs/SUBMISSION-CHECKLIST.md). For the current Season 3 scope and evidence, use the team pack above.

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

The demo is a React UI wired to an authenticated Canton sandbox over the JSON Ledger
API v2. Each role signs in with its own expiring token and queries its authorized
party. The outsider's empty view comes from the ledger. See [role access](docs/AUTH.md)
for permissions and remaining trust boundaries. Hosted deployment is deferred.

> Quick start below. For full operational detail, the demo walkthrough, and troubleshooting, see the
> **[Runbook](./docs/RUNBOOK.md)**.

> **JDK requirement:** Canton 3.5 must run on an LTS JDK. On Oracle JDK 20 the bundled BouncyCastle provider
> fails JCE authentication (`JCE cannot authenticate the provider BC`) and every transaction errors. The start
> script pins Homebrew **OpenJDK 17**; install it with `brew install openjdk@17`, or point `VEIL_JAVA_HOME` at
> your own JDK 17/21.

```bash
# 1. Start the sandbox on JDK 17, upload the DAR, allocate five roles plus issuer,
#    and write frontend/public/ledger-config.json.
./scripts/start-sandbox.sh

# 2. In a second terminal, run the UI (Vite dev server proxies /v2 to the sandbox).
npm --prefix frontend install
npm --prefix frontend run dev   # http://localhost:5173
```

Sign in using the required role's token from the gitignored `.local/auth/` directory.
Tokens stay in browser memory. Ordinary accounts have a fixed role; only the demo
operator has role-view tabs and **Reset demo**. To demonstrate access isolation,
use separate role logins. See **[docs/AUTH.md](./docs/AUTH.md)**.

The hosted demo runs on the shared HackCanton DevNet node, where judges sign in
by picking a party and entering the demo passcode. On that node the team has a
single ledger user for all parties, so Veil's server alone enforces the role
boundary; see **[docs/DEVNET.md](./docs/DEVNET.md)** and
**[docs/VERCEL.md](./docs/VERCEL.md)**.

3-minute click path (if the price is older than five minutes, first publish `Healthy · 1.00` as **Valuer**): **Lender** create offer → **Borrower** sees it → **Outsider** sees nothing →
**Borrower** accepts → **Valuer** publishes 0.62 → **Lender** issues margin call → **Borrower** adds 50 units → repays and receives all locked collateral. "Reset demo" clears the demo ledger for another run.

### What the UI proves it is really on Canton

The UI surfaces the ledger's own evidence, so nothing has to be taken on trust:

- **Allocated parties** (Disclosure tab) — five user roles and a separate demo issuer are distinct Canton parties on one participant.
- **Secured Credit Facility panel** (Position tab) — shows the real contract ID and ledger offset behind the position.
- **Disclosure matrix** (Disclosure tab) — the signatory/observer declaration of every template, including the
  valuation records and the demo issuer, as a matrix. The active viewpoint's column is highlighted; the **Outsider**
  column is empty by construction.
- **Ledger activity** (Activity tab) — every action lists its committed transaction: `updateId`, ledger offset,
  synchronizer ID, and the contracts created/archived.
- **Raw ledger view** (Raw ledger tab, collapsible) — the exact JSON each party gets from the `active-contracts` query.
  Switching to **Outsider** makes the strongest point: the same panel is literally `[]`.
- **Holdings** (Holdings tab) — each party's own wallet (simulated cash + collateral). Holdings require issuer and owner signatures;
  the issuer sees the inventory, while the other counterparty does not see unspent wallet holdings. The demo flow settles on-ledger: the borrower starts with
  150 collateral + a 50-unit reserve + 105 cash, accepting locks 150 units and delivers 100 principal, and repaying returns the
  collateral while the lender ends with 105 (principal + 5 interest).

Strongest single demo moment: view the deal as **Lender**, open the **Raw ledger** tab and expand the raw ledger
view, then switch to **Outsider** — the same query returns nothing.

Both the web proxy and Canton Ledger API enforce role permissions. This remains
one participant with a trusted local signing key and privileged demo operator;
it is not enterprise SSO or privacy against the participant operator.

### UI architecture

The interface is a small design system rather than ad-hoc styling, so the look is consistent and retheming is
a one-file change:

- `src/theme/tokens.css` — every colour, space, radius and type step as a CSS custom property. This is the
  single source of truth; no component contains a literal hex value or magic pixel number.
- `src/theme/base.css` — resets, document typography, focus ring, scrollbars.
- `src/theme/components.css` — the class layer (`.v-panel`, `.v-hero`, `.v-matrix`, `.v-table`, `.v-tag`, …).
- `src/ui/primitives.tsx` — typed React wrappers over those classes (`Panel`, `Metric`, `Meter`, `Tag`,
  `Button`, `Segmented`, `Field`, `Banner`). Feature components compose primitives and never hand-roll styles.

**Visual register** — dark-first and crypto-native: a charcoal ground, Anton condensed caps for headings and
every figure, IBM Plex Mono for all interface text, square edges and hairline rules, on a broad 1680px shell.

**Colour discipline** — mint is the *only* decorative accent. Every other hue is semantic: status (offered /
active / settled / liquidated, margin call), LTV band (within limit / elevated / breach, relative to the
facility's own threshold), and party identity (the selected role fills the switcher with its own colour; sky
exists only to identify the valuer).

Machine identifiers (contract IDs, party IDs, update IDs) use `.v-id` — monospaced and deliberately **not**
uppercased, because an on-ledger value must render verbatim.

**Sections** — the page presents one thing at a time. Position (Valuation for the valuer), Disclosure,
Holdings, Activity and Raw ledger are tabs rather than a single scroll of stacked panels. Holdings and Activity
are not offered to the valuer or the outsider.

**Hero** — a statement band above the workspace. It carries no call to action: the originate form sits
directly below with its own submit.

**Theme** — dark is the default and the canonical look. The sun/moon control in the top right switches to a
light counterpart that keeps the same type, structure and accent. The OS preference is deliberately not
consulted. The choice is saved to `localStorage` only when the control is used, so an untouched session leaves
Web Storage empty (the role-auth browser check asserts this).

**Deep links** — the section is mirrored in the URL, so `?section=disclosure` opens on the disclosure matrix.
For the demo operator, the viewpoint is mirrored too (`?role=outsider`); every other session is fixed to the
party its token was issued for. Sign-out clears both parameters.

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
| Runtime | local authenticated `dpm sandbox` | Docker Compose LocalNet |
| Participants | one (privacy shown per-party on one node) | three (privacy across separate nodes) |
| Assets | demo `CashHolding` / `CollateralHolding` (on-ledger double-entry) | test Canton Coin / token standard |
| Auth | expiring role JWTs and Canton user rights | Keycloak OAuth2 / shared-secret |
| Extras | hand-rolled JSON Ledger API v2 client + Vercel `/v2` proxy | backend, PQS, wallet, Scan, observability |
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
│       ├── theme/         # design tokens, base layer, component classes, theme hook
│       ├── ui/            # typed primitives over the component classes
│       └── components/    # feature panels composed from primitives
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
