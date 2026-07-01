// View derivation — ported from the Claude design's renderVals(), but the loan
// status is derived from the contracts the active party can actually see on the
// ledger rather than from local UI state. The price-shock gate stays UI-only
// (no on-ledger oracle in the MVP).
import type { Contract, Draft, Role, Status } from './types'

export const ACCENT = '#2748d8'

export const PARTY_NAMES: Record<Role, string> = {
  lender: 'Meridian Capital',
  borrower: 'Northwind Treasury',
  regulator: 'Market Supervisor',
  outsider: 'Unknown party',
  registry: 'Token Registry',
  operator: 'ClearTrust Custody',
}

export const ROLE_LABELS: Record<Role, string> = {
  lender: 'Lender',
  borrower: 'Borrower',
  regulator: 'Regulator',
  outsider: 'Outsider',
  registry: 'Registry',
  operator: 'Custodian',
}

function defaultMaturity(): string {
  const d = new Date()
  d.setDate(d.getDate() + 90)
  return d.toISOString().slice(0, 10)
}

export const DEFAULT_DRAFT: Draft = {
  principal: 100,
  interest: 5,
  collateral: 150,
  maturity: defaultMaturity(),
}

export interface Tone {
  label: string
  color: string
  bg: string
  dot?: string
}

export const fmtMoney = (n: number) => `${n} USDC`

export function fmtDate(iso: string): string {
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getDate()} ${mo[d.getMonth()]} ${d.getFullYear()}`
}

export function daysTo(iso: string): number {
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
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
  return deal.args.reason === 'Liquidated' ? 'liquidated' : 'repaid'
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

export function ltvTone(ltv: number): Tone {
  if (ltv < 70) return { label: 'Within limit', color: '#1f7a4d', bg: '#e8f5ee', dot: '#2ea36a' }
  if (ltv < 90) return { label: 'Elevated', color: '#b7791f', bg: '#fdf3e0', dot: '#e09b2d' }
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
]

export const SIDEBAR_AVATAR: Record<Role, { bg: string; color: string; initials: string }> = {
  lender: { bg: '#eef2fe', color: '#2748d8', initials: 'MC' },
  borrower: { bg: '#f0eefb', color: '#6b46c1', initials: 'NT' },
  regulator: { bg: '#f0eefb', color: '#7c5cd6', initials: 'MS' },
  outsider: { bg: '#f4f5f7', color: '#aeb4be', initials: '?' },
  registry: { bg: '#eef6f3', color: '#1f7a4d', initials: 'TR' },
  operator: { bg: '#eef4f8', color: '#2c6e8a', initials: 'CC' },
}

export const ROLE_DOT: Record<Role, string> = {
  lender: ACCENT,
  borrower: '#6b46c1',
  regulator: '#7c5cd6',
  outsider: '#aeb4be',
  registry: '#1f7a4d',
  operator: '#2c6e8a',
}

export const EXPLAINER: Record<Role, { sees: string; can: string }> = {
  lender: {
    sees: 'The complete contract — terms, collateral, the borrower’s identity, and live lifecycle status.',
    can: 'Create or withdraw offers, and liquidate collateral if the loan breaches its LTV limit.',
  },
  borrower: {
    sees: 'The offer extended to you, your locked collateral, and your repayment obligation.',
    can: 'Accept an open offer to draw funds, and repay to release your collateral.',
  },
  regulator: {
    sees: 'The full contract, via observer rights explicitly granted by the counterparties.',
    can: 'Nothing — a regulator observes but cannot transact. Disclosure is opt-in and fully auditable.',
  },
  outsider: {
    sees: 'Nothing. This party is not a stakeholder on the contract and cannot tell it exists.',
    can: 'Nothing.',
  },
  registry: {
    sees:
      'Every token it issued — admin on all holdings, the SimpleTokenRules factory, and mint/allocation activity across the ledger. It does not see the loan itself.',
    can:
      'Nothing on the loan itself — the registry is the token issuer, not a lending counterparty. It co-signs mints and runs the allocation factory.',
  },
  operator: {
    sees:
      'Only the collateral it holds in escrow (the Escrow contract + the collateral token). It cannot see the offer or the loan terms — principal, interest, and LTV stay private to the lender and borrower.',
    can:
      'Custody only: it holds the collateral and releases it as the loan directs (back to the borrower on repay, to the lender on default). It cannot lend, borrow, or view the deal.',
  },
}

/** Numbers shown on the deal card / form, accounting for the UI price shock. */
export function dealNumbers(args: { principal: number; interest: number; collateral: number }, shock: boolean) {
  const unitPrice = shock ? 0.62 : 1.0
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
