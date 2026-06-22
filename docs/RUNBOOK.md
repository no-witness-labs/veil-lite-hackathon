# Veil Runbook

Operational guide for running the Veil demo (Canton sandbox + React UI) and the
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

From the repo root:

```bash
# Builds the DAR if needed, starts Canton on JDK 17, uploads the DAR, allocates
# the four demo parties, and writes frontend/public/ledger-config.json.
./scripts/start-sandbox.sh
```

Then, in a second terminal, run the UI:

```bash
npm --prefix frontend install      # first time only
npm --prefix frontend run dev      # http://localhost:5173
```

Open <http://localhost:5173>.

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

## 3. What start-sandbox.sh does

1. Pins `JAVA_HOME` to OpenJDK 17 and builds the DAR if missing.
2. Launches `dpm sandbox` (single-process Canton) in the background.
3. Waits for `HTTP JSON API Server started`, then for `/readyz` = 200.
4. Runs `scripts/bootstrap.sh`, which is idempotent:
   - uploads `.daml/dist/veil-0.1.0.dar`,
   - allocates `Lender` / `Borrower` / `Regulator` / `Outsider` (reuses existing),
   - writes `frontend/public/ledger-config.json` (gitignored; the UI fetches it at runtime).

To re-bootstrap against an already-running sandbox: `./scripts/bootstrap.sh`.

## 4. Demo walkthrough (~3 minutes)

| Step | Role | Action | What to point at |
| --- | --- | --- | --- |
| 1 | **Lender** | Create offer (defaults: 100 / 5 / 150, LTV 66.7%) | Status `Offered`, real contract id + offset on the card |
| 2 | **Borrower** | (switch tab) | The offer is visible to the borrower |
| 3 | **Outsider** | (switch tab) | Empty state; expand **Raw ledger view** → literally `[]` |
| 4 | **Borrower** | Accept offer | Status `Active`, collateral **LOCKED**; activity feed shows the tx |
| 5 | **Regulator** | (switch tab) | Full deal visible, read-only "Observer — cannot act" badge |
| 6 | **Borrower** | Repay | Status `Repaid`, collateral **RELEASED** |
| 7 | *(optional)* **Lender** | Simulate price drop → Liquidate | Breach banner; on-ledger guard permits liquidation |
| — | any | **Reset demo** | Clears the ledger for another run |

**Strongest moment:** view the active deal as Lender, expand **Raw ledger view**,
then switch to **Outsider** — the same query returns `[]`. The privacy is enforced
by Canton, not by the UI.

The activity feed and the deal card show the real `updateId`, ledger `offset`,
`synchronizerId`, and contract ids, so every action is verifiably on-ledger.

## 5. Stopping

```bash
pkill -f canton-open-source     # stop the Canton sandbox
pkill -f vite                   # stop the dev server
```

Sandbox state is in-memory, so a restart is always a clean ledger.

## 6. Verifying the build (CI-style)

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
(cd test && dpm build && dpm test)        # 3 Daml Script tests
npm --prefix frontend run build           # succeeds without a running sandbox
```

## 7. Troubleshooting

### `JCE cannot authenticate the provider BC`
Canton is running on the wrong JDK (e.g. Oracle JDK 20). Use OpenJDK 17/21:
`brew install openjdk@17`, or set `VEIL_JAVA_HOME` and re-run `./scripts/start-sandbox.sh`.

### DAR upload returns HTTP 400 on startup
The JSON API logged "started" before the participant was fully ready. The start
script already waits for `/readyz`; if you run `bootstrap.sh` by hand, just re-run it.

### UI shows "Sandbox not ready"
`frontend/public/ledger-config.json` is missing — the sandbox hasn't been
bootstrapped. Run `./scripts/start-sandbox.sh` (or `./scripts/bootstrap.sh` if the
sandbox is already up), then reload the page.

### A role shows nothing / Outsider is empty
Expected. Each tab queries the ledger **as that party**; the Outsider is not a
stakeholder, so it sees nothing. That is the core privacy demonstration.

### Port already in use
A previous sandbox or dev server is still running:
`pkill -f canton-open-source` and/or `pkill -f vite`, then start again.

### Liquidate is disabled
Liquidation is only permitted when LTV breaches the threshold. Click **Simulate
price drop** first; the ledger rejects liquidation on a healthy loan.

### `npm run dev` security note
A dev-server-only Vite advisory remains (deferred to avoid a breaking `vite@8`
bump). It does not affect production builds — run the dev server on a trusted
network only.
