# Veil Context

## Domain vocabulary

- **Party**: A participant's identity in Veil. The demo distinguishes lender, borrower, regulator, valuation agent, demo issuer, and outsider.
- **Lender**: Party offering principal to the borrower.
- **Borrower**: Party accepting credit and pledging collateral.
- **Regulator**: Optional observer who can view sensitive contracts but cannot act.
- **Demo Issuer**: Trusted authority for the demo's simulated cash and collateral. Its authorization establishes the asset's identity, not real-world backing; it sees the holdings and financing positions involving those assets.
- **Valuation Agent**: Agreed source of timestamped collateral prices, with access to price records but not the private loan terms.
- **Outsider**: Party used in tests/UI to prove non-stakeholders cannot see private contracts.
- **Known Counterparty**: Lender and borrower already know each other before the on-ledger MVP flow starts. Discovery/relationship formation is out of scope.
- **Repo-style Financing**: Short-term secured financing where a borrower receives cash-like principal and pledges high-quality tokenized collateral. Veil uses this as the clearest demo story.
- **Principal Asset**: Cash-like asset the lender provides, for example USDC, Canton Coin, or a demo cash token.
- **Collateral Asset**: Tokenized asset pledged by the borrower, for example tokenized T-Bills, money-market fund units, fund shares, invoices, or other RWA claims.
- **Haircut / LTV**: Financing ratio between principal and collateral value. Demo target: 100 principal against 150 collateral value, or 66.7% LTV.
- **Loan Offer**: Borrower-specific financing proposal that reserves the offered principal until acceptance or withdrawal.
- **Funding Escrow**: Principal reserved in an unaccepted loan offer. Acceptance delivers it to the borrower; withdrawal returns it to the lender, and only one can happen.
- **Loan Program**: Future extension where a lender publishes lending policy for borrower discovery. Not MVP scope.
- **Borrow Request**: Future extension where a borrower requests credit against a loan program. Not MVP scope.
- **Loan**: Active bilateral credit position after borrower acceptance.
- **Collateral Lock**: MVP representation of collateral being encumbered while the loan is active.
- **Attested Mark**: Timestamped unit price supplied by the agreed valuation agent. Its economic accuracy remains trusted.
- **Margin Call**: Notice of a collateral shortfall with an agreed deadline to cure it through a top-up or price recovery.
- **Repayment**: Borrower action that archives active loan and releases collateral.
- **Liquidation**: Transfer of locked collateral to the lender after an unresolved margin deadline or overdue repayment.

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
