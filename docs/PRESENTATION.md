---
marp: true
title: Veil — Private Repo-Style Financing on Canton
description: Checkpoint 2 presentation deck for the Encode Build on Canton Hackathon
theme: veil
paginate: true
size: 16:9
---

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

:root {
  --ink: #f8fafc;
  --muted: #94a3b8;
  --paper: #f8fafc;
  --text: #111827;
  --subtext: #475569;
  --navy: #07111f;
  --navy2: #0f1b2d;
  --blue: #2f6df6;
  --cyan: #38d5ff;
  --mint: #31d0aa;
  --gold: #f6c85f;
  --rose: #ff6b88;
  --line: rgba(15, 23, 42, .12);
}
section {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: radial-gradient(circle at 92% 12%, rgba(56,213,255,.14), transparent 24%), linear-gradient(135deg, #f8fafc 0%, #eef4ff 100%);
  color: var(--text);
  padding: 54px 64px;
  letter-spacing: -0.01em;
}
section::after {
  font-family: 'JetBrains Mono', monospace;
  color: rgba(15, 23, 42, .35);
  font-size: 12px;
  right: 38px;
  bottom: 28px;
}
h1, h2, h3 { margin: 0; line-height: 0.95; }
h1 { font-size: 64px; letter-spacing: -0.065em; font-weight: 800; }
h2 { font-size: 44px; letter-spacing: -0.045em; font-weight: 800; }
h3 { font-size: 19px; font-weight: 750; letter-spacing: -0.02em; }
p, li { font-size: 20px; line-height: 1.38; color: var(--subtext); }
strong { color: var(--text); font-weight: 800; }
code { font-family: 'JetBrains Mono', monospace; color: #0f5ed7; background: rgba(47,109,246,.09); padding: 2px 6px; border-radius: 7px; }
table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 18px; overflow: hidden; border-radius: 18px; box-shadow: 0 20px 50px rgba(15,23,42,.08); }
th { background: #0f1b2d; color: white; text-align: left; font-weight: 800; padding: 14px 18px; }
td { padding: 13px 18px; background: rgba(255,255,255,.84); border-bottom: 1px solid rgba(15,23,42,.08); color: #263244; }
section.dark {
  background: radial-gradient(circle at 82% 18%, rgba(56,213,255,.18), transparent 28%), radial-gradient(circle at 16% 82%, rgba(49,208,170,.16), transparent 30%), linear-gradient(135deg, #07111f 0%, #101e33 58%, #102a43 100%);
  color: var(--ink);
}
section.dark h1, section.dark h2, section.dark h3 { color: #ffffff; text-shadow: 0 8px 30px rgba(0,0,0,.22); }
section.dark p, section.dark li { color: #dbe7f5; }
section.dark strong { color: white; }
section.dark::after { color: rgba(255,255,255,.58); }
.kicker { font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: .16em; font-size: 13px; font-weight: 800; color: var(--cyan); margin-bottom: 22px; }
.dark .kicker { color: var(--mint); }
.subtitle { font-size: 24px; line-height: 1.28; color: #e2e8f0; max-width: 820px; margin-top: 24px; }
.pill { display: inline-block; padding: 8px 13px; border-radius: 999px; background: rgba(56,213,255,.12); color: #dff8ff; border: 1px solid rgba(56,213,255,.25); font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 800; letter-spacing: .05em; }
.grid2 { display: grid; grid-template-columns: 1.03fr .97fr; gap: 34px; align-items: center; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 28px; }
.card { background: rgba(255,255,255,.78); border: 1px solid rgba(15,23,42,.10); border-radius: 24px; padding: 24px; box-shadow: 0 18px 45px rgba(15,23,42,.08); }
.dark .card { background: rgba(7,17,31,.58); border-color: rgba(56,213,255,.24); box-shadow: 0 18px 55px rgba(0,0,0,.18); }
.dark .card h3 { color: #ffffff; }
.dark .card p { color: #dbe7f5; }
.roadmap-card { background: #0d2037 !important; border: 1px solid rgba(56,213,255,.34) !important; box-shadow: 0 18px 55px rgba(0,0,0,.25) !important; }
.roadmap-card h3 { color: #ffffff !important; }
.roadmap-card p { color: #e2e8f0 !important; font-weight: 500; }
.card p { font-size: 16px; margin: 8px 0 0; }
.badge { width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; background: linear-gradient(135deg, var(--blue), var(--cyan)); color: white; font-weight: 900; margin-bottom: 14px; }
.flow { display: flex; align-items: stretch; gap: 10px; margin-top: 28px; }
.step { flex: 1; border-radius: 18px; padding: 17px 14px; background: white; border: 1px solid rgba(15,23,42,.11); box-shadow: 0 12px 30px rgba(15,23,42,.07); }
.step b { display: block; font-size: 14px; font-family: 'JetBrains Mono', monospace; color: var(--blue); margin-bottom: 8px; }
.step span { display: block; font-size: 15px; line-height: 1.18; color: #263244; font-weight: 700; }
.arrow { display: grid; place-items: center; color: var(--blue); font-weight: 900; font-size: 22px; }
.stat { background: linear-gradient(135deg, #0f1b2d, #17365e); color: white; padding: 22px; border-radius: 24px; min-height: 116px; box-shadow: 0 25px 60px rgba(15,23,42,.18); }
.stat .num { font-family: 'JetBrains Mono', monospace; font-size: 42px; font-weight: 900; letter-spacing: -.05em; color: var(--cyan); }
.stat .label { font-size: 14px; color: #cbd5e1; margin-top: 8px; line-height: 1.25; }
.ledger { font-family: 'JetBrains Mono', monospace; background: #07111f; color: #e2e8f0; border-radius: 24px; padding: 24px; box-shadow: 0 30px 70px rgba(7,17,31,.28); font-size: 16px; line-height: 1.6; }
.ledger .green { color: var(--mint); }
.ledger .blue { color: var(--cyan); }
.ledger .rose { color: var(--rose); }
.timeline { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 24px; }
.row { display: grid; grid-template-columns: 40px 1fr; gap: 14px; align-items: start; }
.dot { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; font-family: 'JetBrains Mono'; font-weight: 900; color: white; background: linear-gradient(135deg, var(--blue), var(--cyan)); }
.row div:last-child { background: rgba(255,255,255,.78); border: 1px solid rgba(15,23,42,.10); border-radius: 16px; padding: 11px 16px; font-size: 17px; color: #334155; }
.callout { border-left: 8px solid var(--mint); background: rgba(49,208,170,.10); padding: 20px 26px; border-radius: 0 22px 22px 0; font-size: 24px; line-height: 1.25; color: #d9fff5; margin-top: 34px; }
.howGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 13px; margin-top: 18px; }
.howCard { position: relative; min-height: 142px; background: rgba(255,255,255,.84); border: 1px solid rgba(15,23,42,.10); border-radius: 21px; padding: 17px 18px; box-shadow: 0 14px 35px rgba(15,23,42,.07); overflow: hidden; }
.howCard::before { content: ''; position: absolute; right: -38px; top: -38px; width: 96px; height: 96px; border-radius: 999px; background: rgba(47,109,246,.10); }
.howNo { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 900; color: var(--blue); margin-bottom: 9px; }
.howCard h3 { font-size: 17px; line-height: 1.05; margin-bottom: 7px; }
.howCard p { font-size: 12.5px; line-height: 1.24; margin: 0; color: #475569; }
.howFooter { display: grid; grid-template-columns: 1.1fr .9fr; gap: 14px; margin-top: 12px; align-items: stretch; }
.miniLedger { font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.35; background: #07111f; color: #e2e8f0; border-radius: 18px; padding: 12px 16px; box-shadow: 0 18px 42px rgba(7,17,31,.20); }
.small { font-size: 15px; color: var(--muted); }
.logoMark { width: 72px; height: 72px; border-radius: 24px; background: linear-gradient(135deg, var(--blue), var(--cyan)); transform: rotate(45deg); box-shadow: 0 25px 70px rgba(56,213,255,.28); margin-bottom: 42px; }
</style>

<!-- _class: dark -->

<div class="logoMark"></div>
<div class="kicker">Encode Build on Canton · Checkpoint 2</div>

# Veil

<div class="subtitle">Private repo-style financing against tokenized collateral on Canton.</div>

<div style="margin-top: 34px; display:flex; gap:12px;">
  <span class="pill">Private Credit</span>
  <span class="pill">Tokenized Collateral</span>
  <span class="pill">Selective Disclosure</span>
</div>

---

<div class="kicker">Problem</div>

## Institutional financing needs privacy and shared state

<div class="grid2" style="margin-top: 30px;">
<div>
<p>Private credit, repo, OTC secured lending, and treasury financing involve sensitive business data.</p>
<div class="cards">
  <div class="card"><div class="badge">1</div><h3>Counterparties</h3><p>Borrower and lender identity cannot leak to the market.</p></div>
  <div class="card"><div class="badge">2</div><h3>Terms</h3><p>Pricing, maturity, collateral, and health are commercially sensitive.</p></div>
  <div class="card"><div class="badge">3</div><h3>Regulators</h3><p>Auditors need visibility without making deals public.</p></div>
  <div class="card"><div class="badge">4</div><h3>Reconciliation</h3><p>Offchain emails/PDFs/spreadsheets create operational drag.</p></div>
</div>
</div>
<div class="ledger">
<span class="rose">public chain</span>  → everyone sees terms<br/>
<span class="rose">offchain ops</span>   → private but fragmented<br/>
<br/>
<span class="green">needed</span>         → shared workflow state<br/>
<span class="green">needed</span>         → need-to-know visibility<br/>
<span class="green">needed</span>         → auditable authorization
</div>
</div>

---

<div class="kicker">Solution</div>

## Veil: private bilateral financing execution

<div class="grid2" style="margin-top: 34px;">
<div>
<p><strong>A known lender privately offers financing to a known borrower.</strong> The borrower pledges tokenized collateral, accepts the offer, receives principal, repays, and gets collateral released.</p>
<p>Veil is not a discovery marketplace. It is the private execution layer after counterparties agree to transact.</p>
</div>
<div class="ledger">
<span class="blue">LoanOffer</span>  lender signatory<br/>
             borrower + regulator observe<br/><br/>
<span class="blue">Accept</span>     borrower controls<br/>
             locks collateral + delivers principal<br/><br/>
<span class="blue">Repay</span>      borrower controls<br/>
             closes loan + releases collateral
</div>
</div>

---

<div class="kicker">How it works</div>

## The private financing lifecycle

<div class="howGrid">
  <div class="howCard"><div class="howNo">01 · FUND</div><h3>Initial holdings</h3><p>Lender starts with cash. Borrower starts with tokenized T-Bill/MMF collateral. Each holding is visible only to its owner.</p></div>
  <div class="howCard"><div class="howNo">02 · OFFER</div><h3>Private terms</h3><p>Lender creates a borrower-specific offer. Borrower and regulator observe; outsiders cannot query it.</p></div>
  <div class="howCard"><div class="howNo">03 · ACCEPT</div><h3>Atomic drawdown</h3><p>Borrower accepts. Collateral locks and principal is delivered in the same Canton transaction.</p></div>
  <div class="howCard"><div class="howNo">04 · OBSERVE</div><h3>Selective disclosure</h3><p>Regulator gets read-only visibility as an observer without making the deal public.</p></div>
  <div class="howCard"><div class="howNo">05 · REPAY</div><h3>Close facility</h3><p>Borrower repays principal plus interest. Loan closes and collateral is released back to the borrower.</p></div>
  <div class="howCard"><div class="howNo">06 · RISK</div><h3>Optional liquidation</h3><p>If price feed marks collateral below threshold, lender can liquidate under on-ledger LTV rules.</p></div>
</div>

<div class="howFooter">
  <div class="miniLedger"><span class="green">Privacy proof:</span> same active-contracts query<br/>lender/borrower/regulator → deal visible<br/>outsider → <span class="rose">[]</span></div>
  <div class="miniLedger"><span class="green">Business proof:</span> 100 principal + 5 interest<br/>150 collateral units locked<br/>105 repayment releases collateral</div>
</div>

---

<div class="kicker">Asset / financing logic</div>

## Concrete repo-style demo terms

<div class="grid2" style="margin-top: 28px; grid-template-columns: .95fr 1.05fr;">
<div class="grid3" style="grid-template-columns: 1fr 1fr;">
  <div class="stat"><div class="num">100</div><div class="label">USDC-equivalent principal</div></div>
  <div class="stat"><div class="num">5</div><div class="label">interest</div></div>
  <div class="stat"><div class="num">105</div><div class="label">repayment amount</div></div>
  <div class="stat"><div class="num">150</div><div class="label">tokenized T-Bill/MMF collateral units</div></div>
</div>
<div>
<table>
  <thead><tr><th>Field</th><th>Value</th></tr></thead>
  <tbody>
    <tr><td>Initial LTV</td><td><strong>66.7%</strong></td></tr>
    <tr><td>Maturity</td><td>2026-07-13</td></tr>
    <tr><td>Collateral state</td><td>Locked while active</td></tr>
    <tr><td>Optional risk branch</td><td>Price drop → LTV breach → liquidation</td></tr>
  </tbody>
</table>
</div>
</div>

---

<div class="kicker">Why Canton</div>

## Privacy is product logic, not infrastructure for its own sake

<div class="cards" style="grid-template-columns: repeat(4, 1fr); margin-top: 32px;">
  <div class="card"><div class="badge">P</div><h3>Need-to-know privacy</h3><p>Lender, borrower, regulator see the deal. Outsider sees nothing.</p></div>
  <div class="card"><div class="badge">A</div><h3>Authorization</h3><p>Signatories/controllers define who can create, accept, repay, or liquidate.</p></div>
  <div class="card"><div class="badge">L</div><h3>Lifecycle</h3><p>Offer acceptance locks collateral and delivers principal atomically.</p></div>
  <div class="card"><div class="badge">R</div><h3>Regulator view</h3><p>Selective observer rights provide audit without public disclosure.</p></div>
</div>

<div class="flow">
  <div class="step"><b>VISIBLE</b><span>Lender</span></div><div class="arrow">→</div>
  <div class="step"><b>VISIBLE</b><span>Borrower</span></div><div class="arrow">→</div>
  <div class="step"><b>VISIBLE</b><span>Regulator</span></div><div class="arrow">→</div>
  <div class="step"><b>EMPTY</b><span>Outsider: []</span></div>
</div>

---

<div class="kicker">Demo flow</div>

## A 3-minute judge path

<div class="timeline">
  <div class="row"><div class="dot">1</div><div>Lender creates a borrower-specific offer with canonical financing terms.</div></div>
  <div class="row"><div class="dot">2</div><div>Borrower sees the offer. Outsider sees nothing.</div></div>
  <div class="row"><div class="dot">3</div><div>Borrower accepts; collateral locks and principal is delivered on-ledger.</div></div>
  <div class="row"><div class="dot">4</div><div>Regulator observes read-only while outsider still gets an empty active-contracts response.</div></div>
  <div class="row"><div class="dot">5</div><div>Borrower repays 105; loan closes and collateral releases.</div></div>
  <div class="row"><div class="dot">6</div><div>Optional: price drop creates LTV breach; lender liquidates.</div></div>
</div>

---

<div class="kicker">What works today</div>

## Built and verified

<div class="grid2" style="margin-top: 30px;">
<div class="cards" style="grid-template-columns: 1fr; margin-top:0;">
  <div class="card"><h3>Daml model</h3><p><code>CashHolding</code>, <code>CollateralHolding</code>, <code>LoanOffer</code>, <code>Loan</code>, <code>LoanClosed</code>, <code>PriceFeed</code>.</p></div>
  <div class="card"><h3>On-ledger flow</h3><p>Asset movement for acceptance/repayment and guarded liquidation using price/LTV.</p></div>
  <div class="card"><h3>Role-based UI</h3><p>React/Vite UI over Canton JSON Ledger API v2 with raw ledger proof panel.</p></div>
</div>
<div class="ledger">
$ dpm build<br/>
<span class="green">✓ veil-0.1.0.dar</span><br/><br/>
$ (cd test && dpm build && dpm test)<br/>
<span class="green">✓ lifecycle + privacy tests</span><br/><br/>
$ npm --prefix frontend run build<br/>
<span class="green">✓ production frontend build</span>
</div>
</div>

---

<!-- _class: dark -->

<div class="kicker">Roadmap</div>

## From hackathon proof to institutional product

<div class="cards" style="grid-template-columns: repeat(2, 1fr); margin-top: 32px;">
  <div class="card roadmap-card"><div class="badge">1</div><h3>Token standard integration</h3><p>Replace demo assets with Canton token standard / Canton Coin integrations.</p></div>
  <div class="card roadmap-card"><div class="badge">2</div><h3>Production signing</h3><p>Add external signing, wallet flows, and production identity/auth.</p></div>
  <div class="card roadmap-card"><div class="badge">3</div><h3>Multi-participant Canton</h3><p>Move from local sandbox to realistic participant topology.</p></div>
  <div class="card roadmap-card"><div class="badge">4</div><h3>Professional workflows</h3><p>Add PQS reporting, richer credit terms, margin calls, and compliance flows.</p></div>
</div>

<div class="callout">Hackathon scope: prove private institutional financing coordination — not production token infrastructure.</div>
