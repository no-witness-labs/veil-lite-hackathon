---
marp: true
title: Veil | HackCanton Season 3 team briefing
description: Why we are improving Veil, what the local 0.5.0 model proves, and the review needed before a pilot.
author: No Witness Labs
theme: default
paginate: true
size: 16:9
footer: 'NO WITNESS LABS  /  VEIL 0.5.0  /  SEASON 3'
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
</style>

<!-- _class: dark cover -->

<div class="eyebrow">HackCanton Season 3 / team briefing</div>

# Veil

<p class="lead">Private financing with funded offers<br>and a complete margin-call lifecycle.</p>

<div class="flow"><span>Reserve principal</span><b>→</b><span>Manage collateral</span><b>→</b><span>Repay and release</span></div>

<div class="rule">No Witness Labs · Two-person build team<br>Local Canton model · Version 0.5.0</div>

<!--
Audience: our team and the invited Canton reviewers. This is a project-direction
briefing, not the three-minute product demo; use SEASON3-DEMO-SCRIPT.md for that.
All assets and institutions shown in the UI are simulated. The 0.5.0 implementation
merged in PR #39 on September 22, 2026. No external audit or customer trial has occurred.
-->

---

<div class="eyebrow">The decision</div>

## Improve Veil around one complete workflow

<div class="decision"><div class="index">01</div><h3>A working base</h3><p>Private offers, repayment, and role views already exist. Our two-person team can focus on the missing risk controls.</p></div>
<div class="decision"><div class="index">02</div><h3>Visible new value</h3><p>Reserve principal, recheck collateral value, issue a timed call, cure it, and close the loan. Judges can follow the whole flow.</p></div>
<div class="decision"><div class="index">03</div><h3>A useful review role</h3><p>The invited team's Canton and audit experience fits authorization, valuation lineage, time boundaries, and privacy review.</p></div>

<div class="band">We can build and test the prototype now. An institutional partner helps validate the workflow and define custody, signing, and settlement for a pilot.</div>

<!--
The CTO asked us to focus on Veil. The recommendation is to build on existing
assets with a clearly disclosed new increment. Starting a new application would
require another domain model and integration surface before we could demonstrate
this level of end-to-end behavior. Institutional backing is not required to build
a sandbox prototype; it becomes useful when proving real operating value.
-->

---

<div class="eyebrow">Customer hypothesis</div>

## Private execution for known counterparties

<p class="lead">For lending operations teams financing a known treasury counterparty against tokenized collateral.</p>

<div class="two" style="margin-top:30px">
<div class="panel"><h3>Today: our hypothesis</h3><p class="small">Teams coordinate terms, price checks, margin calls, and settlement across separate systems.</p><p class="small muted">The pain to validate: who owns the current state, what is due, and what each party may see.</p></div>
<div class="panel"><h3>With the Veil demo</h3><p class="small">The ledger enforces the agreed transitions, value checks, deadlines, and contract visibility.</p><p class="small muted">The lender supplies principal; the borrower receives financing and can cure a collateral breach.</p></div>
</div>

<div class="band">Next validation: show the workflow to 3 lending or treasury operators and test whether it matches one real deal. No interviews or willingness-to-pay evidence yet.</div>

<!--
This slide is a product hypothesis, not market evidence. We have no user quotes,
customer commitments, market sizing, or measured savings. Potential buyer: the
lender's operations or technology owner; a paid pilot or software fee is only a
hypothesis until we understand their integration and operating requirements.
-->

---

<div class="eyebrow">What is new</div>

## A disclosed baseline, a concrete increment

<div class="two">
<div>
<h3>Earlier Veil</h3>
<p class="muted">Private offers and demo holdings.<br>Acceptance and repayment.<br>Role views and an earlier hosted demo.</p>
<div class="rule small">Earlier maturity work also exists. Season 3 integrates that policy into the new lifecycle.</div>
<p class="source">Baseline: 2455470 · Earlier video and deck remain prior-work artifacts.</p>
</div>
<div class="panel">
<h3>This Season 3 increment</h3>
<p class="small"><strong>Funding:</strong> controlled issuer and reserved principal.</p>
<p class="small"><strong>Valuation:</strong> agreed price stream, freshness, and origination LTV checks.</p>
<p class="small"><strong>Risk:</strong> timed calls, exact top-ups, recovery, and maturity integration.</p>
<p class="small"><strong>Evidence:</strong> matching UI, local contract tests, and browser checks.</p>
</div>
</div>

