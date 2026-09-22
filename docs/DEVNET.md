# Running Veil Lite on Canton DevNet

Run Veil against the shared Seaport / Five North Canton DevNet instead of the
local sandbox. The contracts and UI are the same; DevNet adds OIDC auth, a
remote participant, persistent parties, and a server-side proxy for the browser.

Season 3 package 0.3.0 requires a fresh local or DevNet environment. Use fresh suffixed parties for any future DevNet validation; this change does not migrate prior loans or deploy the new application. The proxy is a shared demo operator, not independent end-user authentication.

Deployment check on September 22, 2026: the public app's `/ledger-config.json` reports missing `VEIL_PARTY_VALUER`, and `/v2/state/ledger-end` reports an OIDC `invalid_grant`. The Season 3 DevNet workflow is not validated. Restore working credentials, bootstrap fresh parties, then update all five Vercel party variables before redeploying and testing the app.

This follows the same pattern as the CloakRFQ DevNet guide:
<https://github.com/no-witness-labs/canton-hackathon-cloakRFQ/blob/main/docs/DEVNET.md>.

## Prerequisites

- Daml `dpm`, Node.js, and this repo checked out locally.
- Seaport validator access credentials from the PDF:
  - Ledger API: `https://ledger-api.validator.devnet.sandbox.fivenorth.io`
  - Token URL: `https://auth.sandbox.fivenorth.io/application/o/token/`
  - Client ID: `validator-devnet-m2m`
  - Client secret: keep this local; never commit it.
- The `veil-lite-0.3.0.dar` package deployed/vetted on the validator for a new test environment.

## 1. Configure DevNet credentials

```bash
cp frontend/.env.local.example frontend/.env.local
```

Edit `frontend/.env.local` and set:

```bash
VEIL_OIDC_CLIENT_SECRET=<the shared secret from the Seaport access PDF>
```

`frontend/.env.local` is gitignored. These variables do not use the `VITE_`
prefix, so Vite keeps them server-side in the `/v2` proxy middleware.

For a short manual test you can also export `VEIL_DEVNET_ACCESS_TOKEN` instead
of the OIDC client secret. Prefer the client-credentials setup above for normal
runs because the proxy can refresh the token automatically.

Before uploading a package or allocating parties, check authentication and a ledger read:

```bash
set -a; . frontend/.env.local; set +a
python3 scripts/bootstrap-devnet.py --check
```

This mode needs no built DAR, performs no bootstrap writes, and prints no access token. Success proves token issuance and ledger-end access; it does not prove upload, party-allocation, or command-submission privileges. On token rejection, it reports the server's request ID for the validator operator.

