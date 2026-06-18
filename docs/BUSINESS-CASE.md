# Veil Business Case

## One-line thesis

Veil is **private repo-style financing against tokenized collateral on Canton**.

A known borrower pledges tokenized collateral, such as tokenized Treasury bills, money-market fund units, fund shares, invoices, or other real-world asset claims, to receive short-term financing from a known lender. Canton coordinates the offer, acceptance, collateral lock, repayment, and selective regulator visibility without exposing the deal publicly.

## Evaluation against hackathon criteria

| Criteria | Veil fit | Notes |
| --- | --- | --- |
| Strong real-world business relevance | Strong | Maps to institutional repo, private credit, OTC secured lending, treasury financing, and RWA-backed credit. |
| Clear asset / financing logic | Strong if explicit | The demo must show principal asset, collateral asset, haircut/LTV, repayment amount, and collateral release. |
| Practical workflow design | Strong | Known-counterparty execution is realistic for institutional lending and avoids fake marketplace discovery scope. |
| Tokenization/onchain coordination genuinely helps | Strong | Tokenized collateral and loan state are coordinated across lender, borrower, and regulator with Canton privacy. |

## Recommended concrete demo story

Use a private repo-style financing example rather than generic lending:

```text
Borrower owns tokenized Treasury/MMF collateral
        ↓
Lender privately offers 100 USDC principal
        ↓
Borrower pledges 150 tokenized T-Bill/MMF units
        ↓
Borrower accepts; collateral is locked in the loan state
        ↓
Regulator/auditor can observe the deal
        ↓
Outsider sees nothing
        ↓
Borrower repays 105 USDC
        ↓
Loan closes and collateral is released
```

Suggested demo numbers:

| Field | Value |
| --- | --- |
| Principal asset | USDC or Canton-network cash-like token |
| Principal amount | 100 |
| Interest | 5 |
| Repayment amount | 105 |
| Collateral asset | Tokenized T-Bill/MMF units |
| Collateral quantity/value | 150 |
| Initial LTV | 66.7% |
| Maturity | 2026-07-13 |

## Why this belongs on Canton

A public-chain version leaks exactly what institutional counterparties need to protect: borrower identity, lender identity, terms, collateral, health, and liquidation timing.

A purely offchain workflow is private but fragmented across emails, PDFs, spreadsheets, custodians, and reconciliation processes.

Canton gives the middle ground:

- shared workflow state among the relevant parties;
- structural authorization through signatories/controllers;
- need-to-know visibility through stakeholders/observers;
- selective disclosure to regulator/auditor;
- no Ethereum-style global readable state.

## MVP boundary

Veil is not trying to solve borrower/lender discovery in the MVP. It assumes lender and borrower already know each other and focuses on private execution and coordination.

Future marketplace extension:

```text
LoanProgram -> BorrowRequest -> LoanOffer -> Accept -> Loan
```

That extension is valid, but it should come after the core asset-financing lifecycle is working and demoable.