<div class="source">Merged implementation: PR #36 · PR #38 · PR #39. Scope and attribution: docs/SEASON3.md.</div>

<!--
Source: docs/SEASON3.md, ADR 0002, PRs 36/38/39. Prior PRs 24, 32, and 34
predate this increment and are not being claimed wholesale as new work. Existing
work is disclosed; final eligibility and track selection remain organizer decisions.
-->

---

<div class="eyebrow">Hackathon fit / proposed Track 2</div>

## A financial workflow that uses Canton directly

<table>
<thead><tr><th>TRACK EXPECTATION</th><th>VEIL DEMONSTRATION</th></tr></thead>
<tbody>
<tr><td>A financial MVP</td><td>Bilateral collateralized financing with funding and risk controls.</td></tr>
<tr><td>Economic flows</td><td>100 principal delivered; 105 repaid; locked collateral returned.</td></tr>
<tr><td>Network activity</td><td>Offers, price updates, calls, cures, and closes create ledger transactions.</td></tr>
<tr><td>Target user and GTM</td><td>Lender operations first; validate one workflow before a scoped pilot.</td></tr>
</tbody>
</table>

<div class="band"><strong>Why Canton:</strong> contract-level visibility, multi-party authorization, and atomic changes to cash and collateral state.</div>
<p class="source">Track 2 is our proposal. Current activity is local and simulated, not live volume. Track brief: hackathon.appsfactory.cc/season-3.</p>

<!--
Track expectations are from the organizer track brief supplied in this conversation.
No current registration, prize, deadline, or eligibility claim is made. A database
can support a centrally operated workflow; our hypothesis is that counterparties
benefit from shared, jointly authorized state with scoped views. The local demo
does not yet validate privacy across independently operated Canton participants.
-->

---

<div class="eyebrow">Funded offers / current product</div>

## The lender reserves principal before acceptance

<div class="product">
<img src="assets/season3-funded-offer.png" alt="Actual Veil 0.5.0 funded offer: 100 simulated USDC reserved, 105 repayment, 150 simulated collateral units, 66.7% LTV.">
<div>
<h3>Fund</h3><p>The normal lender flow consumes cash and reserves 100 in the offer.</p>
<div class="rule"><h3>Accept or withdraw</h3><p>Both consume the same offer. Principal is delivered or refunded once.</p></div>
<div class="rule"><h3>Explicit issuer trust</h3><p>The trusted issuer can mint supply and directly authorize offers. It sees holdings and loans.</p></div>
</div>
</div>

<p class="source">Actual local 0.5.0 screen. Meridian Capital and Northwind Treasury are fictional demo names. No real asset backing or custody is established.</p>

<!--
Source: CashHolding.MakeOffer, LoanOffer.Accept/Withdraw and ADR 0002. The issuer
can co-authorize privileged direct construction, including offers. Conservation is
an invariant of normal choices between issuance and reset, not proof against issuer
collusion or proof of external reserves. Ordinary browser actions omit issuer actAs.
-->

---

<div class="eyebrow">The demo's decisive moment</div>

## A price shock becomes a controlled cure

<div class="three">
<div class="panel"><div class="label accent">01 / healthy</div><div class="num accent">66.7%</div><h3>150 units × 1.00</h3><p class="small muted">Collateral value: 150<br>Principal: 100<br>Offer and acceptance allowed.</p></div>
<div class="panel" style="border-color:#e2bd79;background:#fff9ef"><div class="label" style="color:#995a0e">02 / breached</div><div class="num" style="color:#995a0e">107.5%</div><h3>150 units × 0.62</h3><p class="small muted">Collateral value: 93<br>Threshold: 90%<br>Lender opens a 60-second call.</p></div>
<div class="panel" style="border-color:#80bea9;background:#effaf5"><div class="label" style="color:#187452">03 / cured</div><div class="num" style="color:#187452">80.6%</div><h3>200 units × 0.62</h3><p class="small muted">Borrower adds exactly 50.<br>Collateral value: 124<br>The margin call clears.</p></div>
</div>

<div class="band"><strong>Close:</strong> repay 105 simulated USDC → lender receives 105 → borrower receives all 200 locked units.</div>
<p class="source">LTV = principal ÷ collateral value. Fixed interest is included in repayment, not LTV. All prices are manually attested demo marks.</p>

