// View derivation — ported from the Claude design's renderVals(), but the loan
// status is derived from the contracts the active party can actually see on the
// ledger rather than from local UI state. Price marks and margin-call details
// are read from the contracts visible to the active party.
import type { Contract, Draft, MarginCall, Role, Status, Valuation, ValuationAssessment } from './types'

export const ACCENT = '#2748d8'

export const PARTY_NAMES: Record<Role, string> = {
  lender: 'Meridian Capital',
  borrower: 'Northwind Treasury',
  regulator: 'Market Supervisor',
  valuer: 'Independent Valuation Agent',
  outsider: 'Unknown party',
}

export const ROLE_LABELS: Record<Role, string> = {
  lender: 'Lender',
  borrower: 'Borrower',
  regulator: 'Regulator',
  valuer: 'Valuer',
  outsider: 'Outsider',
}

export const DEFAULT_DRAFT: Draft = {
  principal: 100,
  interest: 5,
  collateral: 150,
  maturity: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
}

export interface Tone {
  label: string
  color: string
  bg: string
  dot?: string
}

export const fmtMoney = (n: number) => `${n} USDC`

function parseLedgerTime(value: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value
  return new Date(normalized)
}

export function fmtDate(iso: string): string {
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const d = parseLedgerTime(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getUTCDate()} ${mo[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Display the exact maturity instant stored on the ledger, in UTC. */
export function fmtUtcTime(iso: string): string {
  const d = parseLedgerTime(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export function daysTo(iso: string): number {
  const d = parseLedgerTime(iso)
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  if (Number.isNaN(d.getTime())) return Number.NaN
  return Math.round((d.getTime() - todayUtc) / 86400000)
}

/** The contract that defines the party's current view: the most recently
 * created LoanOffer / Loan / LoanClosed. Lets the demo be re-run cleanly. */
export function currentDeal(contracts: Contract[]): Contract | undefined {
  const relevant = contracts.filter(
    (c) => c.template === 'LoanOffer' || c.template === 'Loan' || c.template === 'LoanClosed',
  )
  if (relevant.length === 0) return undefined
  return relevant.reduce((a, b) => (b.offset > a.offset ? b : a))
}

export function statusOf(deal: Contract | undefined): Status {
  if (!deal) return 'none'
  if (deal.template === 'LoanOffer') return 'offered'
  if (deal.template === 'Loan') return 'active'
  return deal.args.reason === 'Liquidated' || deal.args.reason === 'LiquidatedAtMaturity' ? 'liquidated' : 'repaid'
}

export function marginCallOf(deal: Contract | undefined): MarginCall | undefined {
  if (!deal || deal.template !== 'Loan') return undefined
  const call = deal.args.marginCall
  if (!call || typeof call !== 'object') return undefined
  if (typeof call.issuedAt !== 'string' || typeof call.deadline !== 'string') return undefined
  return { issuedAt: call.issuedAt, deadline: call.deadline, unitPrice: String(call.unitPrice) }
}

export function valuationCandidates(contracts: Contract[], deal?: Contract): Valuation[] {
  if (deal && typeof deal.args.valuationStreamId !== 'string') return []
  return contracts
    .filter((contract) => {
      if (contract.template !== 'CollateralValuation') return false
      if (typeof contract.args.streamId !== 'string') return false
      if (deal && contract.args.streamId !== deal.args.valuationStreamId) return false
      if (!deal) return true
      return contract.args.collateralAsset === deal.args.collateralAsset
        && contract.args.lender === deal.args.lender
        && contract.args.borrower === deal.args.borrower
        && contract.args.regulator === deal.args.regulator
        && contract.args.valuationAgent === deal.args.valuationAgent
    })
    .map((contract): Valuation | undefined => {
      const unitPrice = Number(contract.args.unitPrice)
      if (!Number.isFinite(unitPrice)) return undefined
      return {
        contractId: contract.contractId,
        unitPrice,
        observedAt: contract.args.observedAt ?? '',
        valuationAgent: contract.args.valuationAgent ?? '',
        lender: contract.args.lender ?? '',
        borrower: contract.args.borrower ?? '',
        regulator: contract.args.regulator ?? '',
        collateralAsset: contract.args.collateralAsset ?? '',
        streamId: contract.args.streamId ?? '',
        offset: contract.offset,
      }
    })
    .filter((mark): mark is Valuation => Boolean(mark))
}

export function valuationFor(contracts: Contract[], deal?: Contract): Valuation | undefined {
  const marks = valuationCandidates(contracts, deal)
  // A stream has exactly one active mark because Publish consumes and replaces
  // its predecessor. Treat a missing or parallel mark as an invalid current
  // valuation instead of silently choosing by offset.
  return marks.length === 1 && marks[0].streamId ? marks[0] : undefined
}

export function assessValuation(
  candidates: Valuation[],
  principal: number,
  collateral: number,
  threshold: number,
  now = Date.now(),
): ValuationAssessment {
  if (candidates.length === 0) return { status: 'missing', message: 'No matching ledger valuation mark is available.' }
  if (candidates.length > 1) return { status: 'ambiguous', message: 'Multiple matching valuation marks are visible; reset or publish a single current mark.' }

  const mark = candidates[0]
  const observedMs = Date.parse(mark.observedAt)
  const ageMs = now - observedMs
  if (!Number.isFinite(observedMs)) return { status: 'invalid', message: 'The valuation timestamp is invalid; publish a fresh mark.', mark }
  if (ageMs < 0) return { status: 'future', message: 'The valuation is future-dated; synchronize the browser and ledger clocks.', mark, ageMs }
  if (ageMs > 5 * 60 * 1000) return { status: 'stale', message: 'The valuation is stale; publish a fresh mark before proceeding.', mark, ageMs }

  if (!Number.isFinite(mark.unitPrice) || mark.unitPrice <= 0 || !Number.isFinite(principal) || principal <= 0 || !Number.isFinite(collateral) || collateral <= 0 || !Number.isFinite(threshold) || threshold <= 0) {
    return { status: 'invalid', message: 'Enter positive principal and collateral terms with a valid liquidation threshold.', mark, ageMs }
  }
  const collateralValue = collateral * mark.unitPrice
  const ltv = collateralValue > 0 ? (principal / collateralValue) * 100 : Number.POSITIVE_INFINITY
  if (!Number.isFinite(collateralValue) || !Number.isFinite(ltv)) {
    return { status: 'invalid', message: 'The valuation cannot price these collateral terms.', mark, collateralValue, ltv, ageMs }
  }
  const difference = ltv - threshold
  if (Math.abs(difference) <= 1e-9) {
    return { status: 'at-threshold', message: `Current LTV is exactly ${threshold.toFixed(1)}%; the ledger requires it to remain strictly below the threshold.`, mark, collateralValue, ltv, ageMs }
  }
  if (difference > 0) {
    return { status: 'breached', message: `Current LTV is ${ltv.toFixed(1)}%, above the ${threshold.toFixed(1)}% liquidation threshold.`, mark, collateralValue, ltv, ageMs }
  }
  return { status: 'healthy', message: `Fresh mark supports ${ltv.toFixed(1)}% LTV, below the ${threshold.toFixed(1)}% threshold.`, mark, collateralValue, ltv, ageMs }
}

export const STATUS_TONE: Record<Status, Tone> = {
  none: { label: 'No offer', color: '#5b6472', bg: '#f4f5f7' },
  offered: { label: 'Offered', color: '#2748d8', bg: '#eef2fe' },
  active: { label: 'Active', color: '#b7791f', bg: '#fdf3e0' },
  repaid: { label: 'Repaid', color: '#1f7a4d', bg: '#e8f5ee' },
  liquidated: { label: 'Liquidated', color: '#c0392b', bg: '#fbeae8' },
}

export function lockTone(status: Status): Tone {
  switch (status) {
    case 'active':
      return { label: 'LOCKED', color: '#b7791f', bg: '#fdf3e0', dot: '#e09b2d' }
    case 'repaid':
      return { label: 'RELEASED', color: '#1f7a4d', bg: '#e8f5ee', dot: '#2ea36a' }
    case 'liquidated':
      return { label: 'LIQUIDATED', color: '#c0392b', bg: '#fbeae8', dot: '#d94b3a' }
    default:
      return { label: 'NOT LOCKED', color: '#8a929e', bg: '#f4f5f7', dot: '#cfd4dc' }
  }
}

export function ltvTone(ltv: number, threshold = 90): Tone {
  if (ltv < threshold * 0.78) return { label: 'Within limit', color: '#1f7a4d', bg: '#e8f5ee', dot: '#2ea36a' }
  if (ltv < threshold) return { label: 'Elevated', color: '#b7791f', bg: '#fdf3e0', dot: '#e09b2d' }
  return { label: 'Breach', color: '#c0392b', bg: '#fbeae8', dot: '#d94b3a' }
}

export interface PartyDef {
  key: Role
  role: string
  sub: string
  initials: string
  avatarBg: string
  avatarColor: string
}

export const PARTY_DEFS: PartyDef[] = [
  { key: 'lender', role: 'Lender', sub: 'Meridian Capital', initials: 'MC', avatarBg: '#eef2fe', avatarColor: '#2748d8' },
  { key: 'borrower', role: 'Borrower', sub: 'Northwind Treasury', initials: 'NT', avatarBg: '#f0eefb', avatarColor: '#6b46c1' },
  { key: 'regulator', role: 'Regulator', sub: 'Market Supervisor', initials: 'MS', avatarBg: '#f0eefb', avatarColor: '#7c5cd6' },
  { key: 'valuer', role: 'Valuer', sub: 'Independent Valuation Agent', initials: 'VA', avatarBg: '#eaf7f4', avatarColor: '#197d69' },
]

export const SIDEBAR_AVATAR: Record<Role, { bg: string; color: string; initials: string }> = {
  lender: { bg: '#eef2fe', color: '#2748d8', initials: 'MC' },
  borrower: { bg: '#f0eefb', color: '#6b46c1', initials: 'NT' },
  regulator: { bg: '#f0eefb', color: '#7c5cd6', initials: 'MS' },
  valuer: { bg: '#eaf7f4', color: '#197d69', initials: 'VA' },
  outsider: { bg: '#f4f5f7', color: '#aeb4be', initials: '?' },
}

export const ROLE_DOT: Record<Role, string> = {
  lender: ACCENT,
  borrower: '#6b46c1',
  regulator: '#7c5cd6',
  valuer: '#197d69',
  outsider: '#aeb4be',
}

export const EXPLAINER: Record<Role, { sees: string; can: string }> = {
  lender: {
    sees: 'The complete contract, its ledger-attested collateral mark, and any open margin-call deadline.',
    can: 'Create or withdraw offers, issue a margin call on a fresh breach, and liquidate after the deadline.',
  },
  borrower: {
    sees: 'The offer extended to you, your locked collateral, a fresh attested mark, and any margin-call deadline.',
    can: 'Accept an offer, top up an open call with an exact holding, resolve a recovered call, or repay.',
  },
  regulator: {
    sees: 'The full contract and ledger-attested valuations, via observer rights explicitly granted by the parties.',
    can: 'Nothing — a regulator observes but cannot transact. Disclosure is opt-in and fully auditable.',
  },
  valuer: {
    sees: 'Only valuation records you signed. The loan terms, amounts, and margin-call state remain outside your view.',
    can: 'Publish a manually attested unit price for the known demo deal; the ledger enforces freshness and identity checks.',
  },
  outsider: {
    sees: 'Nothing. This party is not a stakeholder on the contract and cannot tell it exists.',
    can: 'Nothing.',
  },
}

/** Numbers shown on the deal card, using only the latest ledger-attested mark. */
export function dealNumbers(args: { principal: number; interest: number; collateral: number }, unitPrice = 1.0) {
  const collateralValue = args.collateral * unitPrice
  const ltv = collateralValue > 0 ? (args.principal / collateralValue) * 100 : 0
  const repayment = args.principal + args.interest
  return { unitPrice, collateralValue, ltv, repayment }
}

export const STEP_LABELS = (status: Status): string[] => [
  'No offer',
  'Offered',
  'Active',
  status === 'liquidated' ? 'Liquidated' : 'Repaid',
]

export const STEP_INDEX: Record<Status, number> = {
  none: 0,
  offered: 1,
  active: 2,
  repaid: 3,
  liquidated: 3,
}
