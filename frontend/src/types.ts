export type Role = 'lender' | 'borrower' | 'regulator' | 'outsider' | 'registry' | 'operator'

export type Status = 'none' | 'offered' | 'active' | 'repaid' | 'liquidated'

export type TemplateName = 'LoanOffer' | 'Loan' | 'LoanClosed' | 'Escrow' | 'Holding'

export interface InstrumentId {
  admin: string
  id: string
}

/** The Daml record fields across the deal templates and the Holding interface view. */
export interface DealArgs {
  // Deal templates
  lender?: string
  borrower?: string
  regulator?: string
  operator?: string
  principal?: string
  interest?: string
  collateralQuantity?: string
  maturity?: string
  cashAllocationCid?: string
  cashInstrumentId?: InstrumentId
  collateralInstrumentId?: InstrumentId
  reason?: string
  collateralReleased?: boolean
  // Holding interface view
  owner?: string
  instrumentId?: InstrumentId
  amount?: string
  lock?: unknown
}

/** A wallet holding owned by the active party (unlocked cash / collateral). */
export interface Holding {
  contractId: string
  kind: 'cash' | 'collateral'
  amount: number
  asset?: string
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
