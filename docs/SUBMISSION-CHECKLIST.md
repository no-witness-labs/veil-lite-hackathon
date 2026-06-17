# Encode Canton Hackathon Submission Checklist

This document tracks the exact submission requirements for the Build on Canton Hackathon.

## Submission requirements

### 1. Public repository

**Status:** Planned / required before submission.

**Deliverable:** A public GitHub repository for `veil-lite-hackathon`.

**Checklist:**

- [ ] Create or publish repo publicly.
- [ ] Include clear `README.md` with pitch, setup, demo flow, and honest scope.
- [ ] Include `docs/PRD.md`, `docs/CONTEXT.md`, and `docs/adr/0001-hackathon-scope.md`.
- [ ] Include build/test instructions.
- [ ] Include license if required.
- [ ] Confirm no secrets, private env files, or local credentials are committed.

**Recommended repo description:**

> Veil Lite — confidential bilateral secured lending on Canton, built for the Encode Build on Canton Hackathon.

---

### 2. Presentation deck

**Status:** Planned / required before submission.

**Deliverable:** 5–7 slide deck, exported as PDF.

**Recommended slides:**

1. **Problem** — Institutional lending cannot expose counterparties, terms, collateral, or liquidation state publicly.
2. **Solution** — Veil Lite: private bilateral secured lending on Canton.
3. **Why Canton** — stakeholder privacy, structural authorization, atomic workflows, selective regulator disclosure.
4. **Demo Flow** — known-counterparty lender offer → borrower accept → collateral lock → regulator observes → outsider sees nothing → repay/release.
5. **Architecture** — Daml contracts, demo runner/API, role-based UI.
6. **What Works Today** — Daml build/tests, privacy checks, local demo, optional liquidation branch.
7. **Roadmap** — Token Standard integration, wallet/external signing, PQS, production oracle/compliance.

**Deck acceptance criteria:**

- [ ] Explains the problem in under 30 seconds.
- [ ] Shows why Canton is necessary, not incidental.
- [ ] Includes a screenshot or flow diagram from the live demo.
- [ ] Clearly labels demo scope vs production roadmap.

---

### 3. 3 minute video pitch with demo

**Status:** Planned / required before submission.

**Deliverable:** A video link, ideally 2:30–3:00 minutes.

**Suggested timing:**

- **0:00–0:20 — Hook:** Public DeFi leaks institutional credit activity.
- **0:20–0:45 — Product:** Veil Lite is private bilateral secured lending on Canton.
- **0:45–2:15 — Demo:**
  1. Presenter explains lender and borrower already know each other.
  2. Lender creates borrower-specific offer.
  3. Borrower sees and accepts offer.
  4. Regulator sees active loan.
  5. Outsider sees nothing.
  6. Borrower repays and collateral releases.
  7. Optional quick branch: price drop/liquidation.
  8. Mention marketplace `LoanProgram` / `BorrowRequest` as next step.
- **2:15–2:40 — Canton value:** privacy, atomicity, selective disclosure.
- **2:40–3:00 — Roadmap/close:** Token Standard, wallet signing, PQS, production compliance.

**Video acceptance criteria:**

- [ ] Shows the app working, not just slides.
- [ ] Shows outsider non-visibility explicitly.
- [ ] Mentions Canton-specific privacy/authorization.
- [ ] Ends with a clear production roadmap.

---

### 4. Link to live product

**Status:** Planned / required before submission.

**Deliverable:** Public URL where judges can open the demo.

**Recommended options:**

1. **Static UI + deterministic demo state** hosted on Vercel/Netlify/GitHub Pages.
   - Best for reliability.
   - The UI can simulate the role views while linking to real Daml tests and repo proof.
2. **Hosted backend demo** on Render/Fly/Railway plus static frontend.
   - Better if the backend is stable.
   - More operational risk during judging.
3. **Local-first live product link** with a hosted frontend and clear local-run instructions.
   - Acceptable only if live backend is not feasible.

**Live product acceptance criteria:**

- [ ] URL opens without auth.
- [ ] Demo can be completed in under 3 minutes.
- [ ] Reset button works.
- [ ] Role switching is obvious.
- [ ] The app does not depend on private keys, local credentials, or fragile external infrastructure.

---

## Final submission readiness gate

Do not submit until all are true:

- [ ] Public repo URL exists.
- [ ] Deck PDF exists.
- [ ] 3 minute video URL exists.
- [ ] Live product URL exists.
- [ ] README includes all four links.
- [ ] Daml build/test commands pass.
- [ ] Demo script has been rehearsed end-to-end.
