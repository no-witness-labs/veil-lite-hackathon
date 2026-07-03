# Running Veil Lite on Canton DevNet

Run Veil against the shared Seaport / Five North Canton DevNet instead of the
local sandbox. The contracts and UI are the same; DevNet adds OIDC auth, a
remote participant, persistent parties, and a server-side proxy for the browser.

This follows the same pattern as the CloakRFQ DevNet guide:
<https://github.com/no-witness-labs/canton-hackathon-cloakRFQ/blob/main/docs/DEVNET.md>.

## Prerequisites

- Daml `dpm`, Node.js, and this repo checked out locally.
- Seaport validator access credentials from the PDF:
  - Ledger API: `https://ledger-api.validator.devnet.sandbox.fivenorth.io`
  - Token URL: `https://auth.sandbox.fivenorth.io/application/o/token/`
  - Client ID: `validator-devnet-m2m`
  - Client secret: keep this local; never commit it.
- The `veil-lite-0.1.0.dar` package deployed/vetted on the validator.

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

## 2. Build the DAR

```bash
export PATH="$HOME/.dpm/bin:$PATH"
dpm build
```

The deployable DAR is:

```text
.daml/dist/veil-lite-0.1.0.dar
```

Package/template references use:

```text
#veil-lite:Veil:LoanOffer
#veil-lite:Veil:Loan
```

## 3. Bootstrap DevNet

```bash
set -a; . frontend/.env.local; set +a
python3 scripts/bootstrap-devnet.py
```

The script:

1. Exchanges the OIDC client credentials for a bearer token.
2. Uploads the DAR if needed.
3. Allocates the four demo parties:
   `veilLiteLender`, `veilLiteBorrower`, `veilLiteRegulator`, `veilLiteOutsider`.
4. Grants `CanActAs` for those parties to `VEIL_LEDGER_USER_ID` (default: `6`).
5. Seeds the canonical holdings: lender 100 cash, borrower 105 cash + 150 collateral.
6. Writes `frontend/public/ledger-config.json`.

DevNet is persistent. To get fresh parties for another clean run, pass a suffix:

```bash
python3 scripts/bootstrap-devnet.py run2
```

That writes a new `ledger-config.json` using suffixed party hints like
`veilLiteLender-run2`.

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
- Do not upload `veil-0.1.0.dar`; that package name collides with an existing
  DevNet package. Use `veil-lite-0.1.0.dar`.
