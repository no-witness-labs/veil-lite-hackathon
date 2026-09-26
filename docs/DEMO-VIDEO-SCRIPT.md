# Veil — 3-minute demo video script (Season 3 submission)

Recorded on the live app, https://veil-lite-hackathon.vercel.app, against the
HackCanton DevNet node. Everything shown happens on-ledger; T-Bill/MMF units and
USDC are simulated, **Canton Coin is real DevNet CC**.

## Before recording (not on camera)

1. Sign in as **Demo operator** (operator passcode, team only) → **Reset demo**; wait
   until the Reset button is enabled again.
2. As **Valuer**: publish `Healthy · 1.00` on Tokenized T-Bill and `0.15` on Canton
   Coin, so both prices are fresh (they are usable for five minutes; re-publish if
   rehearsal pauses).
3. Record at 1440×900. Use the operator's role tabs to switch parties quickly; say once
   on camera that each party can also sign in on its own.
4. Close other tabs; zoom 100%; light or dark theme, but keep it the same throughout.

## Timed script (≈180 s)

| Time | Screen / clicks | Narration |
| --- | --- | --- |
| 0:00–0:15 | Sign-in page, then the Lender view | "Veil is private secured lending on Canton. A lender and a borrower who know each other agree a loan; only they — and a regulator — can see it. It runs live on the HackCanton DevNet node." |
| 0:15–0:35 | **Lender**: Originate facility → choose **Canton Coin (real)**, keep 100 principal, 5 interest, 1,000 CC, 90% threshold, 60 s call window → **Create offer** | "The lender funds the principal up front and chooses the terms. This time the collateral is real Canton Coin." |
| 0:35–0:55 | **Borrower** → **Accept offer**; show the Position panel: 1,000 CC, *Locked by the token standard itself…* | "When the borrower accepts, one transaction checks the loan-to-value on a fresh price, locks 1,000 CC and pays out the principal. The coin sits in a CIP-112 committed allocation: only the lender can settle or release it." |
| 0:55–1:10 | Terminal or pre-recorded clip: the early-withdraw attempt returning `cannot-withdraw-committed-allocation` | "If the borrower tries to pull the coin back early, Canton Coin itself refuses. The lock is enforced by the token standard, not by our code." |
| 1:10–1:30 | **Valuer** → Canton Coin → publish `0.11`; **Lender** → **Issue margin call** | "The valuer publishes a lower price. LTV breaches 90%, so the lender can call — and Canton starts a deadline." |
| 1:30–1:50 | **Borrower** → **Pay down** 30 → the call clears | "The borrower cures it with cash: 30 settles the interest and part of the principal, LTV drops back under the threshold and the call closes." |
| 1:50–2:05 | **Borrower** → **Repay 75** → Holdings: the CC is free again | "Repaying the rest cancels the allocation and the coin unlocks. Had the deadline passed, the lender could liquidate and the coin would settle to the lender instead." |
| 2:05–2:30 | **Regulator** (settlement visible, read-only) → **Valuer** (prices only) → **Outsider** → Raw ledger: `[]` | "The regulator sees the settlement. The valuer sees only its prices, never the loan. An outsider's ledger query returns nothing at all." |
| 2:30–2:50 | **Disclosure** tab | "This matrix is the privacy model: who signs and who observes every contract, straight from the Daml." |
| 2:50–3:00 | Back to Position / README | "Veil also handles top-ups, collateral substitution and maturity. Try it yourself — no sign-up needed." |

## Notes

- Keep the liquidation branch out of the 3 minutes, or record it separately: it needs
  the 60-second call deadline to pass.
- The early-withdraw clip: run the withdraw attempt against the borrower's allocation
  (see `docs/DEVNET.md`), or state it with the evidence line from PR #51 on screen.
- After recording, run **Reset demo** as operator so judges start clean.
