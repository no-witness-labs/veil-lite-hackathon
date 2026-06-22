export type Role = 'lender' | 'borrower' | 'regulator' | 'outsider'

export type Status = 'none' | 'offered' | 'active' | 'repaid' | 'liquidated'

export type TemplateName = 'LoanOffer' | 'Loan' | 'LoanClosed'

/** The Daml record fields shared across LoanOffer / Loan / LoanClosed. */
export interface DealArgs {
  lender: string
  borrower: string
  regulator: string
  principal: string
  interest: string
  collateralAsset: string
  collateralQuantity: string
  maturity: string
  // Loan-only
  collateralLocked?: boolean
  // LoanClosed-only
  reason?: string
  collateralReleased?: boolean
}

/** A normalized active contract as seen by the querying party. */
export interface Contract {
  contractId: string
  template: TemplateName
  offset: number
  args: DealArgs
}

/** Editable terms for a new offer. */
export interface Draft {
  principal: number
  interest: number
  collateral: number
  maturity: string
}

/** Parsed result of a committed ledger transaction — the on-ledger evidence. */
export interface TxResult {
  updateId: string
  offset: number
  synchronizerId: string
  created: { template: string; contractId: string }[]
  archived: { template: string; contractId: string }[]
}

/** One row in the session activity feed. */
export interface ActivityEntry {
  key: string
  action: string
  actor: string
  result: TxResult
}

/** What listActive returns: parsed contracts plus the raw ledger JSON. */
export interface ActiveState {
  contracts: Contract[]
  raw: unknown[]
  offset: number
}
