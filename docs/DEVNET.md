# Running Veil on the HackCanton DevNet node

Veil's hosted demo runs on the shared HackCanton DevNet participant operated by
NODERS (`hackcanton-01`, Ledger API 3.5). The browser never talks to Canton
directly: the Vercel functions in `api/` verify a Veil role session, check the
requested parties, and then submit to the node with the team's ledger-user token.

## Trust model on the shared node

The node gives each team **one ledger user**. The parties you create in the node
console are all granted `CanActAs`/`CanReadAs` to that user, so one node token can
act for every Veil party. Canton therefore cannot distinguish lender from borrower
here, and role separation on DevNet is enforced **only by Veil's server**:

- each role signs in to its own five-minute Veil session (see [AUTH.md](AUTH.md));
- the server allows a role to read only its own party and to submit only as its
  own party, exactly as in the local sandbox;
- only after those checks pass does the server replace the role token with the
  node token and the role subject with the team's ledger user ID.

In the local sandbox the role token itself is forwarded, so Canton re-checks the
role's user rights as a second layer. Two-layer enforcement on DevNet would need a
separate ledger user per role (separate platform accounts) or a dedicated node.
All six parties are hosted on the one participant, so the node operator can see
every contract; the privacy shown is between Veil parties, not against NODERS.

## 1. Create the parties and upload the DAR (node console)

Sign in at <https://console.participant.hackcanton-01.devnet.naas.noders.services/>
with "Sign in with Authfactory". The participant page shows your ledger user ID and
party namespace (the first segment of the user ID, e.g. `8e0db906-`).

1. Create six parties whose names end in `veil-issuer`, `veil-lender`,
   `veil-borrower`, `veil-regulator`, `veil-valuer` and `veil-outsider`
   (e.g. `8e0db906-veil-lender`). The console grants your user act-as and read-as.
2. Build the DAR with `dpm build` and upload `.daml/dist/veil-lite-0.6.0.dar` in the
   Collections tab. Re-uploads need a version bump in `daml.yaml`, and the
   participant checks upgrade compatibility for the same package name.

## 2. Obtain an offline refresh token (once)

The server needs a long-lived refresh token for your platform account; the
password is never stored. Run this in your own terminal (zsh), from the repo root:

```bash
mkdir -p .local/devnet && chmod 700 .local/devnet
read -r "EMAIL?Platform email: "; read -rs "PASS?Password: "; echo
curl -sS 'https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode 'client_id=web-app-ui-hackcanton-01-devnet' \
  --data-urlencode "username=$EMAIL" \
  --data-urlencode "password@-" <<<"$PASS" \
  --data-urlencode 'scope=openid daml_ledger_api offline_access' \
  -o .local/devnet/tokens.json
unset PASS; chmod 600 .local/devnet/tokens.json
jq '{expires_in, refresh_expires_in, scope, error}' .local/devnet/tokens.json
```

Expect `refresh_expires_in: 0` (an offline token that does not expire on its own)
and 3-hour access tokens. Refreshing issues a new refresh token but does not revoke
the old one, so a single value can live in a Vercel secret. `.local/` is gitignored;
never commit or paste the file. To revoke it, sign out all sessions of the platform
account.

## 3. Seed the demo state

```bash
dpm build
python3 scripts/bootstrap-devnet.py
```

The script refreshes an access token, finds the six parties among your user's
rights, confirms the DAR's package ID is on the participant, seeds the canonical
issuer-signed holdings and the jointly authorized valuation stream (skipping what
already exists), writes `frontend/public/ledger-config.json`, and prints the
non-secret settings for Vercel. It never prints tokens.

## 4. Run against DevNet locally (optional)

Vite serves the same `api/` handlers. Export the shared-node settings from
[VERCEL.md](VERCEL.md) (including `VEIL_UPSTREAM_REFRESH_TOKEN`,
`VEIL_AUTH_PRIVATE_KEY` from `.local/auth/private.pem`, and the passcodes) and run
`npm --prefix frontend run dev -- --host 127.0.0.1`. The sign-in page then offers
party + passcode sign-in.

## 5. Deploy

See [VERCEL.md](VERCEL.md) for the environment variables and smoke checks.

## Resetting

Sign in as **Demo operator** (operator passcode) and use **Reset demo**. Reset is a
series of ledger transactions submitted from the browser: keep the tab open until
the Reset button is enabled again, or the demo is left half-reset (rerun reset to
recover). `bootstrap-devnet.py` can also re-seed missing holdings.

## Troubleshooting

- `503` from `/v2/*` or `/api/session`: missing or invalid server configuration,
  or the refresh token was rejected. Re-run step 2 and update the Vercel secret.
- `403 PARTY_FORBIDDEN`: the role tried to read or act for another party; this is
  the server's role boundary working as intended.
- Ledger errors include a TID; look it up in the node's Grafana
  (<https://grafana.participant.hackcanton-01.devnet.naas.noders.services/>) or send
  it to the NODERS team with the party IDs and package name.
