# Lender keeper

`scripts/keeper.mjs` is an off-ledger process that does what a lender's operations
desk would otherwise click in the UI. It reads the lender's open `Loan` and
`CoinLoan` contracts and the current `CollateralValuation` marks from the JSON
Ledger API v2, decides what to do, and (only with `--execute`) submits the
lender's choices. It is Node 22 ESM with no dependencies.

The decision logic is the pure `decide(loans, marks, now)` in
`scripts/keeper-lib.mjs`; `scripts/keeper.mjs` does the reads and writes.

## What it does each tick

For every active loan where the configured party is the lender:

| Situation | Action |
| --- | --- |
| No margin call, fresh mark, LTV >= threshold, before maturity | `IssueMarginCall` / `IssueCoinMarginCall` |
| Call open, deadline not passed | nothing (waits) |
| Call deadline passed, fresh mark, still breached | `Liquidate`, or for Canton Coin `PrepareCoinReceipt` → `LiquidateCoin` |
| Call deadline passed, price recovered | nothing (the borrower can resolve the call) |
| Ledger time past maturity | T-Bill: `LiquidateOverdue` with the fresh mark (0.9.0 returns surplus collateral at that price; without a fresh mark the keeper reports `needsFreshPrice`). Canton Coin: `PrepareCoinReceipt` → `LiquidateCoinOverdue` (no mark needed) |
| No mark, ambiguous marks, or a mark older than 300 s | nothing; logs `needsFreshPrice` |
| CoinLoan within `--warn-hours` of its allocation settlement deadline (maturity + 1 day) | warning on stdout and stderr: after that deadline the borrower can withdraw the locked coin |

The rules match `daml/Veil.daml`: a mark is usable only while
`observedAt <= now <= observedAt + 300s`; breach is
`outstandingPrincipal / (collateralQuantity * unitPrice) * 100 >= threshold`, with
`outstandingPrincipal = principal - max(0, amountRepaid - interest)`, computed in
exact Numeric-10 arithmetic. The keeper uses this host's clock as an estimate of
ledger time and keeps a `--skew-seconds` margin (default 5) on every time check,
so it waits slightly longer rather than submitting a command the ledger rejects.

The keeper is the lender, not the valuer: it never publishes prices. A stale mark
blocks margin-call and price-based liquidation until the valuer publishes.

Canton Coin liquidation fetches the allocation-factory choice context from the
token registry, submits `PrepareCoinReceipt` with its disclosed contracts, then
fetches the settlement-factory context and submits `LiquidateCoin` or
`LiquidateCoinOverdue`. If an earlier attempt already created a matching receipt
allocation, the keeper reuses it instead of creating another.

### Command journal

With `--execute`, every submission goes through a write-ahead journal in
`--state-dir` (default `.local/keeper/`, env `VEIL_KEEPER_STATE_DIR`):

- `journal.json`: one entry per operation key `<kind>:<loan contract id>`
  (kinds `issueMarginCall`, `liquidate`, `liquidateOverdue`, and `receipt` for
  the Canton Coin `PrepareCoinReceipt` step). Rewritten atomically (temp file,
  fsync, rename) under `journal.lock`, so a running keeper and the operator
  commands below can share it.
- `audit.log`: append-only JSON lines for every proposal, approval decision,
  submission, retry and outcome.

Before a command is sent the keeper records, durably, `status: pending` with
the command ID, a fresh `submissionId`, the ledger-end offset read just before,
`actAs` and the expected effect (which contract is archived, which template is
created). An operation key with any entry blocks a new submission except in the
retry cases below, so at most one command per operation is in flight, across
processes too.

Each submission ends in one of three outcomes:

| Outcome | When | Next |
| --- | --- | --- |
| `completed` | the ledger returned the transaction | done; never resubmitted |
| `rejected`, `transient` | the connection never opened, a gateway answered 429/503 without a ledger error, or the ledger answered synchronously with Canton category 1/2 (gRPC `UNAVAILABLE`, `ABORTED`, `RESOURCE_EXHAUSTED`) | retried automatically if still decided, after 30 s doubling to 15 min, at most 5 attempts, with the same command ID |
| `rejected`, `definitive` | everything else, including `CONTRACT_NOT_FOUND`, `DUPLICATE_COMMAND` and Daml assertion failures | not retried until `--retry` |
| `unknown` | the request may have reached the ledger without a definite answer: connection reset, timeout (`--submit-timeout-seconds`, default 60), a 5xx that is not a transient ledger error, gRPC `DEADLINE_EXCEEDED`, `definiteAnswer: false` | not resubmitted; reconciled |

Every execute tick first reconciles `unknown` entries (and `pending` ones older
than the submit timeout, left by a crash): it scans
`POST /v2/commands/completions` from the saved offset for the ledger user and
`actAs` parties, in pages of 200, at most 10 pages or 4 MB, and matches the
command and submission IDs. A found completion is recorded as `completed` (after
`/v2/updates/update-by-id` confirms the expected archive and create, `verified`)
or `rejected`. If the scan finds nothing or runs out of budget the entry stays
`unknown`, the operation is not resubmitted, and the tick reports it
(`indeterminate` events, `unknown` in the summary; `--once` exits 1).

`CONTRACT_NOT_FOUND`, `CONTRACT_NOT_ACTIVE`, `DUPLICATE_COMMAND`,
`LOCKED_CONTRACTS` and `ALREADY_EXISTS` are still logged as `superseded`. The
loan contract has moved on, so its operation key is not decided again.

### Maker-checker for liquidations

`--require-approval N` (env `VEIL_KEEPER_REQUIRE_APPROVAL`) makes the keeper
record a `proposed` entry for each decided `liquidate` / `liquidateOverdue`
instead of submitting it. The proposer is `--keeper-id` (env `VEIL_KEEPER_ID`,
default `keeper`). The keeper submits a proposal once it has N approvals, and
only if the liquidation is still decided from the live ACS on that tick. The mark
is re-read then, since the approved one has usually gone stale. If the loan is
active but no longer liquidatable, execution is refused (`executionRefused`). If
the loan contract is gone, the proposal becomes `stale`.

```bash
node scripts/keeper.mjs --approve <id> --by alice [--remarks "checked mark"]
node scripts/keeper.mjs --reject  <id> --by bob --remarks "borrower topping up"
node scripts/keeper.mjs --retry   <operationKey or id> [--by carol]
```

Operator commands read and write only the journal. They need no ledger access
or credentials. Each approver decides at most once, and the proposer cannot
decide at all. A rejection needs remarks and closes the proposal (`declined`).
`--retry` reopens a `rejected`, `unknown` or `declined` operation. The next
tick submits it again if it is still decided, or proposes it again when
approvals are required. Retrying an `unknown` operation reuses the command ID,
so within the participant's deduplication period a second effect is refused.

## Dry-run vs execute

Dry-run is the default: the keeper reads the ledger and prints one JSON line per
decision (`"event":"decision"`) plus a `"event":"tick"` summary, and submits
nothing. It does not call the registry or touch the journal in dry-run. Add
`--execute` to submit. Results appear as `submitted`, `superseded`, `error`,
`unknown`, `blocked` or `proposal` lines.

```text
--execute           submit decided actions
--once              one tick, then exit (0 ok, 1 errors or unknown outcomes, 2 bad config)
--state-dir DIR     journal and audit log (default .local/keeper)
--keeper-id NAME    proposer identity for maker-checker (default keeper)
--require-approval N  approvals needed before a liquidation is submitted (default 0 = off)
--submit-timeout-seconds N  after this the outcome is unknown (default 60)
--interval N        seconds between ticks when looping (default 30)
--skew-seconds N    clock-skew margin (default 5)
--warn-hours N      CoinLoan settlement-deadline warning window (default 6)
```