The September 22 follow-up verified that both secret copies in the access PDF match the local configuration. The request's client ID, audience and scope also match the PDF. Seaport's [OIDC discovery document](https://auth.sandbox.fivenorth.io/application/o/validator-devnet-m2m/.well-known/openid-configuration) advertises `client_credentials`, `daml_ledger_api`, and both `client_secret_post` and `client_secret_basic`; both authentication methods returned HTTP 400 `invalid_grant` with the supplied credentials. This does not establish whether the cause is credential state, service-account state, or another provider setting. The operator can find the detailed cause by request ID in [authentik's server logs](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/machine_to_machine#more-detailed-error-information).

## 2. Build the DAR

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
```

The deployable DAR is:

```text
.daml/dist/veil-lite-0.3.0.dar
```

Package/template references use:

```text
#veil-lite:Veil:LoanOffer
#veil-lite:Veil:Loan
```

## 3. Bootstrap DevNet

```bash
set -a; . frontend/.env.local; set +a
python3 scripts/bootstrap-devnet.py season3-20260922
```

The script:

1. Exchanges the OIDC client credentials for a bearer token.
2. Uploads the DAR and stops on any upload failure before allocating parties.
3. Allocates five demo parties:
   `veilLiteLender`, `veilLiteBorrower`, `veilLiteRegulator`, `veilLiteValuer`, `veilLiteOutsider` (with the chosen suffix).
4. Verifies allocation returned five distinct party IDs on the same participant, then grants `CanActAs` to `VEIL_LEDGER_USER_ID` (default: `6`). Failed allocation stops the run; the script never constructs an assumed party ID.
5. Queries each party after rights are granted and stops if any already has active contracts.
6. Seeds the canonical holdings: lender 100 cash, borrower 105 cash + 150 collateral + a separate 50-unit reserve.
7. Initializes one jointly authorized valuation stream and price 1. The demo operator supplies lender, borrower, and valuer authority in one transaction; independent signing is not implemented.
8. Writes `frontend/public/ledger-config.json` only after successful seeding.

DevNet is persistent. A suffix is required: 1–64 letters, digits, underscores or hyphens. Use a new suffix for every run, including after a partially completed bootstrap:

```bash
python3 scripts/bootstrap-devnet.py run2
```

That writes a new `ledger-config.json` using suffixed party hints like
`veilLiteLender-run2`.

Allocation, rights and seeding are separate transactions. A failure can leave allocated parties or partial demo holdings behind; the script does not erase them or resume that run. Use a new suffix after fixing the error. Repeated runs must not be used to reset an existing loan.

## 4. Run the app

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Open the printed local URL, usually <http://localhost:5173>.

The browser calls `/v2/*` same-origin. Vite middleware forwards those requests to
the DevNet Ledger API and injects a cached OIDC bearer token. The client secret
stays on the local dev server and never reaches the browser.

## 5. Deploy to Vercel

This repo includes `vercel.json` plus serverless functions:

- `/api/v2/[...path].js` proxies `/v2/*` to the DevNet Ledger API and injects a
  refreshed bearer token server-side.
- `/api/ledger-config.js` serves `/ledger-config.json` from Vercel environment
  variables.

Set these Vercel environment variables for Production and Preview:

```bash
VEIL_LEDGER_TARGET=https://ledger-api.validator.devnet.sandbox.fivenorth.io
VEIL_OIDC_TOKEN_URL=https://auth.sandbox.fivenorth.io/application/o/token/
VEIL_OIDC_CLIENT_ID=validator-devnet-m2m
VEIL_OIDC_CLIENT_SECRET=<the shared secret from the Seaport access PDF>
VEIL_OIDC_AUDIENCE=validator-devnet-m2m
VEIL_OIDC_SCOPE=daml_ledger_api
VEIL_LEDGER_USER_ID=6
VEIL_PACKAGE_REF=#veil-lite
VEIL_PARTY_LENDER=veilLiteLender::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8
VEIL_PARTY_BORROWER=veilLiteBorrower::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8
VEIL_PARTY_REGULATOR=veilLiteRegulator::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8
VEIL_PARTY_VALUER=<newly allocated valuer party id>
VEIL_PARTY_OUTSIDER=veilLiteOutsider::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8
```

Vercel should use the repo root as the project root. `vercel.json` runs:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
```

and serves `frontend/dist`.

## Local vs DevNet

| Mode | How | Notes |
| --- | --- | --- |
| DevNet | `frontend/.env.local` present + `scripts/bootstrap-devnet.py` | Real remote Canton participant with auth. |
| Local sandbox | Remove/rename `frontend/.env.local`, run `./scripts/start-sandbox.sh` | Auth-disabled local sandbox; true wipe on restart. |

## Resetting

- DevNet: run `python3 scripts/bootstrap-devnet.py <newtag>` and reload. The
  ledger is persistent, so this creates a fresh party set instead of wiping.
- Local: `./scripts/stop-sandbox.sh && ./scripts/start-sandbox.sh`.

## Troubleshooting

- `OIDC token exchange failed`: verify the token URL keeps the trailing slash:
  `https://auth.sandbox.fivenorth.io/application/o/token/`.
- `PERMISSION_DENIED` or failed command submission: verify `VEIL_LEDGER_USER_ID`
  matches the Daml user mapped to the token. The shared validator setup used by
  the reference guide defaults to `6`.
- No visible holdings: rerun `python3 scripts/bootstrap-devnet.py <newtag>` and
  hard-refresh the app so it uses the new generated config.
- Missing `VEIL_PARTY_VALUER`: bootstrap a fresh five-party environment, set all five `VEIL_PARTY_*` values in Vercel from the generated config, and redeploy. Do not substitute the lender or borrower for the valuer.
- OIDC `invalid_grant`: send the reported request ID to the Seaport operator for server-side diagnosis, confirm working credentials, and rerun `--check` before allocating parties or changing the deployed party configuration.
- DAR upload failure: the script stops without allocating parties. Resolve package/permission errors with the validator operator; it no longer assumes that an older package is usable.
- Do not upload `veil-0.1.0.dar`; that package name collides with an existing
  DevNet package. Use `veil-lite-0.3.0.dar` for this branch.

Bootstrap failure-path tests run locally without credentials or network access:

```bash
python3 -m unittest discover -s test -p 'test_*.py' -v
```
