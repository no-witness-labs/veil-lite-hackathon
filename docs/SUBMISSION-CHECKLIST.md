# Encode Canton Hackathon Submission Checklist

This document tracks the exact submission requirements for the Build on Canton Hackathon.

## Submission requirements

### 1. Public repository

**Status:** Public; final submission links complete.

**Deliverable:** A public GitHub repository for `veil`.

**Checklist:**

- [x] Create or publish repo publicly.
- [x] Include clear `README.md` with pitch, setup, demo flow, and honest scope.
- [x] Include `docs/PRD.md`, `docs/CONTEXT.md`, and `docs/adr/0001-hackathon-scope.md`.
- [x] Include build/test instructions.
- [ ] Include license if required (no license selected yet; owner decision pending).
- [x] Confirm no tracked secrets, private env files, or local credentials are committed.

**Recommended repo description:**

> Veil — confidential bilateral secured lending on Canton, built for the Encode Build on Canton Hackathon.

**Latest verification (2026-07-02):** repository is public; tracked-file
secret-pattern scan returned no matches; final submission links are present.

---

### 2. Presentation deck

**Status:** Complete.

**Deliverable:** Concise 7–10 slide deck, exported as PDF.

**Recommended sections:**

1. **Problem** — Institutional repo/private-credit workflows need shared coordination but cannot expose counterparties, terms, collateral, or liquidation state publicly.
2. **Solution + Asset Logic** — Veil: private repo-style financing against tokenized collateral; 100 USDC-equivalent principal, 5 interest, 105 repayment, 150 tokenized T-Bill/MMF collateral units, 66.7% initial LTV.
3. **Why Canton** — stakeholder privacy, structural authorization, atomic workflows, selective regulator disclosure.
4. **Demo Flow** — known-counterparty lender offer → borrower accept → collateral lock → regulator observes → outsider sees nothing → repay/release.
5. **Architecture** — Daml contracts, demo runner/API, role-based UI.
6. **What Works Today** — Daml build/tests, privacy checks, local demo, optional liquidation branch.
7. **Roadmap** — Token Standard integration, wallet/external signing, PQS, production oracle/compliance.

**Deck acceptance criteria:**

- [x] Explains the problem in under 30 seconds.
- [x] Shows why Canton is necessary, not incidental.
- [x] Includes a screenshot or flow diagram from the live demo.
- [x] Clearly labels demo scope vs production roadmap.

---

### 3. 3 minute video pitch with demo

**Status:** Complete.

**Deliverable:** A video link, ideally 2:30–3:00 minutes.

**Pitch video:** <https://no-witness-labs.github.io/veil-lite-hackathon/veil-pitch-video.mp4>

**Latest verification (2026-07-02):** hosted MP4 returned HTTP 200 as
`video/mp4`; local duration is 152.8 seconds.

**Recording script:** [`PITCH-VIDEO-SCRIPT.md`](./PITCH-VIDEO-SCRIPT.md)

**Live product opened for recording:** <https://veil-lite-hackathon.vercel.app/>

**Exact take flow:** Reset demo → Lender creates offer → Borrower accepts → Regulator shows read-only observer → Outsider expands raw view and shows `[]` → Borrower repays 105 USDC → close with roadmap.

**Suggested timing:**

- **0:00–0:20 — Hook:** Public DeFi leaks institutional credit activity.
- **0:20–0:45 — Product:** Veil is private repo-style financing against tokenized collateral on Canton.
- **0:45–2:15 — Demo:**
  1. Presenter explains lender and borrower already know each other.
  2. Lender creates borrower-specific offer: 100 USDC-equivalent principal, 5 interest, 150 tokenized T-Bill/MMF collateral units.
  3. Borrower sees and accepts offer.
  4. Regulator sees active loan.
  5. Outsider sees nothing.
  6. Borrower repays and collateral releases.
  7. Optional quick branch: price drop/liquidation.
  8. Mention marketplace `LoanProgram` / `BorrowRequest` as next step.