## Configuration

| Env var | Flag | Meaning |
| --- | --- | --- |
| `VEIL_LEDGER_TARGET` | `--ledger-url` | JSON Ledger API base URL (required) |
| `VEIL_PARTY_LENDER` | `--lender` | lender party to act as (required) |
| `VEIL_PARTY_VALUER` | `--valuer` | only trust marks from, and only handle loans priced by, this valuer |
| `VEIL_PARTY_ISSUER` | `--issuer` | only handle loans of this issuer |
| `VEIL_REGISTRY_URL` | `--registry-url` | token registry (needed to liquidate a `CoinLoan`) |
| `VEIL_LEDGER_USER_ID` | `--user-id` | ledger user; defaults to the token's `sub` |
| `VEIL_PACKAGE_REF` | `--package-ref` | default `#veil-lite` |

Credentials, first match wins (never printed):

1. `VEIL_KEEPER_BEARER`: a static access token.
2. `VEIL_KEEPER_BEARER_FILE`: a file with a token or an `Authorization: Bearer …`
   line, re-read every tick.
3. `VEIL_UPSTREAM_REFRESH_TOKEN` (or `.local/devnet/tokens.json`) exchanged at
   `VEIL_OIDC_TOKEN_URL` with `VEIL_OIDC_CLIENT_ID`, cached until a minute before
   expiry.

## Running against the local sandbox

With the sandbox running (`./scripts/start-sandbox.sh`), act as the `veil-lender`
ledger user. Local tokens last five minutes, so re-issue them for long runs.

```bash
node scripts/local-auth.mjs issue
VEIL_LEDGER_TARGET=http://127.0.0.1:6864 \
VEIL_PARTY_LENDER="$(jq -r .parties.lender frontend/public/ledger-config.json)" \
VEIL_PARTY_VALUER="$(jq -r .parties.valuer frontend/public/ledger-config.json)" \
VEIL_PARTY_ISSUER="$(jq -r .issuer frontend/public/ledger-config.json)" \
VEIL_KEEPER_BEARER_FILE=.local/auth/headers/lender.txt \
node scripts/keeper.mjs --once            # dry-run; add --execute to act
```

The sandbox has no token registry, so Canton Coin loans can be decided but not
liquidated locally.

## Running against DevNet

Use the non-secret values printed by `python3 scripts/bootstrap-devnet.py` (see
[DEVNET.md](DEVNET.md) and [VERCEL.md](VERCEL.md)) and the refresh token in
`.local/devnet/tokens.json`:

```bash
export VEIL_LEDGER_TARGET=https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services
export VEIL_OIDC_TOKEN_URL=https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token
export VEIL_OIDC_CLIENT_ID=web-app-ui-hackcanton-01-devnet
export VEIL_REGISTRY_URL=https://validator-api-http.validator.hackcanton-01.devnet.naas.noders.services/api/validator/v0/scan-proxy
export VEIL_PARTY_LENDER=... VEIL_PARTY_VALUER=... VEIL_PARTY_ISSUER=...
node scripts/keeper.mjs --once       # review the dry-run first
node scripts/keeper.mjs --execute --interval 30
```

## Trust note

The keeper acts with the lender's full authority: whatever credential it holds can
issue margin calls and seize collateral. Run it only where the lender's own
credentials may live. On the shared DevNet node it uses the team's single ledger
user, which can act for every Veil party; the keeper restricts itself to
`actAs = [lender]`, but that restriction is in this script, not in Canton. Locally
it uses the `veil-lender` user, whose rights Canton does enforce.

Status: covered by unit tests with a mocked `fetch` and a scripted fake ledger
(`node --test test/keeper.test.mjs`). It has not yet run against a live ledger or
the DevNet registry. The completions and update-by-id request and response shapes
follow the Canton 3.5 JSON Ledger API OpenAPI (`release-line-3.5`) and have not
been checked live.
