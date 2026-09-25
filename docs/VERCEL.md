# Vercel deployment

The hosted app serves the Vite build from `frontend/dist` and the serverless
functions in `api/`:

- `/api/demo-login` exchanges the demo passcode for a five-minute role token;
- `/api/session` verifies a role token;
- `/v2/*` checks the role's parties and forwards to the HackCanton DevNet node
  with the team's ledger-user token (see [DEVNET.md](DEVNET.md) for the trust model);
- `/ledger-config.json` returns the public party map from environment variables.

Use the repository root as the project root; `vercel.json` sets the install, build,
output and rewrites.

## Environment variables

Set these for Production (and Preview if previews should reach DevNet). Party IDs
and URLs are printed by `python3 scripts/bootstrap-devnet.py`.

| Variable | Secret | Value |
| --- | --- | --- |
| `VEIL_LEDGER_TARGET` | no | `https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services` |
| `VEIL_OIDC_TOKEN_URL` | no | `https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token` |
| `VEIL_OIDC_CLIENT_ID` | no | `web-app-ui-hackcanton-01-devnet` |
| `VEIL_LEDGER_USER_ID` | no | your ledger user ID (JWT subject) |
| `VEIL_UPSTREAM_REFRESH_TOKEN` | **yes** | `refresh_token` from `.local/devnet/tokens.json` |
| `VEIL_PACKAGE_REF` | no | `#veil-lite` |
| `VEIL_PARTY_ISSUER`, `_LENDER`, `_BORROWER`, `_REGULATOR`, `_VALUER`, `_OUTSIDER` | no | full party IDs |
| `VEIL_AUTH_PRIVATE_KEY` | **yes** | PEM that signs hosted role tokens |
| `VEIL_AUTH_PUBLIC_KEY` | no | matching public PEM |
| `VEIL_AUTH_AUDIENCE` | no | `veil-local` |
| `VEIL_DEMO_PASSCODE` | **yes** | judge passcode, at least 12 characters |
| `VEIL_OPERATOR_PASSCODE` | **yes** | different operator passcode, at least 12 characters; omit to hide the operator |

Generate a dedicated RSA key pair for the hosted app rather than reusing the local
sandbox key, for example:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out .local/devnet/hosted-private.pem
openssl pkey -in .local/devnet/hosted-private.pem -pubout -out .local/devnet/hosted-public.pem
```

Passcode sign-in is disabled unless both `VEIL_DEMO_PASSCODE` (12+ characters) and
`VEIL_AUTH_PRIVATE_KEY` are set. Failed attempts are delayed but not rate limited
across function instances, so use long random passcodes. Never use `VITE_`
variables for secrets.

## Smoke checks after deploy

```bash
curl -s <url>/api/demo-login          # {"enabled":true,"operator":true}
curl -s <url>/ledger-config.json      # party map
curl -si <url>/v2/state/ledger-end    # 401 without a session
```

Then sign in with the passcode and run the demo: lender offer → borrower accept →
valuer stress price → lender margin call → borrower top-up and repay → regulator
sees the settlement → outsider's raw ledger is `[]`.
