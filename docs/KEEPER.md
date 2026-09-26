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
| Ledger time past maturity | `LiquidateOverdue` / `PrepareCoinReceipt` → `LiquidateCoinOverdue` (no mark needed) |
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

### Safety on retries

- State is re-read from the ledger at the start of every tick.
- Command IDs are derived from the action and the loan's contract ID, so a
  command that landed but whose response was lost is deduplicated by the
  participant.
- `CONTRACT_NOT_FOUND`, `CONTRACT_NOT_ACTIVE`, `DUPLICATE_COMMAND`,
  `LOCKED_CONTRACTS` and `ALREADY_EXISTS` are logged as `superseded` (someone
  else moved the loan first) and retried from fresh state next tick. Any other
  failure is logged as `error`; with `--once` the exit code is then 1.

## Dry-run vs execute

Dry-run is the default: the keeper reads the ledger and prints one JSON line per
decision (`"event":"decision"`) plus a `"event":"tick"` summary, and submits
nothing. It does not call the registry in dry-run. Add `--execute` to submit;
results appear as `submitted`, `superseded` or `error` lines.

```text
--execute           submit decided actions
--once              one tick, then exit (0 ok, 1 errors, 2 bad config)
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

Status: covered by unit tests with a mocked `fetch` (`node --test test/keeper.test.mjs`);
not yet exercised against a live ledger or the DevNet registry.
