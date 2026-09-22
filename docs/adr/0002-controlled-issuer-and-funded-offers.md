# Controlled demo issuer and offers as funding escrow

Version 0.5.0 adds an independent demo issuer as a signatory to cash, collateral, offers, loans, and settlements. Owners can no longer construct assets or offers under that issuer's identity using only their own authority. The configured issuer is the client's trust anchor; collateral deposits and repayments must match the issuer recorded in the loan.

The `LoanOffer` itself represents escrow. `CashHolding.MakeOffer` consumes cash and creates the offer plus any change. Acceptance and withdrawal consume that same offer, releasing its principal exactly once. A separate escrow contract signed by the same issuer and lender would add linkage and synchronization work without strengthening the trust boundary against those signatories.

The issuer is a trusted mint authority. Co-signing a direct asset or offer creation remains privileged issuance, not proof that external funds were deposited. The conservation claim applies to normal spending choices between issuance and cooperative demo reset. Neither the lender, borrower, nor both together can mint under the configured issuer without its authorization. Normal choices inherit issuer authority from the consumed contracts; their submissions do not include issuer `actAs`.

The same demo issuer covers cash and collateral and sees the associated holdings and loan records. A real deployment needs authenticated, independently controlled issuance and custody, potentially with separate asset issuers. Valuer and outsider privacy remain as before. Local sandbox reset explicitly uses all required authorities and is not a business cancellation.

This is a fresh-environment change. Old holdings and loans are not migrated, and an issuer-controlled supply is still simulated inventory rather than live USDC or Treasury/MMF assets.
