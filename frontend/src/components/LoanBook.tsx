import { useEffect, useState } from 'react'
import type { Contract, Role } from '../types'
import { PARTY_NAMES, ROLE_LABELS, UNIT_CASH, fmtAmount, fmtPct, fmtTimestamp, fmtUtcTime, shortId, ltvBand } from '../state'
import {
  BOOK_STATUS_LABEL,
  buildBookRows,
  fmtCountdown,
  isOpenLoan,
  summarizeBook,
  toCsv,
  toJson,
  type BookExportMeta,
  type BookRow,
  type BookStatus,
} from '../loanBook'
import { Button, Metric, MetricRow, Panel, Tag, type Tone } from '../ui/primitives'

const STATUS_TONE: Record<BookStatus, Tone> = {
  offered: 'accent',
  active: 'warn',
  'margin-call': 'danger',
  repaid: 'ok',
  liquidated: 'danger',
  'written-off': 'neutral',
  closed: 'neutral',
}

function download(filename: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const amount = (n: number, dp = 2) => (Number.isFinite(n) ? fmtAmount(n, dp) : '—')

function LtvCell({ row }: { row: BookRow }) {
  if (row.ltv !== null) {
    const band = ltvBand(row.ltv, row.threshold ?? undefined)
    return <Tag tone={band.tone}>{fmtPct(row.ltv)}</Tag>
  }
  if (row.ltvState === 'n/a') return <span className="v-muted">—</span>
  return <span className="v-muted" title={`No fresh mark for this loan's valuation stream (${row.ltvState}).`}>{row.ltvState}</span>
}

/** Every issuer-matching deal the active party can see — offers, open loans
 * and settlement records — ranked by risk, with a CSV / JSON export of exactly
 * that ledger view. Selecting a row opens it in the Position tab. */
export function LoanBook({
  role,
  partyId,
  contracts,
  issuer,
  offset,
  selectedId,
  onSelect,
}: {
  role: Role
  partyId: string
  contracts: Contract[]
  issuer: string | undefined
  offset: number
  selectedId: string | null
  onSelect: (contractId: string) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const rows = buildBookRows(contracts, issuer, now)
  const summary = summarizeBook(rows)
  // Countdowns and mark freshness move with the clock; tick only while a
  // loan is open, since closed records and offers have nothing to count.
  const ticking = rows.some(isOpenLoan)

  useEffect(() => {
    if (!ticking) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ticking])

  const exportAs = (kind: 'csv' | 'json') => {
    const generatedAt = new Date().toISOString()
    const meta: BookExportMeta = { role, partyName: PARTY_NAMES[role], partyId, offset, generatedAt }
    const stamp = generatedAt.replace(/[:.]/g, '-')
    const base = `veil-loan-book-${role}-offset-${offset}-${stamp}`
    if (kind === 'csv') download(`${base}.csv`, 'text/csv;charset=utf-8', toCsv(rows, meta))
    else download(`${base}.json`, 'application/json', toJson(rows, summary, meta))
  }

  const deadlineNote = summary.nextDeadline
    ? `${fmtCountdown(summary.nextDeadline, now)} · ${fmtTimestamp(summary.nextDeadline)}`
    : undefined

  return (
    <Panel
      title="Loan book"
      kicker={`${PARTY_NAMES[role]} · ledger view at offset ${offset}`}
      flush
      actions={
        <>
          <Button size="sm" onClick={() => exportAs('csv')} disabled={rows.length === 0}>Download CSV</Button>
          <Button size="sm" onClick={() => exportAs('json')} disabled={rows.length === 0}>JSON</Button>
        </>
      }
      footer={
        <>
          <span className="v-id">
            {rows.length} deal contract{rows.length === 1 ? '' : 's'} visible to {ROLE_LABELS[role].toLowerCase()}
          </span>
          <span className="v-id">LTV on outstanding principal at the stream’s fresh mark (≤ 5 min)</span>
        </>
      }
    >
      <MetricRow cols={5}>
        <Metric label="Principal outstanding" value={fmtAmount(summary.totalOutstandingPrincipal)} unit={UNIT_CASH} />
        <Metric label="Active" value={summary.active} />
        <Metric label="Margin call" value={summary.inMarginCall} tone={summary.inMarginCall > 0 ? 'danger' : undefined} />
        <Metric
          label="Worst LTV"
          value={summary.worstLtv === null ? '—' : fmtPct(summary.worstLtv)}
          note={summary.worstLtv === null && summary.active > 0 ? 'no fresh mark' : undefined}
        />
        <Metric label="Next deadline" value={summary.nextDeadline ? fmtCountdown(summary.nextDeadline, now) : '—'} note={deadlineNote} />
      </MetricRow>

      {rows.length === 0 ? (
        <div style={{ padding: 'var(--space-5)', borderTop: '1px solid var(--line-strong)' }} className="v-dim">
          No deals visible to this party.
        </div>
      ) : (
        <div
          role="region"
          aria-label="Loan book table, scrolls horizontally"
          tabIndex={0}
          style={{ overflowX: 'auto', borderTop: '1px solid var(--line-strong)' }}
        >
          <table className="v-table" data-testid="loan-book" style={{ minWidth: 1080 }}>
            <caption className="v-label" style={{ textAlign: 'left', padding: 'var(--space-3) var(--space-5)' }}>
              Sorted by risk: breach first, then the soonest margin-call deadline
            </caption>
            <thead>
              <tr>
                <th scope="col">Deal</th>
                <th scope="col">Status</th>
                <th scope="col">Collateral</th>
                <th scope="col" className="v-num">Principal</th>
                <th scope="col" className="v-num">Outstanding</th>
                <th scope="col">LTV</th>
                <th scope="col">Threshold</th>
                <th scope="col">Call deadline</th>
                <th scope="col">Maturity</th>
                <th scope="col">Allocation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = row.contractId === selectedId
                return (
                  <tr
                    key={row.contractId}
                    onClick={() => onSelect(row.contractId)}
                    style={{ cursor: 'pointer', boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : undefined }}
                  >
                    <th scope="row" style={{ fontWeight: 400, textAlign: 'left', padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--line)' }}>
                      <button
                        type="button"
                        className="v-id"
                        title={`${row.contractId} — open in Position`}
                        aria-label={`Open deal ${shortId(row.contractId, 8, 4)} in the Position tab`}
                        aria-current={selected ? 'true' : undefined}
                        onClick={(e) => { e.stopPropagation(); onSelect(row.contractId) }}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
                      >
                        {shortId(row.contractId, 8, 4)}
                      </button>
                      <div className="v-muted" style={{ fontSize: 'var(--text-xs)' }}>{row.template}</div>
                    </th>
                    <td>
                      <Tag tone={STATUS_TONE[row.status]} dot={row.status === 'margin-call' || row.breached}>
                        {BOOK_STATUS_LABEL[row.status]}
                      </Tag>
                      {row.breached && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>breach</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {amount(row.collateralQuantity, Number.isInteger(row.collateralQuantity) ? 0 : 2)}{' '}
                      <span className="v-muted">{row.asset || '—'}</span>
                    </td>
                    <td className="v-num">{amount(row.principal)}</td>
                    <td className="v-num">{isOpenLoan(row) ? amount(row.outstandingPrincipal) : '—'}</td>
                    <td><LtvCell row={row} /></td>
                    <td>{row.threshold === null ? '—' : fmtPct(row.threshold)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {row.marginCallDeadline ? (
                        <span title={fmtTimestamp(row.marginCallDeadline)} style={{ color: 'var(--danger)' }}>
                          {fmtCountdown(row.marginCallDeadline, now)}
                        </span>
                      ) : <span className="v-muted">—</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{row.maturity ? fmtUtcTime(row.maturity) : '—'}</td>
                    <td>
                      {row.allocationCid
                        ? <span className="v-id" title={row.allocationCid}>{shortId(row.allocationCid, 8, 4)}</span>
                        : <span className="v-muted">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
