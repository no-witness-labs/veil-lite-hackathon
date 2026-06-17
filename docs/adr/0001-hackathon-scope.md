# ADR 0001: Scope Veil Lite as a separate hackathon MVP

Date: 2026-06-15

## Status

Accepted for planning.

## Context

The existing `lending/` project is production-oriented and includes protocol, backend, frontend, local pilot, audit, and production readiness concerns. That is valuable but too broad for the Encode Build on Canton Hackathon.

The hackathon rewards technical execution, originality, user experience, and real-world applicability. It also requires a public repo, deck, 3-minute video, and live/demo product. A smaller standalone project is more likely to be completed and understood by judges.

## Decision

Create a new directory outside `lending/`:

```text
/Users/hoangvu/hade/no-witness-labs/canton/veil-lite-hackathon
```

The project will implement a focused Canton/Daml proof-of-concept for private bilateral secured lending.

Mandatory lifecycle:

1. Lender and borrower are known counterparties before the on-ledger flow.
2. Lender creates a borrower-specific `LoanOffer`.
3. Borrower accepts.
4. Active loan exists with collateral locked.
5. Regulator observes offer and loan.
6. Outsider cannot see borrower-specific offer or loan state.
7. Borrower repays and collateral releases.

Optional lifecycle:

- Oracle price drop enables lender liquidation.

## Consequences

Positive:

- Clearer hackathon scope.
- Faster implementation.
- Easier demo and judging.
- Less risk of production complexity blocking delivery.

Negative:

- Duplicates some concepts from `lending/`.
- MVP is not production-ready.
- Token Standard and wallet work will need a later integration path.

## Follow-up

If the MVP works, selectively backport ideas or integrate Token Standard pieces from `lending/` after the hackathon submission. The first product extension is `LoanProgram` + `BorrowRequest` for lender/borrower discovery.