- **2:15–2:40 — Canton value:** privacy, atomicity, selective disclosure.
- **2:40–3:00 — Roadmap/close:** Token Standard, wallet signing, PQS, production compliance.

**Video acceptance criteria:**

- [x] Shows the app working, not just slides.
- [x] Shows outsider non-visibility explicitly.
- [x] Mentions Canton-specific privacy/authorization.
- [x] Ends with a clear production roadmap.
- [x] Recording script and click path are ready.

---

### 4. Link to live product

**Status:** Vercel DevNet deployment prepared; production URL pending.

**Deliverable:** Public URL where judges can open the demo.

**Live product URL:** <https://veil-lite-hackathon.vercel.app/>

**Selected deployment:**

- **Vercel live DevNet app** — Vite frontend plus serverless `/v2` proxy to the
  Seaport/Five North DevNet Ledger API.
- The proxy injects OIDC client-credentials auth server-side; secrets stay in
  Vercel environment variables.
- `/ledger-config.json` is served from Vercel env vars and points the app at the
  `veil-lite` package and bootstrapped DevNet parties.

**Live product acceptance criteria:**

- [ ] Vercel URL opens without auth.
- [x] Demo can be completed in under 3 minutes.
- [x] Reset button works against the configured ledger parties.
- [x] Role switching is obvious.
- [x] Browser does not receive private keys, client secrets, or bearer tokens.

**Latest verification (2026-07-03):** DevNet package `veil-lite-0.1.0.dar`
deployed, parties bootstrapped, `CanActAs` granted to user `6`, seeded holdings
created, local DevNet proxy returned HTTP 200 for `/v2/state/ledger-end` and a
borrower active-contracts query. Vercel production URL has been added; deployment
protection must be disabled before final public verification.

---

## Definition of complete for hackathon

Do not submit until all gates are true.

### Product / judge-readiness gate

- [x] Demo clearly uses privacy/confidentiality: lender, borrower, and regulator can see the deal; outsider cannot see offer, loan, collateral state, or liquidation-relevant data.
- [x] Demo is a real financial use case: private repo-style financing/private credit against tokenized collateral.
- [x] Product logic is clear: offer → accept → collateral lock → repayment → collateral release, with optional liquidation.
- [x] Institutional/professional relevance is explicit: treasury financing, repo, OTC secured lending, asset managers, auditors, or regulated private credit.

### Functional demo gate

- [x] Lender can create a borrower-specific offer with 100 USDC-equivalent principal, 5 interest, 105 repayment, 150 tokenized T-Bill/MMF collateral units, and 66.7% initial LTV.
- [x] Borrower can accept the offer and create an active loan.
- [x] Collateral is represented as locked/encumbered while the loan is active.
- [x] Borrower can repay and release collateral.
- [x] Regulator/auditor role can observe but cannot act.
- [x] Outsider role has an explicit empty/non-visible view.
- [x] Optional bonus: simulated price drop / lender-submitted mark enables demo liquidation.

### Engineering gate

- [x] Daml build/test commands pass.
- [x] Tests include lifecycle and privacy checks.
- [x] Tests include the concrete asset/financing numbers or equivalent fixture.
- [x] Frontend can run locally or via hosted link.
- [x] Demo script has been rehearsed end-to-end in under 3 minutes.

**Latest verification (2026-07-01):** `dpm build`, `dpm build` in `test/`,
`dpm test` in `test/`, and `npm --prefix frontend run build` passed. The test
package still emits the existing tuple-size warning in `daml/Veil/Test.daml`.

### Submission gate

- [x] Public repo URL exists.
- [x] Deck PDF exists.
- [x] 3-minute video URL exists.
- [ ] Live product URL is published and verified.
- [x] README includes public repo, live product, deck, and final video links.
- [x] README includes final 3-minute video URL.
- [x] README is honest about MVP scope and non-goals.
