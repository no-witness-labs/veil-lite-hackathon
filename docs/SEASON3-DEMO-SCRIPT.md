# Season 3 — repeatable three-minute demo

This script is the short, repeatable local walkthrough for the 0.5.0 release. It
uses a fresh Canton sandbox and the current frontend. It does not use DevNet,
Seaport, a hosted deployment, or `frontend/.env.local`.

Recorded examples: [main walkthrough](veil-season3-demo.mp4) and
[unsafe acceptance](veil-season3-unsafe-acceptance.mp4). See the
[recording notes and captured ledger evidence](SEASON3-RECORDINGS.md) for scope,
subtitles, and provenance. The rejection recording begins after fresh setup and
offer funding so that the one-minute clip focuses on the failed acceptance.

## Preflight (outside the three-minute stopwatch)

1. Start from a clean 0.5.0 sandbox. Ensure `frontend/.env.local` and any other
   local Vite environment overrides are absent, or move them aside before
   starting Vite. In particular, an existing `VEIL_LEDGER_TARGET` can silently
   select the DevNet proxy; do not use it for this local walkthrough.
   If another Canton or Vite process is using
   the ports, stop it and start again so that old contracts are not carried into
   the run:

   ```bash
   # Terminal 1: keep the sandbox running.
   ./scripts/start-sandbox.sh

   # Terminal 2:
   npm --prefix frontend install       # first run only
   npm --prefix frontend run dev
   ```

   Open <http://localhost:5173>. The start script builds the DAR, allocates the
   five role parties plus `DemoIssuer`, writes
   `frontend/public/ledger-config.json`, and seeds the stream at 1.00 plus the
   canonical holdings. Do not create a DevNet `.env.local` for this walkthrough.

2. Confirm the header says `Canton · Demo`, the party strip includes `Demo
   issuer`, and the active role is `Lender`. The local sandbox has authentication
   disabled; this is one demo operator switching between the configured role
   credentials, not five independently authenticated users.

3. Start the stopwatch only after the page has loaded. The single reset at
   0:00 in the table below is part of the timed demo. Reset is cooperative demo
   cleanup and reseeding, not a business
   cancellation. It uses all required role/issuer authorities.

## Timed narration and clicks (180 seconds)

The times are targets, including normal ledger latency. The main path never
waits for the 60-second margin-call deadline.

| Time | Role and clicks | Narration and evidence |
| --- | --- | --- |
| 0:00–0:20 | **Lender**. Click `Reset demo`; wait for `Create offer`. | “This is a fresh local Canton run. The lender has 100 simulated USDC; the borrower has 150 collateral units, a separate 50-unit reserve, and 105 simulated USDC. The initial ledger mark is 1.00.” Point to `Demo issuer` in the party strip and say it is the trusted simulated-asset issuer. |
| 0:20–0:42 | **Lender**. Leave the defaults in `Create offer`: principal `100`, interest `5`, collateral `150`; keep the future maturity date. Click `Create offer`. | “The lender funds the offer. At 1.00, 150 units are worth 150 and principal-only LTV is 66.7%, below the 90% threshold. The card changes to `Offered`, shows `Funded principal`, and says `Reserved in issuer-signed offer escrow`.” Point to the real contract ID and offset on the card. |
| 0:42–0:58 | Click the `Borrower` tab, then `Accept offer`. | “The borrower accepts against the exact current valuation stream. Canton consumes the offer, locks exactly 150 units (`LOCKED`), and delivers exactly 100 simulated USDC. The 50-unit reserve remains separate.” Wait for the card to show `Active`. |
| 0:58–1:08 | Click `Outsider`; expand `Raw ledger view`. | “An outsider is not a stakeholder.” Point to `Not a stakeholder.`, the `0 contracts` badge, and the literal `[]` response. This is a party-scoped Canton query, not a hidden UI element. |
| 1:08–1:24 | Click `Valuer`; click `Stress · 0.62`, then `Publish mark`. | “The valuer signs a manually attested stress mark. This is demo data, not a live oracle. The valuer sees the signed mark and history, but not the loan.” Wait for `Latest visible mark` to read `0.62 simulated USDC/unit`. |
| 1:24–1:36 | Click `Lender`; click `Issue margin call`. | “At 0.62, 150 locked units are worth 93 and LTV is about 107.5%, so the lender can open a margin call. The ledger records a 60-second deadline; the UI says `Margin call open` and `Liquidation unlocks when the margin-call deadline passes`.” |
| 1:36–1:56 | Click `Borrower`; click `Top up 50 units` before the deadline. | “The borrower cures the call with the exact 50-unit reserve. Canton consumes that holding, replaces the loan with 200 locked units, clears the call, and shows healthy LTV of about 80.6%. We do not wait for the deadline in the main demo.” |
| 1:56–2:12 | Click `Repay 105 simulated USDC`. | “The borrower repays principal plus interest exactly: 100 plus 5. The loan closes as `Repaid`; all 200 collateral units show `RELEASED`, and the lender receives 105.” Wait for the closed card and holdings to refresh. |
| 2:12–2:34 | Click `Regulator`; point to the closed deal and `Observer — cannot act`. | “The regulator can inspect the resulting settlement but has no action button. The valuer still has only the valuation record. The configured issuer is a stakeholder in holdings and loan lifecycle records so it can authorize the simulated inventory and see those records.” |
| 2:34–3:00 | Click `Lender`; expand `Raw ledger view`; scroll the activity feed. | “The proof is on-ledger: show opaque contract IDs, the `offset`, each transaction’s `tx` update ID, `sync` synchronizer ID, and created/archived IDs. The UI selects the configured issuer for operational deal views, while this raw response remains the unabridged party query.” Stop at 3:00. |

