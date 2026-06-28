# Veil — Private Repo-Style Financing on Canton

Checkpoint 2 presentation deck for the Encode Build on Canton Hackathon.

---

## 1. Problem

Institutional financing cannot safely run on fully transparent public ledgers.

Private credit, repo, OTC secured lending, and treasury financing involve sensitive data:

- borrower and lender identity;
- loan terms and pricing;
- collateral type and quantity;
- loan health and liquidation state;
- regulator/auditor visibility.

Public DeFi exposes too much. Traditional offchain workflows are private but fragmented across emails, PDFs, custodians, and reconciliation.

---

## 2. Solution

**Veil is private repo-style financing against tokenized collateral on Canton.**

A known lender privately offers short-term financing to a known borrower. The borrower pledges tokenized collateral, accepts the offer, receives principal, repays principal plus interest, and gets collateral released.

Canton coordinates the shared workflow while keeping visibility limited to the parties who need it.

---

## 3. Asset / Financing Logic

Canonical demo terms:

| Field | Value |
| --- | --- |
| Principal | 100 USDC-equivalent cash |
| Interest | 5 |
| Repayment | 105 |
| Collateral | 150 tokenized T-Bill/MMF units |
| Initial LTV | 66.7% |
| Maturity | 2026-07-13 |

The product logic is a real financing lifecycle:

```text
Create offer → Accept → Lock collateral → Deliver principal → Repay → Release collateral
```

Optional branch:

```text
Price drop → LTV breach → Lender liquidation
```

---

## 4. Why Canton

Canton gives the middle ground between public-chain leakage and offchain fragmentation:

- **Need-to-know privacy**: lender, borrower, and regulator can see the deal; outsider cannot.
- **Structural authorization**: signatories and controllers define who can create, accept, repay, or liquidate.
- **Atomic lifecycle transitions**: offer acceptance locks collateral and delivers principal in one ledger transaction.
- **Selective disclosure**: regulator/auditor observes without making the market public.

---

## 5. Demo Flow

3-minute judge flow:

1. Start local Canton sandbox and React UI.
2. Lender creates borrower-specific offer.
3. Borrower sees the offer.
4. Outsider sees nothing.
5. Borrower accepts; collateral locks and principal is delivered.
6. Regulator observes read-only.
7. Borrower repays; loan closes and collateral releases.
8. Optional: simulate price drop and lender liquidation.

Strongest proof moment: switch from Lender/Borrower view to Outsider and expand the raw ledger view — it returns `[]`.

---

## 6. What Works Today

Implemented in the repository:

- Daml templates for `CashHolding`, `CollateralHolding`, `LoanOffer`, `Loan`, `LoanClosed`, and `PriceFeed`.
- On-ledger asset movement for offer acceptance and repayment.
- On-ledger liquidation guard using price/LTV threshold.
- Daml Script lifecycle/privacy tests.
- React/Vite demo UI wired to Canton JSON Ledger API v2.
- Bootstrap scripts for local sandbox, party allocation, package upload, and demo config.

Verified commands:

```bash
dpm build
(cd test && dpm build && dpm test)
npm --prefix frontend run build
```

---

## 7. Roadmap

Post-hackathon production path:

- Replace demo assets with Canton token standard / Canton Coin integrations.
- Add external signing and production wallet flow.
- Move from single local sandbox to multi-participant Canton deployment.
- Add PQS/indexed reporting for regulated audit views.
- Add richer credit terms, margin calls, partial liquidation, and compliance workflows.

Hackathon scope is intentionally focused: prove private institutional financing coordination, not production token infrastructure.
