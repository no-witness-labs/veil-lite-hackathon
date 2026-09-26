export type Role = 'lender' | 'borrower' | 'regulator' | 'valuer' | 'outsider'

export type SessionRole = Role | 'operator'

export interface Session {
  role: SessionRole
  userId: string
  expiresAt: number
}

export type Status = 'none' | 'offered' | 'active' | 'repaid' | 'liquidated'

export type TemplateName =
  | 'LoanOffer'
  | 'Loan'
  | 'LoanClosed'
  | 'CashHolding'
  | 'CollateralHolding'
  | 'ValuationStream'
  | 'CollateralValuation'
  | 'SubstitutionRequest'

/** The valuation record attached to an active margin-call workflow. */
export interface MarginCall {
  issuedAt: string
  deadline: string
  unitPrice: string
}

/** The Daml record fields across the deal templates and the holdings. */
export interface DealArgs {
  issuer?: string
  // Deal templates
  lender?: string
  borrower?: string
  regulator?: string
  valuationAgent?: string
  valuationStreamId?: string
  streamId?: string
  principal?: string
  interest?: string
  collateralAsset?: string
  collateralQuantity?: string
  liquidationThresholdLtv?: string
  marginCallWindowSeconds?: string | number
  marginCall?: MarginCall | null
  unitPrice?: string
  observedAt?: string
  maturity?: string
  collateralLocked?: boolean
  reason?: string
  collateralReleased?: boolean
  amountRepaid?: string | null
  // Substitution request
  releaseAsset?: string
  releaseQuantity?: string
  newAsset?: string
  newQuantity?: string
  newValuationStreamId?: string
  // Holdings
  owner?: string
  amount?: string
  asset?: string
  quantity?: string
}

/** A wallet holding owned by the active party (its own cash / collateral). */
export interface Holding {
  contractId: string
  kind: 'cash' | 'collateral'
  amount: number
  asset?: string
  issuer?: string
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

/** Ledger-attested collateral mark. Valuers can see these records without
 * receiving the private loan contracts that they are used to price. */
export interface Valuation {
  contractId: string
  unitPrice: number
  observedAt: string
  valuationAgent: string
  lender: string
  borrower: string
  regulator: string
  collateralAsset: string
  streamId: string
  offset: number
}

export type ValuationStatus = 'missing' | 'ambiguous' | 'invalid' | 'future' | 'stale' | 'healthy' | 'at-threshold' | 'breached'

export interface ValuationAssessment {
  status: ValuationStatus
  message: string
  mark?: Valuation
  collateralValue?: number
  ltv?: number
  ageMs?: number
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
