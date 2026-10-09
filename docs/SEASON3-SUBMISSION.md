# Veil — HackCanton Season 3 submission notes

**Track:** 2 — Financial Applications
**Live app:** https://veil-lite-hackathon.vercel.app (DevNet, open access: pick a party and click **Enter**, or **Just look around** for a read-only view)
**Repository:** https://github.com/no-witness-labs/veil-lite-hackathon
**Deck:** [`docs/SUBMISSION-DECK.pdf`](SUBMISSION-DECK.pdf)
**Video:** https://youtu.be/-WDBjhal_3U (2:32, Canton Coin loan on DevNet; file [`docs/veil-season3-cc-demo.mp4`](veil-season3-cc-demo.mp4), see [`SEASON3-RECORDINGS.md`](SEASON3-RECORDINGS.md))
**LocalNet videos:** price committee https://youtu.be/h2ZJ1PZMuWw · self-custody wallet https://youtu.be/o_4EjcfgKgI

## One-line description

Private secured lending on Canton: funded offers, margin calls with cash or collateral
cures, collateral substitution and partial repayment — with real Canton Coin collateral
locked by a CIP-112 (Token Standard V2) committed allocation.

## What is new this season

The pre-season baseline (commit `2455470`) had private offers, simulated holdings,
acceptance, repayment and lender-priced liquidation. Built during Season 3:

- Jointly authorised valuation streams, fresh-price checks at origination, timed margin
  calls, top-ups, recovery and enforced maturity (PRs #36, #38)
- Controlled issuance and funded offers (#39); per-party authenticated sessions (#42)
- Redesigned UI with a disclosure matrix and raw-ledger inspector (#43, #44)
- Hosted on the HackCanton DevNet node with open access (#45, #46, #50)
- Collateral substitution (#47), partial repayment and cure-by-pay-down (#48),
  user-chosen terms and amounts (#49)
- **Real Canton Coin collateral via CIP-112 committed allocations** (#51, #52)
- **External review addressed:** audit findings #53–#60 triaged in `docs/AUDIT-TRIAGE.md`; the valid ones fixed in contract release 0.9.0 (surplus returned on liquidation, offer reject/expiry, term bounds, joint record deletion, independent regulator) (#63)
- **Second audit round, contract release 0.10.0:** a review of the Canton Coin path found that the lender, as sole executor of the coin lock, could settle it outside Veil, and that a borrower-chosen allocation factory was not authenticated. 0.10.0 makes lender and borrower joint executors, verifies every allocation, adds a close for lapsed locks and removes a division-by-zero. It was checked as a compatible upgrade and verified live on DevNet: a lender-alone settlement is refused by Canton Coin itself (#88, #89)
- **Operations:** an off-ledger lender keeper (`scripts/keeper.mjs`) and a Loan book tab with CSV/JSON export (#63)
- **Guided demo** that walks a first visit through the T-Bill or Canton Coin loan, and fixes so consecutive visitors can share the demo (#64–#66)
- **Production hardening:** a keeper command journal that resolves lost responses from the ledger, maker-checker approval for liquidations, and a hardened proxy (request IDs, sanitised errors, timeouts, lost-submission checks in the UI) (#70, #71)
- **Private desks on the shared demo:** each visitor gets their own price streams, loans and guided-demo progress, with **Start over**; idle desks are cleaned up automatically (#74)
- **Decentralized price committee (BitSafe DecMan):** a 2-of-3 decentralized party can act as the valuation agent, publishing prices only when two nodes agree; reproducible LocalNet demo in `committee/` (#75); a generic price-feed package proposed to DecMan ([DLC-link/decentralization-manager#504](https://github.com/DLC-link/decentralization-manager/pull/504)). BitSafe reviewed it over two rounds and called the final package solid, but closed it without merging: the `hackathon` branch is a LocalNet sandbox that does not ship, and they have no product need for a generic price feed today. The package stays in our fork.
- **Self-custody borrower, now on DevNet.** The borrower is an external party whose key stays with the user; nine borrower transactions are signed by that key, and the node cannot act for it without a signature. Before every signature it decodes the prepared transaction, recomputes the hash and checks the whole transaction tree against what the user asked for, with pinned package versions. It ran end to end on hackcanton-01 on Oct 7 with wallet parties the node operator onboarded from our signed requests (`wallet/devnet/RUN-2026-10-07.log`); it is a script, not yet part of the web app (#79, #83, #87)

## Try it (≈2 minutes)

Easiest: open the app, pick any party and follow the **Guided demo** panel; it tells you which party to be and switches for you. By hand:

1. **Valuer** → select *Canton Coin* → enter `0.15` → *Publish mark*.
2. **Lender** → collateral *Canton Coin (real)* → *Create offer*.
3. **Borrower** → *Accept offer* — 1,000 CC is locked.
4. **Valuer** → `0.11` · **Lender** → *Issue margin call*.
5. **Borrower** → *Pay down* 30 → *Repay* — the CC unlocks.
6. **Outsider** → *Raw ledger* shows `[]`; **Valuer** sees prices only.

A price is usable for five minutes; if *Create offer* or *Accept* reports a stale
price, publish a fresh one as Valuer first. Visitors share the demo parties, but each browser gets
its own desk (prices, loans, guided-demo progress); **Start over** clears only yours.

## Next

- **Wallet connection:** PartyLayer (`@partylayer/sdk`, CIP-0103) to connect Console, Loop, Nightly and other Canton wallets. Their parties live on nodes where Veil is not installed, so they can sign token-standard steps rather than co-sign Veil contracts until those nodes vet the package.
- **Real prices:** Kaiko or Coin Metrics feeding the decentralized price committee instead of a manual valuer.
- **Real assets:** Brale stablecoins for the principal; tokenised T-Bills via the token standard.
- **Operations on MainNet:** Denex Gas Station to fund the keeper's traffic.

## Honest boundaries

- **What is live and what is not:** the lending app runs on DevNet. The self-custody wallet runs on DevNet as a script (onboarding needs the node operator), not in the web app. The price committee is a LocalNet demonstration, because it needs several participants we control. Both have recorded videos (`docs/veil-bitsafe-committee-demo.mp4`, `docs/veil-wallet-localnet-demo.mp4`).
- On the shared node one ledger user hosts every demo party, so our server enforces
  role separation there (locally Canton enforces it as well).
- Visitor desks separate visitors in the app, not on the ledger: all visitors share the same demo parties.
- On DevNet, valuations are manually attested by one valuer party; the decentralized price committee runs on LocalNet only (it needs several participants we control).
- T-Bill/MMF units and USDC principal are simulated; Canton Coin collateral is real DevNet CC.
- No customer validation or external audit yet.

## Evidence

76 Daml scripts (69 core including 11 audit regression tests, 5 price committee, 2 wallet) and 144 server, keeper, UI-logic and wallet-verifier tests pass, as did 49 live auth checks
and 12 browser checks. On hackcanton-01 with real DevNet CC: Canton Coin repay,
liquidation (by hand and by the keeper) and reset; T-Bill liquidation returning surplus
collateral; and both guided-demo tracks completed by following the guide alone, including
two consecutive visitors without a reset and, with desks, two visitors at the same time
(PRs #51, #63–#66, #74).
