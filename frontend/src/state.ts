// View derivation. The loan status is derived from the contracts the active
// party can actually see on the ledger rather than from local UI state — that
// is what makes the Outsider view genuinely empty. Price marks and margin-call
// details are read from the contracts visible to the active party.
//
// Nothing here emits colour literals: every visual decision is expressed as a
// semantic `Tone`, which the primitives map onto tokens.
import type { Tone } from './ui/primitives'
import type { Contract, Draft, MarginCall, Role, Status, Valuation, ValuationAssessment } from './types'

/** Every demo amount is simulated; the unit says so wherever a figure appears. */
export const UNIT_CASH = 'simulated USDC'

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

export const ROLE_TONE: Record<Role, Tone> = {
  lender: 'accent',
  borrower: 'info',
  regulator: 'warn',
  valuer: 'sky',
  outsider: 'neutral',
}

/** Swatch colours for the role switcher. Token references, not literals. */
export const ROLE_SWATCH: Record<Role, string> = {
  lender: 'var(--accent)',
  borrower: 'var(--info)',
  regulator: 'var(--warn)',
  valuer: 'var(--sky)',
  outsider: 'var(--ink-300)',
}

export const ROLE_INITIALS: Record<Role, string> = {
  lender: 'MC',
  borrower: 'NT',
  regulator: 'MS',
  valuer: 'VA',
  outsider: '?',
}

export const ROLES: Role[] = ['lender', 'borrower', 'regulator', 'valuer', 'outsider']

export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role)

export const DEFAULT_DRAFT: Draft = {
  principal: 100,
  interest: 5,
  collateral: 150,
  maturity: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
}

/* ------------------------------------------------------------ formatting -- */

