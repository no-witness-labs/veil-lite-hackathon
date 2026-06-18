# Veil — Confidential Lending on Canton

> Hackathon-scoped Canton app for the Encode Build on Canton Hackathon.

Veil is a deliberately small proof-of-concept for **private bilateral secured lending** on Canton.
A lender and borrower are assumed to already know each other; the lender privately offers a loan, the borrower accepts, collateral is locked, and only the lender, borrower, and optional regulator can see the resulting position.

## Why this exists

Institutional lending cannot expose borrower identity, lender identity, terms, positions, collateral, or liquidation state to a public chain. Canton is a strong fit because it gives us:

- **Need-to-know privacy**: contracts are visible only to signatories/observers.
- **Structural authorization**: signatories/controllers define who must authorize each lifecycle step.
- **Atomic multi-party workflows**: origination and settlement can be modeled as one transaction.
- **Selective disclosure**: a regulator/auditor can observe without making the market public.

## Hackathon scope

Build the smallest judge-friendly flow that proves Canton's advantage:

1. Lender and borrower already know each other from an off-ledger private credit relationship.
2. Lender creates a private borrower-specific `LoanOffer`.
3. Borrower accepts and opens a loan.
4. Borrower's collateral becomes locked/escrowed in the loan state.
5. Regulator can observe the offer and loan.
6. Outsider cannot see either offer or loan.
7. Borrower repays and collateral is released.
8. Optional demo branch: oracle price drops and lender liquidates.
9. Future extension: lender publishes `LoanProgram`, borrower creates `BorrowRequest`, then lender offers.

## Non-goals for hackathon

- Production Token Standard integration with real external providers.
- Wallet Gateway / external signing UX.
- PQS dashboard and production indexing.
- k-of-n oracle network.
- Partial liquidation, reserves, bad debt tranching.
- Real institution onboarding/compliance workflows.
- Mainnet/TestNet deployment guarantees.

## Submission requirements

This project explicitly tracks the Encode submission requirements in [`docs/SUBMISSION-CHECKLIST.md`](./docs/SUBMISSION-CHECKLIST.md):

- **Public repository** — publish this directory as a public GitHub repo with setup/demo docs.
- **Presentation deck** — create a 5–7 slide deck covering problem, solution, why Canton, demo flow, architecture, current status, and roadmap.
- **3 minute video pitch with demo** — record known-counterparty lender offer → borrower accept → regulator observes → outsider sees nothing → repay/release.
- **Link to live product** — host a judge-friendly role-based demo URL, preferably static and reliable.

## Daml development

This repo uses Daml SDK `3.5.1` and Daml-LF target `2.1` for Canton-oriented development.

```bash
dpm build
dpm test
```

If `dpm` is not installed, install/activate the Canton/Daml SDK first, then rerun the commands above.

## Directory map

```text
veil/
├── README.md
├── daml.yaml
├── daml/
│   ├── Veil.daml
│   └── Veil/
│       └── Test.daml
├── docs/
│   ├── PRD.md
│   ├── CONTEXT.md
│   ├── GRILL.md
│   ├── SUBMISSION-CHECKLIST.md
│   └── adr/
│       └── 0001-hackathon-scope.md
└── .hermes/
    └── plans/
        └── implementation-plan.md
```
