# Veil Context

## Domain vocabulary

- **Party**: Canton/Daml on-ledger identity. In this MVP: `lender`, `borrower`, `regulator`, and `outsider`.
- **Lender**: Party offering principal to the borrower.
- **Borrower**: Party accepting credit and pledging collateral.
- **Regulator**: Optional observer who can view sensitive contracts but cannot act.
- **Outsider**: Party used in tests/UI to prove non-stakeholders cannot see private contracts.
- **Known Counterparty**: Lender and borrower already know each other before the on-ledger MVP flow starts. Discovery/relationship formation is out of scope.
- **Repo-style Financing**: Short-term secured financing where a borrower receives cash-like principal and pledges high-quality tokenized collateral. Veil uses this as the clearest demo story.
- **Principal Asset**: Cash-like asset the lender provides, for example USDC, Canton Coin, or a demo cash token.
- **Collateral Asset**: Tokenized asset pledged by the borrower, for example tokenized T-Bills, money-market fund units, fund shares, invoices, or other RWA claims.
- **Haircut / LTV**: Financing ratio between principal and collateral value. Demo target: 100 principal against 150 collateral value, or 66.7% LTV.
- **Loan Offer**: Borrower-specific lender proposal containing loan terms for a known borrower.
- **Loan Program**: Future extension where a lender publishes lending policy for borrower discovery. Not MVP scope.
- **Borrow Request**: Future extension where a borrower requests credit against a loan program. Not MVP scope.
- **Loan**: Active bilateral credit position after borrower acceptance.
- **Collateral Lock**: MVP representation of collateral being encumbered while the loan is active.
- **Lender-submitted Mark**: Current collateral value supplied by the lender to exercise the MVP liquidation branch. The Daml contract enforces the LTV breach; oracle-signed marks are production roadmap.
- **Repayment**: Borrower action that archives active loan and releases collateral.
- **Liquidation**: Lender action enabled when the submitted collateral mark makes the loan undercollateralized.

## Canton mental model

Do not explain Veil as Ethereum-style public global state. Explain it as:

- private contracts with stakeholder-based visibility;
- immutable contracts plus archive/create transitions;
- signatories for required authority;
- observers for intentional visibility;
- choices for authorized lifecycle transitions.

## Hackathon product principle

Every feature must help one of these judge-facing claims:

1. It works.
2. It demonstrates Canton privacy.
3. It demonstrates a real institutional repo/private-credit workflow with clear asset and financing logic.
4. It can be understood in a 3-minute video.

If a feature does not support one of those claims, defer it.

## Source references

- Canton official docs: https://docs.canton.network/
- Canton LLM docs index: https://docs.canton.network/llms.txt
- Encode programme: https://www.encodeclub.com/programmes/canton-hackathon
- Skills used to shape this scope:
  - grill-with-docs: stress-test terminology and decisions against docs/domain model.
  - to-prd: synthesize known context into a PRD without extended interviews.