/** Fixed-precision amount for column alignment. Unit is rendered separately. */
export const fmtAmount = (n: number, dp = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

export const fmtPct = (n: number, dp = 1) => `${n.toFixed(dp)}%`

export const fmtMoney = (n: number) => `${fmtAmount(n)} ${UNIT_CASH}`

function parseLedgerTime(value: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value
  return new Date(normalized)
}

export function fmtDate(iso: string): string {
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const d = parseLedgerTime(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getUTCDate()).padStart(2, '0')} ${mo[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Display the exact maturity instant stored on the ledger, in UTC. */
export function fmtUtcTime(iso: string): string {
  const d = parseLedgerTime(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

/** A ledger timestamp (mark observation, call deadline) to the second, in UTC. */
export function fmtTimestamp(value: string): string {
  if (!value) return 'unknown time'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString().replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC')
}

export function daysTo(iso: string): number {
  const d = parseLedgerTime(iso)
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  if (Number.isNaN(d.getTime())) return Number.NaN
  return Math.round((d.getTime() - todayUtc) / 86400000)
}

/** Abbreviate a long identifier for display while keeping both ends legible. */
export function shortId(id: string, head = 8, tail = 6): string {
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`
}

/** `Lender::1220b68e…ef1f0a` — hint kept whole, fingerprint abbreviated. */
export function shortParty(party: string): string {
  const [hint, fingerprint = ''] = party.split('::')
  return fingerprint ? `${hint}::${shortId(fingerprint, 8, 4)}` : hint
}

/* ----------------------------------------------------------- derivation -- */

/** The contract that defines the party's current view: the most recently
 * created issuer-matching LoanOffer / Loan / LoanClosed. Lets the demo be
 * re-run cleanly while keeping an accidental foreign issuer out of the UI. */
export function currentDeal(contracts: Contract[], issuer?: string): Contract | undefined {
  const relevant = contracts.filter(
    (c) => (c.template === 'LoanOffer' || c.template === 'Loan' || c.template === 'LoanClosed')
      && (issuer === undefined || c.args.issuer === issuer),
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
  none: 'neutral',
  offered: 'accent',
  active: 'warn',
  repaid: 'ok',
  liquidated: 'danger',
}

export const STATUS_LABEL: Record<Status, string> = {
  none: 'No position',
  offered: 'Offered',
  active: 'Active',
  repaid: 'Repaid',
  liquidated: 'Liquidated',
}

/** Collateral escrow state, derived from the lifecycle stage. */
export function collateralState(status: Status): { label: string; tone: Tone } {
  switch (status) {
    case 'active':
      return { label: 'Locked', tone: 'warn' }
    case 'repaid':
      return { label: 'Released', tone: 'ok' }
    case 'liquidated':
      return { label: 'Seized', tone: 'danger' }
    default:
      return { label: 'Unencumbered', tone: 'neutral' }
  }
}

/** LTV band relative to the facility's own liquidation threshold. Elevated
 * starts at 78% of the threshold, so the warning scales with the terms. */
export function ltvBand(ltv: number, threshold = 90): { label: string; tone: 'ok' | 'warn' | 'danger' } {
  if (ltv < threshold * 0.78) return { label: 'Within limit', tone: 'ok' }
  if (ltv < threshold) return { label: 'Elevated', tone: 'warn' }
  return { label: 'Breach', tone: 'danger' }
}

/** Numbers shown on the position readout, using only the ledger-attested mark. */
export function dealNumbers(args: { principal: number; interest: number; collateral: number }, unitPrice = 1.0) {
  const collateralValue = args.collateral * unitPrice
  const ltv = collateralValue > 0 ? (args.principal / collateralValue) * 100 : 0
  const repayment = args.principal + args.interest
  const couponPct = args.principal > 0 ? (args.interest / args.principal) * 100 : 0
  return { unitPrice, collateralValue, ltv, repayment, couponPct }
}

/* ------------------------------------------------------------- lifecycle -- */

export interface LifecycleStep {
  key: string
  label: string
}

export function lifecycleSteps(status: Status): LifecycleStep[] {
  return [
    { key: 'none', label: 'Origination' },
    { key: 'offered', label: 'Offered' },
    { key: 'active', label: 'Drawn' },
    { key: 'closed', label: status === 'liquidated' ? 'Liquidated' : 'Settled' },
  ]
}

export const STEP_INDEX: Record<Status, number> = {
  none: 0,
  offered: 1,
  active: 2,
  repaid: 3,
  liquidated: 3,
}

/* ------------------------------------------------------------- viewpoint -- */

/** Structural visibility per template, mirroring the Daml signatory/observer
 * declarations in daml/Veil.daml. Rendered as the disclosure matrix. */
export type Visibility = 'signatory' | 'observer' | 'owner' | 'none'

/** Matrix columns: the five querying viewpoints plus the demo issuer, which is
 * a stakeholder on holdings and loans but never a viewpoint you can select. */
export type DisclosureColumn = Role | 'issuer'

export const DISCLOSURE_COLUMNS: { key: DisclosureColumn; label: string }[] = [
  { key: 'lender', label: 'Lender' },
  { key: 'borrower', label: 'Borrower' },
  { key: 'regulator', label: 'Regulator' },
  { key: 'valuer', label: 'Valuer' },
  { key: 'issuer', label: 'Issuer' },
  { key: 'outsider', label: 'Outsider' },
]

export interface DisclosureRow {
  template: string
  note: string
  by: Record<DisclosureColumn, Visibility>
}

export const DISCLOSURE: DisclosureRow[] = [
  {
    template: 'ValuationStream',
    note: 'Valuer and both principals sign; regulator observes',
    by: { lender: 'signatory', borrower: 'signatory', regulator: 'observer', valuer: 'signatory', issuer: 'none', outsider: 'none' },
  },
  {
    template: 'CollateralValuation',
    note: 'Signed mark — the valuer never sees the loan it prices',
    by: { lender: 'signatory', borrower: 'signatory', regulator: 'observer', valuer: 'signatory', issuer: 'none', outsider: 'none' },
  },
  {
    template: 'CashHolding',
    note: 'Issuer and owner sign, no observers',
    by: { lender: 'owner', borrower: 'owner', regulator: 'none', valuer: 'none', issuer: 'signatory', outsider: 'none' },
  },
  {
    template: 'CollateralHolding',
    note: 'Issuer and owner sign, no observers',
    by: { lender: 'owner', borrower: 'owner', regulator: 'none', valuer: 'none', issuer: 'signatory', outsider: 'none' },
  },
  {
    template: 'LoanOffer',
    note: 'Issuer and lender sign; borrower and regulator observe',
    by: { lender: 'signatory', borrower: 'observer', regulator: 'observer', valuer: 'none', issuer: 'signatory', outsider: 'none' },
  },
  {
    template: 'Loan',
    note: 'Issuer and both principals sign; regulator observes',
    by: { lender: 'signatory', borrower: 'signatory', regulator: 'observer', valuer: 'none', issuer: 'signatory', outsider: 'none' },
  },
  {
    template: 'LoanClosed',
    note: 'Settlement record, same stakeholders',
    by: { lender: 'signatory', borrower: 'signatory', regulator: 'observer', valuer: 'none', issuer: 'signatory', outsider: 'none' },
  },
]

export const VISIBILITY_META: Record<
  Visibility,
  { glyph: string; label: string; title: string; tone: Tone }
> = {
  signatory: {
    glyph: 'S',
    label: 'Signatory',
    title: 'Signatory — authorises the contract and sees it',
    tone: 'accent',
  },
  observer: {
    glyph: 'O',
    label: 'Observer',
    title: 'Observer — sees the contract but cannot authorise',
    tone: 'info',
  },
  owner: {
    glyph: 'W',
    label: 'Own wallet',
    title: 'Owner — co-signs and sees only its own holdings',
    tone: 'ok',
  },
  none: {
    glyph: '·',
    label: 'No visibility',
    title: 'No visibility — the contract does not exist for this party',
    tone: 'neutral',
  },
}

export const EXPLAINER: Record<Role, { sees: string; can: string }> = {
  lender: {
    sees: 'The complete contract, its ledger-attested collateral mark, and any open margin-call deadline. The configured demo issuer also sees the holding and loan lifecycle.',
    can: 'Create or withdraw offers, issue a margin call on a fresh breach, and liquidate after the deadline.',
  },
  borrower: {
    sees: 'The offer extended to you, your locked collateral, a fresh attested mark, and any margin-call deadline. The configured demo issuer also sees the holding and loan lifecycle.',
    can: 'Accept an offer, top up an open call with an exact holding, resolve a recovered call, or repay.',
  },
  regulator: {
    sees: 'The full contract and ledger-attested valuations, via observer rights explicitly granted by the parties. The configured demo issuer is a stakeholder on holdings and loans.',
    can: 'Nothing — a regulator observes but cannot transact. Disclosure is opt-in and fully auditable.',
  },
  valuer: {
    sees: 'Only valuation records you signed. The loan terms, amounts, and margin-call state remain outside your view. The demo issuer can see holdings and loans, but the valuer cannot.',
    can: 'Publish a manually attested unit price for the known demo deal; the ledger enforces freshness and identity checks.',
  },
  outsider: {
    sees: 'Nothing. This party is not a stakeholder on the contract and cannot tell it exists.',
    can: 'Nothing.',
  },
}
