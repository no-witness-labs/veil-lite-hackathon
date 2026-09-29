# Veil — HackCanton Season 3 submission notes

**Track:** 2 — Financial Applications
**Live app:** https://veil-lite-hackathon.vercel.app (DevNet, open access: pick a party and click **Enter**)
**Repository:** https://github.com/no-witness-labs/veil-lite-hackathon
**Deck:** [`docs/SUBMISSION-DECK.pdf`](SUBMISSION-DECK.pdf)
**Video:** [`docs/veil-season3-cc-demo.mp4`](veil-season3-cc-demo.mp4) (2:32, Canton Coin loan on DevNet; see [`SEASON3-RECORDINGS.md`](SEASON3-RECORDINGS.md))

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
- **Operations:** an off-ledger lender keeper (`scripts/keeper.mjs`) and a Loan book tab with CSV/JSON export (#63)
- **Guided demo** that walks a first visit through the T-Bill or Canton Coin loan, and fixes so consecutive visitors can share the demo (#64–#66)
- **Production hardening:** a keeper command journal that resolves lost responses from the ledger, maker-checker approval for liquidations, and a hardened proxy (request IDs, sanitised errors, timeouts, lost-submission checks in the UI) (#70, #71)

## Try it (≈2 minutes)

Easiest: open the app, pick any party and follow the **Guided demo** panel; it tells you which party to be and switches for you. By hand:

1. **Valuer** → select *Canton Coin* → enter `0.15` → *Publish mark*.
2. **Lender** → collateral *Canton Coin (real)* → *Create offer*.
3. **Borrower** → *Accept offer* — 1,000 CC is locked.
4. **Valuer** → `0.11` · **Lender** → *Issue margin call*.
5. **Borrower** → *Pay down* 30 → *Repay* — the CC unlocks.
6. **Outsider** → *Raw ledger* shows `[]`; **Valuer** sees prices only.

A price is usable for five minutes; if *Create offer* or *Accept* reports a stale
price, publish a fresh one as Valuer first. The demo ledger is shared by all visitors.

## Honest boundaries

- On the shared node one ledger user hosts every demo party, so our server enforces
  role separation there (locally Canton enforces it as well).
- Valuations are manually attested; T-Bill/MMF units and USDC principal are simulated.
  Canton Coin collateral is real DevNet CC.
- No customer validation or external audit yet.

## Evidence

58 Daml scripts and 90 server, keeper and UI-logic tests pass, as did 49 live auth checks
and 12 browser checks. On hackcanton-01 with real DevNet CC: Canton Coin repay,
liquidation (by hand and by the keeper) and reset; T-Bill liquidation returning surplus
collateral; and both guided-demo tracks completed by following the guide alone, including
two consecutive visitors without a reset (PRs #51, #63–#66).
