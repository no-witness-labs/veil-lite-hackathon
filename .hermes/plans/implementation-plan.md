# Veil Hackathon MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a standalone hackathon-scoped Canton/Daml lending demo outside the existing production-oriented `lending/` directory.

**Architecture:** Start with a compact Daml package proving the lending lifecycle and privacy model. Then add a deterministic demo runner and a minimal role-based frontend.

**Tech Stack:** Daml, Daml Script, Node.js for demo API if needed, static browser frontend.

---

## Phase 1: Daml-only proof

### Task 1: Create Daml project skeleton

Files:

- Create: `daml.yaml`
- Create: `daml/Veil.daml`
- Create: `test/VeilTest.daml`

Verification:

```bash
dpm build
dpm test
```

### Task 2: Implement core templates

Templates:

- `LoanOffer`
- `Loan`
- `PriceFeed`
- simple local collateral lock representation

Verification:

```bash
dpm build
```

### Task 3: Implement happy-path test

Test:

- lender creates borrower-specific offer
- borrower accepts offer
- regulator visibility
- outsider non-visibility
- borrower repay

Verification:

```bash
dpm test
```

### Task 4: Implement optional liquidation test

Test:

- originate loan
- update price feed downward
- lender liquidates
- outsider still cannot see loan state

Verification:

```bash
dpm test
```

## Phase 2: Demo API

### Task 5: Create deterministic local workflow runner

Files:

- Create: `backend/package.json`
- Create: `backend/src/demo-state.mjs`
- Create: `backend/src/server.mjs`
- Create: `backend/test/demo-state.test.mjs`

Endpoints:

- `POST /demo/reset`
- `POST /demo/offer`
- `POST /demo/accept`
- `POST /demo/repay`
- `POST /demo/price-drop`
- `POST /demo/liquidate`
- `GET /demo/view/:role`

Verification:

```bash
npm --prefix backend test
```

## Phase 3: Judge-facing UI

### Task 6: Create static role-based UI

Files:

- Create: `frontend/index.html`
- Create: `frontend/src/app.js`
- Create: `frontend/styles.css`

Verification:

```bash
npm --prefix frontend run check
```

Manual demo path must complete in under 3 minutes.

## Phase 4: Submission docs

### Task 7: Add demo docs

Files:

- Create: `HACKATHON-DEMO.md`
- Update: `README.md`

Include:

- 3-minute pitch script
- click path
- architecture diagram
- honest production roadmap

Verification:

Read README from top to bottom and ensure a judge can run or understand the demo without context.
