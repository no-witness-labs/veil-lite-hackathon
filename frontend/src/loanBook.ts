// Loan book derivation: every issuer-matching deal the active party can see,
// flattened into rows for the book table and its CSV / JSON export.
//
// Kept free of React and the DOM so it can be unit-tested with Node's type
// stripping (test/loan-book.test.mjs). The explicit `.ts` import extension is
// what lets Node resolve it; Vite and tsc accept it via allowImportingTsExtensions.
import type { Contract, ValuationStatus } from './types'
import {
  assessValuation,
  assetOf,
  balanceOf,
  currentDeal,
  isCoinDeal,
  marginCallOf,
  repaidOf,
  valuationCandidates,
} from './state.ts'

export type BookStatus = 'offered' | 'active' | 'margin-call' | 'repaid' | 'liquidated' | 'written-off' | 'closed'

export const BOOK_STATUS_LABEL: Record<BookStatus, string> = {
  offered: 'Offered',
  active: 'Active',
  'margin-call': 'Margin call',
  repaid: 'Repaid',
  liquidated: 'Liquidated',
  'written-off': 'Written off',
  closed: 'Closed',
}

/** How the LTV column was obtained. Only `fresh` carries a number. */
export type LtvState = 'fresh' | 'n/a' | Exclude<ValuationStatus, 'healthy' | 'at-threshold' | 'breached'>

export interface BookRow {
  contractId: string
  template: Contract['template']
  offset: number
  status: BookStatus
  /** LoanClosed.reason verbatim; empty for open deals. */
  reason: string
  asset: string
  collateralQuantity: number
  principal: number
  interest: number
  repaid: number
  outstandingPrincipal: number
  outstandingDue: number
  /** LTV on outstanding principal at the stream's current fresh mark. */
  ltv: number | null
  ltvState: LtvState
  markPrice: number | null
  markObservedAt: string
  threshold: number | null
  /** True when a fresh mark puts LTV at or above the threshold. */
  breached: boolean
  marginCallDeadline: string
  maturity: string
  allocationCid: string
  lender: string
  borrower: string
}

export interface BookSummary {
  totalOutstandingPrincipal: number
  active: number
  inMarginCall: number
  /** Highest fresh-mark LTV across open loans, or null when none is priced. */
  worstLtv: number | null
  /** Earliest margin-call deadline across open loans (may already be past). */
  nextDeadline: string | null
}

const DEAL_TEMPLATES = new Set(['LoanOffer', 'Loan', 'LoanClosed', 'CoinLoanOffer', 'CoinLoan'])

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.NaN
}

export function bookStatusOf(deal: Contract): BookStatus {
  if (deal.template === 'LoanOffer' || deal.template === 'CoinLoanOffer') return 'offered'
  if (deal.template === 'Loan' || deal.template === 'CoinLoan') return marginCallOf(deal) ? 'margin-call' : 'active'
  switch (deal.args.reason) {
    case 'Repaid':
      return 'repaid'
    case 'Liquidated':
    case 'LiquidatedAtMaturity':
      return 'liquidated'
    case 'WrittenOff':
      return 'written-off'
    default:
      return 'closed'
  }
}

export const isOpenLoan = (row: BookRow) => row.status === 'active' || row.status === 'margin-call'

/** One row per issuer-matching deal contract visible to the querying party. */
export function buildBookRows(contracts: Contract[], issuer: string | undefined, now: number): BookRow[] {
  return contracts
    .filter((c) => DEAL_TEMPLATES.has(c.template) && (issuer === undefined || c.args.issuer === issuer))
    .map((deal) => {
      const status = bookStatusOf(deal)
      const principal = num(deal.args.principal)
      const interest = num(deal.args.interest)
      const repaid = repaidOf(deal)
      const collateralQuantity = num(deal.args.collateralQuantity)
      const parsedThreshold = num(deal.args.liquidationThresholdLtv)
      const threshold = parsedThreshold > 0 ? parsedThreshold : null
      const { outstandingPrincipal, outstandingDue } = balanceOf(principal, interest, repaid)
      const drawn = status === 'active' || status === 'margin-call'
      const closed = !drawn && status !== 'offered'

      let ltv: number | null = null
      let ltvState: LtvState = 'n/a'
      let markPrice: number | null = null
      let markObservedAt = ''
      if (!closed) {
        const assessment = assessValuation(
          valuationCandidates(contracts, deal),
          outstandingPrincipal,
          collateralQuantity,
          threshold ?? Number.NaN,
          now,
        )
        markPrice = assessment.mark?.unitPrice ?? null
        markObservedAt = assessment.mark?.observedAt ?? ''
        if (assessment.status === 'healthy' || assessment.status === 'at-threshold' || assessment.status === 'breached') {
          ltv = assessment.ltv ?? null
          ltvState = 'fresh'
        } else {
          ltvState = assessment.status
        }
      }

      return {
        contractId: deal.contractId,
        template: deal.template,
        offset: deal.offset,
        status,
        reason: deal.template === 'LoanClosed' ? String(deal.args.reason ?? '') : '',
        asset: assetOf(deal) ?? '',
        collateralQuantity,
        principal,
        interest,
        repaid,
        // Nothing is drawn on an offer and nothing is owed on a closed record.
        outstandingPrincipal: drawn ? outstandingPrincipal : 0,
        outstandingDue: drawn ? outstandingDue : 0,
        ltv,
        ltvState,
        markPrice,
        markObservedAt,
        threshold,
        breached: ltv !== null && threshold !== null && ltv >= threshold,
        marginCallDeadline: marginCallOf(deal)?.deadline ?? '',
        maturity: deal.args.maturity ?? '',
        allocationCid: isCoinDeal(deal) ? String(deal.args.allocationCid ?? '') : '',
        lender: deal.args.lender ?? '',
        borrower: deal.args.borrower ?? '',
      }
    })
    .sort(compareRisk)
}