<!--
Ledger time enforces the call deadline. Top-up must commit before both the deadline
and maturity with a fresh price proving LTV strictly below 90%. Alternative paths:
recovered price resolves a call; expired call plus fresh breach permits margin
liquidation; strictly overdue maturity permits liquidation without a price.
See SEASON3-DEMO-SCRIPT.md for the exact three-minute click path and recovery steps.
-->

---

<!-- _class: privacy -->

<div class="eyebrow">Privacy and authority</div>

## Every role has an explicit visibility boundary

<table>
<thead><tr><th>ROLE</th><th>ACTIVE-CONTRACT VIEW IN THE DEMO</th></tr></thead>
<tbody>
<tr><td>Lender and borrower</td><td>Shared deals and marks; each party's own free holdings.</td></tr>
<tr><td>Regulator</td><td>Observes deal, settlement, and valuation records.</td></tr>
<tr><td>Valuer</td><td>Valuation records and counterparties; no loan or settlement.</td></tr>
<tr><td>Demo issuer</td><td>Its holdings and associated offer, loan, and settlement records.</td></tr>
<tr><td>Outsider</td><td>Empty active-contract response: []</td></tr>
</tbody>
</table>

<div class="band">This is one participant with local authentication disabled. Independent identities, participant privacy, and transaction disclosures still need validation.</div>
<p class="source">The client selects its configured issuer; the raw party query is preserved. Active views do not revoke historical disclosures.</p>

<!--
Source: template signatory/observer declarations; local role-query checks in SEASON3.md.
Do not equate role switching with production authentication. The demo operator
controls all authorities, including reset. The valuer's lack of active loan records
is tested; invite reviewers to check transaction-level divulgence and fetch effects.
-->

---

<div class="eyebrow">Evidence / implementation merged September 22, 2026</div>

## Local behavior is tested; adoption is unvalidated

<div class="evidence">
<div class="panel"><div class="num accent">34 scripts</div><p>Daml regression scripts pass, plus shared setup. Production and frontend builds pass.</p></div>
<div class="panel"><div class="num accent">Full flow</div><p>Local Chrome exercised funding, refunds, guarded acceptance, margin, cure, and repayment.</p></div>
<div class="panel"><h3>Lifecycle conservation</h3><p>Between issuance and reset: cash + offer reserves = 205; free + locked collateral = 200.</p></div>
<div class="panel"><h3>Remaining proof</h3><p>External audit, user trials, independent signing, asset integration, and a validated hosted deployment.</p></div>
</div>

<p class="source">Recorded on 404ab01; merged as e25da25 in PR #39. GitHub CI jobs did not start due to a billing lock; owner-authorized merge used local checks. Detail: docs/SEASON3.md.</p>

<!--
34 named scripts plus setup means 35 runner entries, not 35 separate test cases.
The runner emits a non-fatal six-element fixture tuple warning. Chrome evidence
includes deliberate rejection cases and role visibility; it is internal verification,
not independent assurance. Conservation excludes authorized minting/reset. Earlier
public demo links and automatic previews are not proof of this version on DevNet.
-->

---

<!-- _class: dark -->

<div class="eyebrow">Work with the invited Canton team</div>

## Challenge the model, then help shape the pilot

<div class="three" style="margin-top:10px">
<div><h3>01 / Reproduce</h3><p class="muted">Run the three-minute demo and contract tests. Follow the real contract IDs and transaction evidence.</p></div>
<div><h3>02 / Review</h3><p class="muted">Check issuer trust, fund conservation, valuation lineage, timing races, and disclosure boundaries.</p></div>
<div><h3>03 / Improve</h3><p class="muted">Bring a better use case or new ideas. Help identify one operator and the smallest useful pilot.</p></div>
</div>

<div class="rule" style="border-color:#405267;margin-top:38px"><p class="small">Next pilot requirements: independent signing, an asset/custody integration, a valuation source, and an agreed operating workflow.</p></div>

<p class="small" style="margin-top:28px"><a href="https://github.com/no-witness-labs/veil-lite-hackathon">github.com/no-witness-labs/veil-lite-hackathon</a><br><a href="https://hackathon.appsfactory.cc/season-3">hackathon.appsfactory.cc/season-3</a></p>

<!--
Handoff files: docs/SEASON3-DEMO-SCRIPT.md and docs/SEASON3-AUDIT-HANDOFF.md.
No review work, institutional partnership, interview, or deployment is implied by
this invitation. We have prepared these artifacts for sharing; no outreach was sent.
-->
