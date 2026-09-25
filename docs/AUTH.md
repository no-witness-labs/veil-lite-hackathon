# Authenticated role access

Veil's local sandbox uses separate, expiring access tokens. The web server checks
each token and the requested parties, then forwards that same token to Canton.
Canton verifies the signature and enforces the user's ledger rights independently.
Changing a role label or forging an `actAs` field does not grant another party's
authority.

This is a local demo credential system. It is not enterprise SSO, independently
operated participants, or independent custody. The machine that holds the signing
key and the demo operator remain trusted.

## Roles

| Account | Read | Submit |
| --- | --- | --- |
| Lender | Lender-visible contracts | As lender only |
| Borrower | Borrower-visible contracts | As borrower only |
| Valuer | Valuer-visible contracts | As valuer only |
| Regulator | Regulator-visible contracts | None |
| Outsider | Outsider-visible contracts (empty in this demo) | None |
| Demo operator | All configured demo parties | As issuer, lender, borrower, and valuer for setup/reset |

Only the operator can supply the configured issuer's authority to mint the trusted
demo assets. Normal choices inherit signatory authority from existing contracts;
they do not require an issuer token. A party can create contracts under a different
issuer where Daml permits it; those are not the configured assets and the app
excludes them from its operational view.

The operator is deliberately privileged. Its role tabs inspect different parties'
views using one powerful credential. For an access-control demonstration, sign out
and sign in with each role's own token, or use separate browser windows.

## Sign in

1. Start the sandbox with `./scripts/start-sandbox.sh`, then start Vite with
   `npm --prefix frontend run dev`.
2. Obtain the required role's token from the local sandbox operator. Generated
   credentials live in the gitignored `.local/auth/` directory; do not publish
   them, paste them into issues, or include them in recordings.
3. Paste the token into Veil's sign-in form. The token stays in browser memory;
   refreshing the page requires another sign-in.
4. Use the operator account for **Reset demo**. Other accounts must sign out and
   authenticate again to change identity.

Use **Refresh** to load changes submitted by another signed-in user. On macOS,
the operator can copy one local token without printing it in the terminal:

```bash
node scripts/local-auth.mjs issue
node -p "require('./.local/auth/tokens.json').lender" | pbcopy
```

Replace `lender` with the required role. Paste into Veil immediately: tokens expire
after five minutes. Restart Vite after restarting Canton so the server loads the
new party IDs.

An expired or invalid token cannot access the ledger. Sign-out clears the local
view and credential; it does not revoke a copied bearer token. Tokens must be
distributed privately, and any non-loopback deployment needs HTTPS. Startup issues
fresh five-minute tokens using the existing local key, matching Canton's default
maximum lifetime. Issue fresh tokens immediately before a demo. To renew tokens without
resetting the ledger, run `node scripts/local-auth.mjs issue`. For a shared service, use a supported
identity provider and a credential revocation/rotation policy.

To invalidate all existing local tokens, stop Canton, run
`node scripts/local-auth.mjs rotate`, then restart Canton and Vite. The new key
must be loaded by both services; rotating a key while Canton is running is not
a supported renewal procedure.

## Server boundary

The server exposes only the three ledger operations used by the UI: ledger end,
active contracts, and command submission. Queries must name authorized parties;
commands must use the authenticated user ID and permitted `actAs`/`readAs` parties.
The server blocks unknown routes, ledger administration, and ordinary users'
direct create commands. Regulator and outsider cannot submit commands.

Missing authentication configuration fails closed.

On the shared HackCanton DevNet node the team has one ledger user for all parties.
There the server performs the same role checks and then submits with that user's
token instead of the role token, so the role boundary is enforced by the server
alone. See [DEVNET.md](DEVNET.md).

## Hosted passcode sign-in

A hosted deployment can set `VEIL_DEMO_PASSCODE` and a server-side signing key.
The sign-in page then offers a party picker: the server exchanges the passcode for
the same five-minute role token the local issuer produces, and every later request
goes through the checks above. The operator role needs a separate
`VEIL_OPERATOR_PASSCODE`; the judge passcode never grants it. Sessions expire after
five minutes; sign in again to continue. See [VERCEL.md](VERCEL.md).

Direct requests to Canton's JSON/gRPC Ledger API also require an authorized token.
The bootstrap administrator credential is separate from the operator and is not
accepted by the web app. Canton administration remains a local operator boundary;
do not expose its admin interface as a public service.

## Remaining boundaries

- One participant hosts all parties; these checks establish user access control,
  not privacy against the participant operator.
- On the shared DevNet node, Canton does not re-check the role: one ledger user can
  act for every party, and the server is the only role boundary. Anyone holding the
  demo passcode can sign in as any ordinary role.
- Assets and manually published valuations are still simulated/trusted inputs.
- Reset is privileged, cooperative demo cleanup. It is not a business cancellation
  workflow or proof of independent counterparty approval.
- Reset/seed and holding splits span multiple ledger transactions. Closing the
  browser or token expiry can interrupt them after some transactions commit.
  Sign in and refresh before retrying; the operator can rerun reset. Signing out
  is disabled while a mutation is in progress, but browser cancellation cannot
  undo a command Canton has already accepted.
- The checked-in Season 3 videos show the earlier 0.5 operator-tab interface.
  They are lifecycle evidence, not evidence of this authentication change.

## Verification

Validated locally on September 24, 2026: five server test cases, 47 live API and
lending-flow checks, and 12 browser checks passed. Production Daml and frontend
builds passed. The browser run finished by resetting the canonical demo holdings.
This is local verification; no hosted deployment or independent audit is claimed.

With Canton and Vite running and canonical demo holdings available:

```bash
node --test test/auth-server.test.mjs
npm --prefix frontend run build
node scripts/local-auth.mjs issue
node scripts/test-role-auth.mjs
```

The integration script checks both the web proxy and direct Canton JSON API,
then runs offer, acceptance, valuation, margin call, top-up, and repayment using
separate role tokens. It spends the initial holdings; use operator reset before
repeating it.

Both integration scripts issue fresh local tokens at startup so their five-minute
lifetime begins when the test actually runs.

`node scripts/test-role-browser.mjs` tests sign-in, fixed role views, operator
reset, the lending UI, expiry, reload, and delayed responses after sign-out. It
requires Playwright and Chromium. For an existing local installation, set
`VEIL_PLAYWRIGHT_MODULE` to its module path and optionally `VEIL_CHROME_PATH` to
the browser executable. This check resets the demo before and after execution.
Its screenshots and result are private local artifacts in `.local/auth/browser-check/`.