/** Risk tiers: open loans in breach, then open margin calls, other open
 * loans, offers, and finally closed records. */
function riskTier(row: BookRow): number {
  if (isOpenLoan(row) && row.breached) return 0
  if (row.status === 'margin-call') return 1
  if (row.status === 'active') return 2
  if (row.status === 'offered') return 3
  return 4
}

const timeOrInfinity = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

/** Breach first, then the soonest margin-call deadline, then the highest LTV,
 * then the most recently created contract. */
export function compareRisk(a: BookRow, b: BookRow): number {
  return riskTier(a) - riskTier(b)
    || timeOrInfinity(a.marginCallDeadline) - timeOrInfinity(b.marginCallDeadline)
    || (b.ltv ?? Number.NEGATIVE_INFINITY) - (a.ltv ?? Number.NEGATIVE_INFINITY)
    || b.offset - a.offset
}

export function summarizeBook(rows: BookRow[]): BookSummary {
  const open = rows.filter(isOpenLoan)
  const ltvs = open.map((r) => r.ltv).filter((v): v is number => v !== null)
  const deadlines = open
    .map((r) => r.marginCallDeadline)
    .filter((d) => Number.isFinite(Date.parse(d)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  return {
    totalOutstandingPrincipal: open.reduce((sum, r) => sum + (Number.isFinite(r.outstandingPrincipal) ? r.outstandingPrincipal : 0), 0),
    active: open.length,
    inMarginCall: open.filter((r) => r.status === 'margin-call').length,
    worstLtv: ltvs.length > 0 ? Math.max(...ltvs) : null,
    nextDeadline: deadlines[0] ?? null,
  }
}

/** Compact countdown to a ledger deadline: `4m 12s`, `2h 05m`, or `passed`. */
export function fmtCountdown(deadline: string, now: number): string {
  const ms = Date.parse(deadline) - now
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return 'passed'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (v: number) => String(v).padStart(2, '0')
  if (d > 0) return `${d}d ${pad(h)}h`
  if (h > 0) return `${h}h ${pad(m)}m`
  return `${m}m ${pad(s % 60)}s`
}

/** The deal the Position tab shows: the one picked in the loan book while it
 * is still visible, otherwise the most recent deal as before. */
export function selectDeal(contracts: Contract[], issuer: string | undefined, selectedId: string | null): Contract | undefined {
  if (selectedId) {
    const picked = contracts.find((c) => c.contractId === selectedId
      && DEAL_TEMPLATES.has(c.template)
      && (issuer === undefined || c.args.issuer === issuer))
    if (picked) return picked
  }
  return currentDeal(contracts, issuer)
}

/* ---------------------------------------------------------------- export -- */

export interface BookExportMeta {
  role: string
  partyName: string
  partyId: string
  offset: number
  generatedAt: string
}

export const EXPORT_COLUMNS: (keyof BookRow)[] = [
  'contractId', 'template', 'status', 'reason', 'asset', 'collateralQuantity',
  'principal', 'interest', 'repaid', 'outstandingPrincipal', 'outstandingDue',
  'ltv', 'ltvState', 'markPrice', 'markObservedAt', 'threshold', 'breached',
  'marginCallDeadline', 'maturity', 'allocationCid', 'lender', 'borrower', 'offset',
]

export function exportNote(meta: BookExportMeta): string {
  return `Veil loan book: the ledger view of ${meta.partyName} (${meta.role}, ${meta.partyId}) at ledger offset ${meta.offset}, exported ${meta.generatedAt}. It lists only contracts this party is a stakeholder on; other parties see different books.`
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let text = String(value)
  // Neutralise spreadsheet formula injection from ledger-supplied text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: BookRow[], meta: BookExportMeta): string {
  const lines = [
    `# ${exportNote(meta)}`,
    EXPORT_COLUMNS.join(','),
    ...rows.map((row) => EXPORT_COLUMNS.map((key) => csvCell(row[key])).join(',')),
  ]
  return `${lines.join('\r\n')}\r\n`
}

export function toJson(rows: BookRow[], summary: BookSummary, meta: BookExportMeta): string {
  const clean = (v: number | null) => (v !== null && Number.isFinite(v) ? v : null)
  return JSON.stringify({
    note: exportNote(meta),
    ...meta,
    summary,
    rows: rows.map((row) => Object.fromEntries(
      EXPORT_COLUMNS.map((key) => {
        const v = row[key]
        return [key, typeof v === 'number' ? clean(v) : v]
      }),
    )),
  }, null, 2)
}
