---
marp: true
title: Veil | HackCanton Season 3 submission
description: Private secured lending on Canton with CIP-112 Canton Coin collateral.
author: No Witness Labs
theme: default
paginate: true
size: 16:9
footer: 'NO WITNESS LABS  /  VEIL 0.8.1  /  HACKCANTON SEASON 3'
---

<style>
section {
  background: #f7f8fa; color: #152231;
  font-family: Arial, Helvetica, sans-serif;
  padding: 48px 64px 60px; align-content: start;
  font-size: 25px; line-height: 1.3;
}
h1, h2, h3, p { margin: 0; }
section h1 { font-size: 84px; line-height: 1; letter-spacing: -4px; color: #fff; }
section h2 { font-size: 48px; line-height: 1.1; letter-spacing: -1.7px; margin-bottom: 26px; color: #152231; }
section h3 { font-size: 30px; line-height: 1.15; margin-bottom: 14px; color: #152231; }
p + p { margin-top: 18px; }
strong { font-weight: 700; color: inherit; }
a { color: #2748d8; text-decoration: none; }
footer { left: 64px; bottom: 25px; font-size: 13px; letter-spacing: 1.6px; color: #697788; }
section::after { right: 48px; bottom: 24px; font-size: 14px; color: #697788; }
.eyebrow { color: #2748d8; font-size: 16px; letter-spacing: 2px; font-weight: 700; margin-bottom: 20px; text-transform: uppercase; }
.lead { font-size: 32px; line-height: 1.3; letter-spacing: -.4px; }
.muted { color: #536374; }
.small { font-size: 22px; line-height: 1.35; }
.source { margin-top: 18px; color: #697788; font-size: 15px; line-height: 1.3; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 42px; }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
.panel { padding: 24px; border: 1px solid #dce2e9; border-radius: 16px; background: #fff; }
.rule { border-top: 1px solid #ccd4df; margin-top: 25px; padding-top: 23px; }
.accent { color: #2748d8; }
.tag { display: inline-block; border: 1px solid #b7c5fa; border-radius: 6px; padding: 6px 10px; color: #2748d8; font-size: 16px; letter-spacing: .6px; }
.band { margin-top: 22px; border-left: 5px solid #2748d8; padding: 16px 22px; background: #eaf0ff; font-size: 24px; }
.num { font-size: 60px; font-weight: 700; line-height: 1; letter-spacing: -2px; margin-bottom: 20px; }
.label { font-size: 17px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 17px; font-weight: 700; }
.decision { display: grid; grid-template-columns: 70px 290px 1fr; gap: 16px; align-items: baseline; padding: 20px 0; border-bottom: 1px solid #ccd4df; }
.decision .index { color: #2748d8; font-size: 25px; }
.decision h3 { margin: 0; }
.decision p { font-size: 25px; color: #536374; }
table { width: 100%; display: table; border-collapse: collapse; font-size: 24px; line-height: 1.3; margin: 0; }
th, td { text-align: left; padding: 17px 20px; border: none; border-bottom: 1px solid #dce2e9; }
th { background: #e7ecf3; font-size: 18px; color: #536374; letter-spacing: .7px; }
tr, tr:nth-child(2n) { background: transparent; }
td:first-child { font-weight: 700; }
section.privacy table { font-size: 23px; }
section.privacy th, section.privacy td { padding: 12px 18px; }
section.dark { background: #101f31; color: #f7f8fa; }
section.dark h2, section.dark h3 { color: #f7f8fa; }
section.dark .eyebrow { color: #79e0c6; }
section.dark footer, section.dark::after { color: #8c9cad; }
section.dark .muted, section.dark .source { color: #b2c2d2; }
section.dark a { color: #90b3ff; }
section.cover { align-content: center; }
section.cover .lead { font-size: 38px; max-width: 900px; margin-top: 30px; }
section.cover .rule { border-color: #405267; margin-top: 40px; color: #b2c2d2; font-size: 23px; }
.flow { display: flex; gap: 16px; align-items: center; margin-top: 40px; font-size: 22px; }
.flow span { border: 1px solid #405267; border-radius: 8px; padding: 16px 24px; }
.flow b { color: #79e0c6; font-weight: 400; }
.product { display: grid; grid-template-columns: 570px 1fr; gap: 40px; align-items: start; }
.product img { width: 570px; height: 445px; object-fit: contain; object-position: top; border: 1px solid #dce2e9; border-radius: 12px; background: #fff; }
.product h3 { font-size: 28px; margin-bottom: 9px; }
.product p { font-size: 23px; }
.product .rule { margin-top: 22px; padding-top: 20px; }
.evidence { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 40px; }
.evidence .num { font-size: 48px; margin-bottom: 12px; }
.evidence p { font-size: 24px; }
code { font-size: .9em; background: #e7ecf3; padding: 1px 6px; border-radius: 4px; }
section.dark code { background: #22344a; }
</style>

<!-- _class: dark cover -->

<div class="eyebrow">HackCanton Season 3 · Track 2 — Financial Applications</div>

# Veil

<p class="lead">Private secured lending on Canton — with collateral locked by the Canton Coin token standard itself.</p>

<div class="flow"><span>Fund</span><b>→</b><span>Lock collateral</span><b>→</b><span>Margin-call &amp; cure</span><b>→</b><span>Repay or liquidate</span></div>

<div class="rule">Live on the HackCanton DevNet node · <a href="https://veil-lite-hackathon.vercel.app">veil-lite-hackathon.vercel.app</a> · no sign-up needed<br>No Witness Labs</div>

---

<div class="eyebrow">The problem</div>

## Secured lending needs privacy and enforceable collateral

<div class="two" style="margin-top:10px">
<div class="panel"><h3>Public chains leak the book</h3><p class="small">Counterparties, sizes, collateral and liquidation levels become public. Institutions can't run a repo or credit desk like that.</p></div>
<div class="panel"><h3>Off-chain is fragmented</h3><p class="small">Terms, price checks, margin calls and settlement live in emails, spreadsheets and custodian systems — nobody holds one enforceable state.</p></div>
</div>

<div class="band">Veil gives two known counterparties one private, enforceable loan: the ledger checks every transition, and only the parties who need to see a contract can.</div>

---

<div class="eyebrow">The product</div>

## A complete loan lifecycle, enforced on-ledger

<table>
<tr><th>Stage</th><th>What Canton enforces</th></tr>
<tr><td>Offer</td><td>Lender pre-funds the principal; terms (LTV threshold, call window, maturity) are chosen by the user</td></tr>
<tr><td>Accept</td><td>Fresh attested price must show LTV below threshold; collateral locks and principal is delivered in <b>one</b> transaction</td></tr>
<tr><td>Margin call</td><td>Only on a fresh breach; a ledger-time deadline. Cure by top-up, <b>cash pay-down</b>, or price recovery</td></tr>
<tr><td>During the loan</td><td>Partial repayment; <b>collateral substitution</b> (T-Bill → MMF) with lender approval and an LTV re-check</td></tr>
<tr><td>Close</td><td>Repay releases collateral; liquidation only after an expired call on a breached mark, or after maturity</td></tr>
</table>

---

<div class="eyebrow">New this season</div>

## Real Canton Coin collateral, locked by CIP-112

<div class="product">
<img src="assets/veil-cc-collateral.png" style="height:auto">
<div>
<h3>A committed allocation, not an escrow account</h3>
<p>On acceptance the borrower's Canton Coin is locked in a <b>Token Standard V2 committed allocation</b> whose only executor is the lender.</p>
<div class="rule"><p class="small">✓ Borrower's early withdrawal <b>refused by Canton Coin itself</b><br>✓ Repay → allocation cancelled, coin unlocks<br>✓ Liquidation → settled to the lender via <code>SettleBatch</code><br>✓ Verified on hackcanton-01 with real DevNet CC</p></div>
</div>
</div>

---

<div class="eyebrow">Why Canton</div>

## Privacy and atomicity are structural, not bolted on

<div class="three">
<div class="panel"><div class="label accent">Need-to-know</div><p class="small">Lender, borrower and regulator see the loan; the valuer sees only its prices; an outsider's ledger query returns <code>[]</code>.</p></div>
<div class="panel"><div class="label accent">Atomic</div><p class="small">Lock collateral + check LTV + deliver principal + open the loan: one multi-party transaction, or nothing.</p></div>
<div class="panel"><div class="label accent">Composable</div><p class="small">Collateral uses the network's own token standard (CIP-112) — the same primitive any Canton asset can plug into.</p></div>
</div>

<div class="band">The in-app Disclosure tab shows the signatory/observer matrix for every contract; the Raw ledger tab shows exactly what each party's ledger query returns.</div>

---

<div class="eyebrow">Economic flows</div>

## Who moves what, and why

<div class="two">
<div>
<p class="small"><b>Lender</b> earns fixed interest on principal it pre-funds; protected by a locked, enforceable claim on collateral.</p>
<p class="small"><b>Borrower</b> gets liquidity without selling its assets; can cure calls with cash or more collateral, or swap collateral.</p>
<p class="small"><b>Valuer</b> publishes signed prices on a stream both counterparties authorised.</p>
<p class="small"><b>Regulator</b> observes positions and settlements without taking part.</p>
</div>
<div class="panel">
<div class="label accent">Network activity per loan</div>
<p class="small">Each loan is 6–10 ledger transactions: funding, a token-standard allocation, price updates, margin actions, and a token-standard settlement or cancellation.</p>
<p class="small muted">Not built: protocol fees, valuer fees, stablecoin principal (principal is simulated USDC today).</p>
</div>
</div>

---

<div class="eyebrow">Architecture</div>

## Small, auditable, deployed

<table>
<tr><th>Layer</th><th>What it is</th></tr>
<tr><td>Contracts</td><td>Daml package <code>veil-lite</code> 0.8.1 on hackcanton-01; Token Standard V2 interfaces (exact vetted packages)</td></tr>
<tr><td>Server</td><td>Vercel functions: per-party sessions, per-party read/act checks, read-only token-registry proxy</td></tr>
<tr><td>App</td><td>React UI with role views, disclosure matrix and raw ledger inspector</td></tr>
<tr><td>Evidence</td><td>49 Daml scripts · 13 server tests · 49 live auth checks · 12 browser checks · DevNet runs with real CC</td></tr>
</table>

<p class="source">Trust boundary, stated plainly: on the shared node one ledger user hosts all demo parties, so our server enforces role separation there; valuations are manually attested; T-Bill/MMF and USDC are simulated.</p>

---

<div class="eyebrow">Try it</div>

## Two minutes on the live app

<div class="two">
<div class="panel"><div class="label accent">Canton Coin loan</div><p class="small">1. Valuer → Canton Coin → publish 0.15<br>2. Lender → collateral <b>Canton Coin (real)</b> → Create offer<br>3. Borrower → Accept (1,000 CC locks)<br>4. Valuer → 0.11 · Lender → Issue margin call<br>5. Borrower → Pay down 30 → Repay (CC unlocks)</p></div>
<div class="panel"><div class="label accent">Privacy check</div><p class="small">Enter as <b>Outsider</b> → Raw ledger: <code>[]</code>.<br>Enter as <b>Valuer</b>: prices only, no loan.<br>Enter as <b>Regulator</b>: the loan and its settlement, read-only.</p><p class="small muted">Open access: pick a party and click Enter.</p></div>
</div>

---

<div class="eyebrow">Next</div>

## From demo to pilot

<div class="decision"><div class="index">01</div><h3>Validate the user</h3><p>Walk 3 lending / treasury operators through one real deal. No customer evidence yet.</p></div>
<div class="decision"><div class="index">02</div><h3>Real signing</h3><p>Each counterparty on its own participant or wallet (CIP-103 dApp API) instead of a shared ledger user.</p></div>
<div class="decision"><div class="index">03</div><h3>Real assets and prices</h3><p>Stablecoin principal and tokenised T-Bills via the token standard; an independent price source instead of a manual valuer.</p></div>
