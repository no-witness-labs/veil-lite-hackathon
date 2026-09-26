# Veil Runbook

Operational guide for running the Veil demo (Canton ledger + React UI) and the
3-minute judge walkthrough. For the product framing see [`../README.md`](../README.md).

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| `dpm` | Daml SDK `3.5.1` | on `PATH` via `export PATH="$HOME/.dpm/bin:$PATH"` |
| **OpenJDK** | **17** (or 21) | **Not Oracle JDK 20** — see [Troubleshooting](#jce-cannot-authenticate-the-provider-bc) |
| Node.js | 18+ (tested on 22) | for the Vite frontend |

> **Why JDK 17 matters:** Canton 3.5 on Oracle JDK 20 fails JCE authentication of
> the bundled BouncyCastle provider, so every ledger transaction errors. The start
> script pins Homebrew OpenJDK 17 (`brew install openjdk@17`). Override the path with
> `VEIL_JAVA_HOME=/path/to/jdk` if yours lives elsewhere.

## 2. One-command start

Use this path for ongoing implementation and the on-ledger Canton proof. It needs no Seaport credentials or Vercel access. Keep DevNet settings out of `frontend/.env.local` in this checkout so Vite uses the local sandbox.

From the repo root:

```bash
# Builds the current DAR, starts Canton on JDK 17, uploads the DAR, allocates
# the five user roles plus demo issuer, and writes frontend/public/ledger-config.json.
./scripts/start-sandbox.sh
```

Then, in a second terminal, run the UI:

```bash
npm --prefix frontend install      # first time only
npm --prefix frontend run dev      # http://localhost:5173
```

Open <http://localhost:5173> and sign in with a role token from the gitignored
`.local/auth/` directory. See [AUTH.md](AUTH.md). Ordinary users cannot switch
roles; sign out and authenticate again to change identity. Only the operator can
use **Reset demo**. Its role tabs remain available for a narrated walkthrough.

## 3. DevNet and Vercel (deferred)

Locally the proxy forwards each user's verified role token unchanged, so Canton
re-checks it. The hosted deployment on the shared HackCanton DevNet node instead
submits with the team's ledger-user token after the same role checks; see
[AUTH.md](AUTH.md), [DEVNET.md](DEVNET.md) and [VERCEL.md](VERCEL.md).
No hosted ledger deployment is validated by this increment.

### Ports

| Port | Service |
| --- | --- |
| 6865 | Canton gRPC Ledger API |
| 6864 | Canton JSON Ledger API v2 |
| 5173 | Vite dev server (proxies `/v2` → 6864) |

### Logs

- Canton: `log/canton.log` (and `/tmp/veil-sandbox.log`)
- Start script: `/tmp/veil-start.log`
- Vite: terminal, or `/tmp/veil-vite.log` if backgrounded

## 4. What start-sandbox.sh does

1. Pins `JAVA_HOME` to OpenJDK 17 and builds the current DAR.
2. Launches `dpm sandbox` (single-process Canton) in the background.
3. Waits for `HTTP JSON API Server started`, then for `/readyz` = 200.
4. Runs `scripts/bootstrap.sh`, which is idempotent:
   - uploads `.daml/dist/veil-lite-0.8.0.dar`,
   - allocates `Lender` / `Borrower` / `Regulator` / `Valuer` / `Outsider` / `DemoIssuer` (reuses existing),
   - writes `frontend/public/ledger-config.json` (gitignored; the UI fetches it at runtime).
   - initializes the agreed valuation stream with price 1 using simulated lender/borrower/valuer consent.

To re-bootstrap against an already-running sandbox: `./scripts/bootstrap.sh`.

## 5. Demo walkthrough (~3 minutes)

For this narrated walkthrough, sign in as **operator** with a fresh token. The
tabs below change the operator's party view. For user-access isolation, use each
role's own token in separate browser sessions and click **Refresh** after another
user acts. Only operator can reset; ordinary users cannot switch tabs.

| Step | Role | Action | What to point at |
| --- | --- | --- | --- |
| 1 | **Lender** | Create offer (defaults: 100 / 5 / 150, LTV 66.7%) | Status `Offered`, real contract id + offset on the card |
| 2 | **Borrower** | (switch tab) | The offer is visible to the borrower |
| 3 | **Outsider** | (switch tab) | Empty state; open the **Raw ledger** tab, expand **Raw ledger view** → literally `[]` |
| 4 | **Borrower** | Accept offer | Status `Active`, collateral **LOCKED**; the **Activity** tab shows the tx |
| 5 | **Regulator** | (switch tab) | Full deal visible, read-only **Observer** badge |
| 6 | **Valuer** | Publish unit price 0.62 | Attested price is visible; private loan is absent |
| 7 | **Lender** | Issue margin call | Ledger deadline; liquidation is blocked before it |
| 8 | **Borrower** | Add 50 collateral units before deadline | 200 locked units, healthy LTV, call cleared |
| 9 | **Borrower** | Repay | Status `Repaid`, all 200 units **RELEASED** |
| — | operator | **Reset demo** | Clears the ledger for another run |

The maturity date means midnight at the start of that date in UTC. New offers and acceptance require a future maturity; the UI shows the enforced deadline. Past maturity, **Liquidate after maturity** is available without a price or margin call. Repayment remains available until the loan closes. This is separate from the margin-call liquidation path.

The first price is seeded at bootstrap. If it is more than five minutes old, switch to Valuer and publish a fresh price before creating an offer. Each publication archives the old price; old contract IDs are rejected even inside the freshness window. A publication racing another action can reject that action safely; refresh the role view and retry using the new current price.

Origination check: create an offer at price 1, publish 0.62 as Valuer before the borrower accepts, then switch to Borrower. Acceptance is blocked because LTV is above 90%; the offer and collateral remain intact. Publish a fresh price of 1 on the same stream and acceptance becomes available again. The create-offer preview uses the actual current mark rather than assuming one unit equals one dollar.

Funding check: creating an offer moves the lender's 100 demo cash into the issuer-signed offer reserve. Withdraw it to restore exactly 100, or accept it to deliver exactly 100 to the borrower. The same offer cannot do both. Issuance and reset use demo issuer authority explicitly; normal user actions do not. The issuer is a disclosed stakeholder in the loan and asset records.

**Strongest moment:** view the active deal as Lender, open the **Raw ledger** tab and expand **Raw ledger view**,
then switch to **Outsider** — the same query returns `[]`. The privacy is enforced
by Canton, not by the UI.

The **Activity** tab and the facility panel show the real `updateId`, ledger `offset`,
`synchronizerId`, and contract ids, so every action is verifiably on-ledger.

**Holdings / double-entry:** the **Holdings** tab shows each party's own wallet
(holdings are signed by the owner and demo issuer, so the issuer also sees them). The
borrower starts with 150 collateral + a 50-unit reserve + 105 cash and the lender with 100 cash; accepting
locks the collateral and delivers 100 principal to the borrower; repaying returns the
collateral and the lender ends with 105 (principal + 5 interest). "Reset demo" burns and
re-seeds the canonical holdings so the run is repeatable. For the alternative liquidation branch, issue a new call, leave it uncured through its 60-second deadline, and use a fresh breached valuation to liquidate. Browser timers are advisory; Canton enforces the deadline.

## 6. Stopping

```bash
pkill -f canton-open-source     # stop the Canton sandbox
pkill -f vite                   # stop the dev server
```

Sandbox state is in-memory, so a restart is always a clean ledger.

## 7. Verifying the build (CI-style)

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
(cd test && dpm build && dpm test)
npm --prefix frontend run build           # succeeds without a running sandbox
```

## 8. Troubleshooting

### Old package or multiple valuation streams
Version 0.5.0 requires a fresh environment and updated client; holdings and deal contracts now require an issuer. Restart the local sandbox and run bootstrap to generate the top-level `issuer` config. The UI rejects incomplete config and excludes other issuers from operational views. It also rejects an ambiguous price-stream selection rather than guessing which one counterparties agreed to.

### `JCE cannot authenticate the provider BC`
Canton is running on the wrong JDK (e.g. Oracle JDK 20). Use OpenJDK 17/21:
`brew install openjdk@17`, or set `VEIL_JAVA_HOME` and re-run `./scripts/start-sandbox.sh`.

### DAR upload returns HTTP 400 on startup
The JSON API logged "started" before the participant was fully ready. The start
script already waits for `/readyz`; if you run `bootstrap.sh` by hand, just re-run it.

### UI shows "Ledger not ready"
`ledger-config.json` is missing or invalid. For local sandbox mode, run
`./scripts/start-sandbox.sh` (or `./scripts/bootstrap.sh` if the sandbox is
already up), then reload the page. For DevNet/Vercel, verify the environment
variables in [`VERCEL.md`](./VERCEL.md), including `VEIL_PARTY_ISSUER` and the five role `VEIL_PARTY_*`
values.

### A role shows nothing / Outsider is empty
Expected. Each tab queries the ledger **as that party**; the Outsider is not a
stakeholder, so it sees nothing. That is the core privacy demonstration.

### Port already in use
A previous sandbox or dev server is still running:
`pkill -f canton-open-source` and/or `pkill -f vite`, then start again.

### Liquidate is disabled
Publish a fresh stressed valuation as Valuer, issue a margin call as Lender, and wait for its deadline. Liquidation requires that call to remain open and a fresh mark still showing a breach. Top-up or price recovery can resolve the call.

### `npm run dev` security note
A dev-server-only Vite advisory remains (deferred to avoid a breaking `vite@8`
bump). It does not affect production builds — run the dev server on a trusted
network only.