The final state to call out is `Repaid`, 200 units returned to the borrower, and
105 simulated USDC paid to the lender. Do not claim an external settlement,
oracle observation, or independent privacy review.

## Rehearsal checklist and recovery

- Reset before every rehearsal. The reset archives active offers/loans and
  closes/clears the current valuation records before reseeding; it is an
  operator-only cooperative cleanup. A fresh mark must be no more than 300
  seconds old at each create, accept, margin-call, top-up, recovery, or
  price-triggered margin liquidation action. Overdue maturity liquidation
  deliberately requires no valuation.
  If rehearsal pauses for five minutes, switch to `Valuer`, publish `Healthy ·
  1.00` (or the intended stress mark) with `Publish mark`, then switch back to
  the acting role.
- Switching role tabs clears the old snapshot and queries Canton again. If a
  card or holdings panel looks stale, switch to another role and back, wait for
  the refresh, and use the new contract ID. A consumed offer, valuation, or loan
  ID must never be reused. Treat an error banner as a ledger rejection; do not
  narrate a success until the status, offset, and activity entry change.
- If the top-up window is accidentally missed, do not claim it succeeded. Click
  `Reset demo` and restart the timed path, or use the alternate liquidation
  branch below. If the ledger is not ready, restart the fresh sandbox and rerun
  the start script rather than mixing old state into the run.
- Historical deployment/video/pitch artifacts describe earlier versions. They
  are useful context, not evidence for this 0.5.0 local run.

## Optional branches

### Funded offer withdrawal

After `Create offer` and before acceptance, stay on `Lender` and click
`Withdraw offer`. The offer is consumed and exactly 100 simulated USDC returns to
the lender. A second withdrawal must fail because the offer contract no longer
exists. Reset before returning to the main path.

### Stale or stressed origination

To show the freshness and origination guard, create an offer only while the
mark is fresh, then switch to `Valuer`, publish `Stress · 0.62`, and switch to
`Borrower`. `Accept offer` is unavailable because LTV is about 107.5%; the
offer, collateral, and principal remain intact. Publish a fresh `Healthy ·
1.00` on the same stream and refresh the borrower view; acceptance becomes
available again. A stale mark is labeled `stale — publish a fresh mark` and the
relevant action is disabled. Publishing consumes the predecessor, so an old
valuation contract ID cannot be used after replacement.

### Deadline liquidation (not part of the 180-second path)

For the failure branch, reset, create and accept the offer, publish 0.62, and
issue a margin call. Leave it open for at least 60 seconds, publish a fresh
breached 0.62 mark if needed, then as `Lender` click `Liquidate collateral`.
The lender receives the currently locked collateral and the closed record says
`Liquidated`. This branch is deliberately slower; it is not a reason to wait
for the deadline during the primary presentation.
