# Vercel Deployment

Veil's Vercel deployment is a live Canton DevNet app.

## What Vercel serves

- `frontend/dist` for the Vite React app.
- `/v2/*` through `api/v2/[...path].js`, which forwards to the DevNet Ledger API
  and injects an OIDC bearer token server-side.
- `/ledger-config.json` through `api/ledger-config.js`, which returns the DevNet
  party map from environment variables.

## Project settings

Use the repository root as the Vercel project root. The checked-in `vercel.json`
sets:

```json
{
  "installCommand": "npm --prefix frontend ci",
  "buildCommand": "npm --prefix frontend run build",
  "outputDirectory": "frontend/dist"
}
```

## Required environment variables

Set these in Vercel for Production and Preview:

```bash
VEIL_LEDGER_TARGET=https://ledger-api.validator.devnet.sandbox.fivenorth.io
VEIL_OIDC_TOKEN_URL=https://auth.sandbox.fivenorth.io/application/o/token/
VEIL_OIDC_CLIENT_ID=validator-devnet-m2m
VEIL_OIDC_CLIENT_SECRET=<secret from Seaport access PDF>
VEIL_OIDC_AUDIENCE=validator-devnet-m2m
VEIL_OIDC_SCOPE=daml_ledger_api
VEIL_LEDGER_USER_ID=6
VEIL_PACKAGE_REF=#veil-lite
VEIL_PARTY_LENDER=veilLiteLender::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8
VEIL_PARTY_BORROWER=veilLiteBorrower::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8
VEIL_PARTY_REGULATOR=veilLiteRegulator::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8
VEIL_PARTY_OUTSIDER=veilLiteOutsider::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8
```

Do not use `VITE_` for secrets. Browser code only sees the public
`/ledger-config.json` response; token exchange happens in the serverless proxy.

## Smoke checks after deploy

Replace `<url>` with the Vercel deployment URL:

```bash
curl -i <url>/ledger-config.json
curl -i <url>/v2/state/ledger-end
```

Both should return `200`. Then open the app and run:

1. Lender creates an offer.
2. Borrower accepts.
3. Regulator observes.
4. Outsider sees an empty raw ledger response.
5. Borrower repays or lender liquidates.
