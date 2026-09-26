import { useEffect, useState } from 'react'
import type { Contract, MarginCall, Role, Status, Valuation } from '../types'
import {
  PARTY_NAMES,
  STATUS_LABEL,
  STATUS_TONE,
  UNIT_CASH,
  assessValuation,
  collateralState,
  daysTo,
  dealNumbers,
  fmtAmount,
  fmtDate,
  fmtMoney,
  fmtPct,
  fmtTimestamp,
  fmtUtcTime,
  ltvBand,
  marginCallOf,
  repaidOf,
  shortId,
} from '../state'
import { Banner, Button, Label, Meter, Metric, MetricRow, Section, Tag } from '../ui/primitives'
import { Lifecycle } from './Lifecycle'

/** A mark older than this cannot back a margin action; mirrors the Daml guard. */
const MARK_MAX_AGE_MS = 5 * 60 * 1000

export interface PositionActions {
  onWithdraw: () => void
  onAccept: () => void
  onRepay: () => void
  onIssueMarginCall: () => void
  onTopUp: (quantity: number) => void
  onResolveMarginCall: () => void
  onLiquidate: () => void
  onLiquidateOverdue: () => void
}

/** The facility blotter: identity, economics, risk, lifecycle and the actions
 * this party is structurally permitted to take. Everything on screen is read
 * from the contracts the querying party can actually see — the collateral is
 * priced only by the ledger-attested mark, never by a client-side price. */
export function PositionPanel({
  role,
  status,
  deal,
  valuation,
  valuationCandidates,
  availableTopUp,
  busy,
  actions,
}: {
  role: Role
  status: Status
  deal: Contract
  valuation?: Valuation
  valuationCandidates: Valuation[]
  availableTopUp: number
  busy: boolean
  actions: PositionActions
}) {
  const [now, setNow] = useState(() => Date.now())
  const principal = Number(deal.args.principal)
  const interest = Number(deal.args.interest)
  const collateral = Number(deal.args.collateralQuantity)
  const parsedThreshold = Number(deal.args.liquidationThresholdLtv)
  const threshold = Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : undefined
  const markPrice = valuation?.unitPrice
  const { collateralValue, ltv, repayment, couponPct, outstandingPrincipal, repaid } = dealNumbers(
    { principal, interest, collateral, repaid: repaidOf(deal) },
    markPrice ?? 1,
  )
  const marginCall = marginCallOf(deal)
  const deadlineMs = marginCall ? Date.parse(marginCall.deadline) : Number.NaN
  const maturity = deal.args.maturity ?? ''
  const maturityMs = maturity ? Date.parse(maturity) : Number.NaN

  useEffect(() => {
    if ((status !== 'active' && status !== 'offered') || !Number.isFinite(maturityMs)) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status, maturityMs])

  const acceptance = status === 'offered'
    ? assessValuation(valuationCandidates, principal, collateral, threshold ?? Number.NaN, now)
    : undefined
  const beforeDeadline = Number.isFinite(deadlineMs) ? now < deadlineMs : false
  const beforeMaturity = Number.isFinite(maturityMs) ? now < maturityMs : false
  const pastMaturity = Number.isFinite(maturityMs) ? now > maturityMs : false
  const markAgeMs = valuation?.observedAt ? now - Date.parse(valuation.observedAt) : Number.POSITIVE_INFINITY
  const markFresh = Boolean(valuation && Number.isFinite(markAgeMs) && markAgeMs >= 0 && markAgeMs <= MARK_MAX_AGE_MS)
  const markIssue = markAgeMs < 0 ? 'future-dated — use a synchronised ledger clock' : 'stale — publish a fresh mark'
  const markBreach = Boolean(markFresh && threshold !== undefined && ltv >= threshold)
  const topUpLtv = availableTopUp > 0 && markPrice && collateral + availableTopUp > 0
    ? (outstandingPrincipal / ((collateral + availableTopUp) * markPrice)) * 100
    : Number.POSITIVE_INFINITY
  const topUpRestores = threshold !== undefined && topUpLtv < threshold

  const band = markPrice ? ltvBand(ltv, threshold) : undefined
  const escrow = collateralState(status)
  const closed = status === 'repaid' || status === 'liquidated'
  const tenor = daysTo(maturity)

  const gates: Gates = {
    observer: role === 'regulator',
    withdraw: role === 'lender' && status === 'offered',
    accept: role === 'borrower' && status === 'offered' && beforeMaturity && acceptance?.status === 'healthy',
    repay: role === 'borrower' && status === 'active',
    issue: role === 'lender' && status === 'active' && beforeMaturity && !marginCall && markBreach,
    topUp: role === 'borrower' && status === 'active' && beforeMaturity && Boolean(marginCall) && beforeDeadline && markBreach && topUpRestores,
    resolve: role === 'borrower' && status === 'active' && beforeMaturity && Boolean(marginCall) && !markBreach && markFresh,
    liquidate: role === 'lender' && status === 'active' && Boolean(marginCall) && !beforeDeadline && markBreach,
    overdue: role === 'lender' && status === 'active' && pastMaturity,
    closed: (role === 'lender' || role === 'borrower') && closed,
  }

  let maturityNote: string
  if (pastMaturity) {
    maturityNote = status === 'active' && role === 'lender'
      ? 'Past maturity — overdue liquidation is available'
      : status === 'offered'
        ? 'Past maturity — offer acceptance is closed'
        : status === 'active'
          ? 'Past maturity — repay or await lender liquidation'
          : 'Past maturity — facility is closed'
  } else if (beforeMaturity) {
    maturityNote = Number.isFinite(tenor) ? `${fmtUtcTime(maturity)} · ${tenor} days` : fmtUtcTime(maturity)
  } else {
    maturityNote = 'Maturity reached — ledger actions are boundary-checked'
  }

  return (
    <section className="v-panel">
      <Header deal={deal} status={status} marginCall={marginCall} />

      {/* Economics — four figures, set large. */}
      <MetricRow cols={4}>
        <Metric
          label={status === 'offered' ? 'Funded principal' : 'Principal'}
          value={fmtAmount(principal)}
          unit={UNIT_CASH}
          size="lg"
          note={status === 'offered' ? 'Reserved in issuer-signed offer escrow' : undefined}
        />
        <Metric
          label="Interest"
          value={fmtAmount(interest)}
          unit={UNIT_CASH}
          size="lg"
          note={`${fmtPct(couponPct)} coupon`}
        />
        <Metric
          label={repaid > 0 && status === 'active' ? 'Outstanding' : 'Repayment'}
          value={fmtAmount(status === 'active' ? repayment : principal + interest)}
          unit={UNIT_CASH}
          size="lg"
          tone="ok"
          note={repaid > 0 ? `${fmtAmount(repaid)} ${UNIT_CASH} paid down` : undefined}
        />
        <Metric
          label="Maturity · ledger UTC"
          value={fmtDate(maturity)}
          note={<span style={{ color: pastMaturity ? 'var(--danger)' : undefined }}>{maturityNote}</span>}
        />
      </MetricRow>

      {/* Risk — collateral at the attested mark against the LTV threshold. */}
      <div className="v-split">
        <div style={{ padding: 'var(--space-5)' }}>
          <div
            className="v-row"
            style={{ justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}
          >
            <Label>Collateral</Label>
            <Tag tone={escrow.tone} dot>
              {escrow.label}
            </Tag>
          </div>
          <div style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>
            {deal.args.collateralAsset ?? 'Tokenized T-Bill'} <span className="v-muted">(simulated)</span>
          </div>
          <div className="v-row" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Metric label="Quantity" value={fmtAmount(collateral, 0)} unit="units" />
            <Metric label="Unit mark" value={markPrice ? markPrice.toFixed(2) : '—'} unit={markPrice ? UNIT_CASH : undefined} />
            <Metric
              label="Market value"
              value={markPrice ? fmtAmount(collateralValue) : '—'}
              unit={markPrice ? UNIT_CASH : undefined}
              note={markPrice ? 'at the attested mark' : 'awaiting mark'}
            />
          </div>

          <div
            style={{
              marginTop: 'var(--space-5)',
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--line-soft)',
              display: 'grid',
              gap: 'var(--space-2)',
            }}
          >
            <div className="v-row" style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <Label>Ledger-attested mark</Label>
              {valuation && (
                <Tag tone={markFresh ? 'ok' : 'danger'}>{markFresh ? 'Fresh' : markAgeMs < 0 ? 'Future-dated' : 'Stale'}</Tag>
              )}
            </div>
            <div className="v-metric__note" style={{ color: valuation && !markFresh ? 'var(--danger)' : undefined }}>
              {valuation
                ? `${valuation.unitPrice.toFixed(2)} ${UNIT_CASH}/unit · observed ${fmtTimestamp(valuation.observedAt)} · ${markFresh ? 'fresh for margin actions' : markIssue}`
                : 'No valuation has been published for this facility.'}
            </div>
            {(deal.args.valuationStreamId || valuation?.streamId) && (
              <span className="v-id" title={deal.args.valuationStreamId ?? valuation?.streamId}>
                stream {shortId(deal.args.valuationStreamId ?? valuation?.streamId ?? '', 10, 6)}
              </span>
            )}
            {status === 'offered' && <OfferTerms deal={deal} />}
          </div>
        </div>

        <div style={{ padding: 'var(--space-5)' }}>
          <div
            className="v-row"
            style={{ justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}
          >
            <Label>Loan-to-value</Label>
            {band ? <Tag tone={band.tone}>{band.label}</Tag> : <Tag>No mark</Tag>}
          </div>
          <Metric label="" value={markPrice ? fmtPct(ltv) : '—'} size="xl" tone={band?.tone} />
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Meter
              value={markPrice ? ltv : 0}
              max={120}
              tone={band?.tone ?? 'ok'}
              threshold={threshold}
              scale={['0%', '120%']}
            />
          </div>
          <div className="v-metric__note" style={{ marginTop: 'var(--space-2)' }}>
            {closed
              ? 'Final loan-to-value at close.'
              : threshold !== undefined
                ? `Margin call permitted at or above ${threshold}% on a fresh mark — enforced on-ledger, not in this UI.`
                : 'Liquidation threshold not set on this contract.'}
          </div>

          {marginCall && (
            <div style={{ marginTop: 'var(--space-5)' }}>
              <Banner tone="warn" title="Margin call open.">
                Issued {fmtTimestamp(marginCall.issuedAt)} at a {Number(marginCall.unitPrice).toFixed(2)} mark. Deadline{' '}
                {fmtTimestamp(marginCall.deadline)} — {beforeDeadline ? 'window open' : 'deadline passed'}.
              </Banner>
            </div>
          )}
        </div>
      </div>

      <Section label="Lifecycle">
        <Lifecycle status={status} />
      </Section>

      <ActionBar
        role={role}
        status={status}
        gates={gates}
        marginCall={marginCall}
        beforeDeadline={beforeDeadline}
        beforeMaturity={beforeMaturity}
        markFresh={markFresh}
        markBreach={markBreach}
        threshold={threshold}
        acceptanceMessage={acceptance?.message}
        availableTopUp={availableTopUp}
        repayment={repayment}
        busy={busy}
        actions={actions}
      />
    </section>
  )
}

function Header({ deal, status, marginCall }: { deal: Contract; status: Status; marginCall?: MarginCall }) {
  return (
    <header className="v-panel__head" style={{ minHeight: 56, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div className="v-row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <h2 className="v-display" style={{ fontSize: 'var(--display-md)' }}>
            Secured Credit Facility
          </h2>
          {marginCall ? (
            <Tag tone="warn" dot>
              Margin call
            </Tag>
          ) : (
            <Tag tone={STATUS_TONE[status]} dot>
              {STATUS_LABEL[status]}
            </Tag>
          )}
        </div>
        <div className="v-row" style={{ gap: 'var(--space-3)', marginTop: 2, flexWrap: 'wrap' }}>
          <Label>VEIL-0001 · Repo-style · {UNIT_CASH}</Label>
          <span className="v-id" title={deal.contractId}>
            {deal.template} · {shortId(deal.contractId, 10, 6)} · offset {deal.offset}
          </span>
        </div>
      </div>
      <Counterparties />
    </header>
  )
}

function Counterparties() {
  return (
    <div className="v-row" style={{ gap: 'var(--space-3)', flex: 'none' }}>
      <div style={{ textAlign: 'right' }}>
        <Label>Lender</Label>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{PARTY_NAMES.lender}</div>
      </div>
      <span aria-hidden="true" style={{ color: 'var(--ink-300)' }}>
        →
      </span>
      <div>
        <Label>Borrower</Label>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{PARTY_NAMES.borrower}</div>
      </div>
    </div>
  )
}

/** Terms both principals agree to at offer time: who may publish marks, and
 * how long a margin call stays open before the lender may liquidate. */
function OfferTerms({ deal }: { deal: Contract }) {
  const agent = deal.args.valuationAgent ? deal.args.valuationAgent.split('::')[0] : 'Not set'
  const window = Number(deal.args.marginCallWindowSeconds)
  return (
    <div className="v-row" style={{ gap: 'var(--space-5)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
      <div>
        <Label>Agreed valuation agent</Label>
        <div className="v-id">{agent}</div>
      </div>
      <div>
        <Label>Margin-call window</Label>
        <div className="v-id">{Number.isFinite(window) ? `${window} seconds` : 'not set'}</div>
      </div>
    </div>
  )
}

interface Gates {
  observer: boolean
  withdraw: boolean
  accept: boolean
  repay: boolean
  issue: boolean
  topUp: boolean
  resolve: boolean
  liquidate: boolean
  overdue: boolean
  closed: boolean
}

/** Actions are gated by role, lifecycle stage, mark freshness and deadlines —
 * the same gating the Daml controllers enforce. A blocked action stays on
 * screen, disabled, and the hint says what would unlock it. */
function ActionBar({
  role,
  status,
  gates,
  marginCall,
  beforeDeadline,
  beforeMaturity,
  markFresh,
  markBreach,
  threshold,
  acceptanceMessage,
  availableTopUp,
  repayment,
  busy,
  actions,
}: {
  role: Role
  status: Status
  gates: Gates
  marginCall?: MarginCall
  beforeDeadline: boolean
  beforeMaturity: boolean
  markFresh: boolean
  markBreach: boolean
  threshold?: number
  acceptanceMessage?: string
  availableTopUp: number
  repayment: number
  busy: boolean
  actions: PositionActions
}) {
  const lenderActive = role === 'lender' && status === 'active'
  const borrowerCall = role === 'borrower' && status === 'active' && Boolean(marginCall)
  const lenderCall = lenderActive && Boolean(marginCall)

  let hint = 'Actions available to you'
  let hintTone: 'danger' | undefined
  if (gates.observer) hint = 'Observer rights — read-only, cannot transact'
  else if (gates.closed) hint = 'Facility closed — no further actions'
  else if (role === 'borrower' && status === 'offered' && !gates.accept) {
    hint = !beforeMaturity ? 'Offer expired at maturity' : `Cannot accept — ${acceptanceMessage ?? 'matching valuation unavailable'}`
    hintTone = 'danger'
  } else if (gates.overdue) hint = 'Loan past maturity — lender may liquidate without a valuation'
  else if (lenderActive && !marginCall) {
    hint = !markFresh || threshold === undefined
      ? 'Fresh ledger valuation required'
      : markBreach
        ? `Attested mark breaches ${threshold}% LTV — a margin call may be issued`
        : `Healthy — a call can be issued once the attested mark breaches ${threshold}% LTV`
  } else if (lenderCall) {
    hint = beforeDeadline
      ? 'Liquidation unlocks when the margin-call deadline passes'
      : gates.liquidate
        ? 'Call expired on a breached mark — liquidation permitted by the on-ledger guard'
        : 'Deadline passed — a fresh breached mark is required to liquidate'
  } else if (borrowerCall) {
    if (gates.topUp) hint = 'Restore LTV before the margin-call deadline'
    else if (gates.resolve) hint = 'Mark has recovered — the call can be resolved'
    else {
      hint = !beforeMaturity
        ? 'Maturity reached — repay or await lender liquidation'
        : beforeDeadline
          ? availableTopUp > 0
            ? 'Fresh mark or exact top-up required'
            : 'No reserve holding restores LTV'
          : 'Call expired — lender may liquidate'
      hintTone = 'danger'
    }
  }

  return (
    <footer className="v-panel__foot" style={{ flexWrap: 'wrap' }}>
      <span className="v-label" style={{ whiteSpace: 'normal', color: hintTone ? 'var(--danger)' : undefined }}>
        {hint}
      </span>
      <div className="v-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {gates.observer && (
          <Tag tone="info" dot>
            Observer
          </Tag>
        )}
        {gates.withdraw && (
          <Button variant="danger-ghost" onClick={actions.onWithdraw} busy={busy}>
            Withdraw offer
          </Button>
        )}
        {role === 'borrower' && status === 'offered' && (
          <Button variant="primary" onClick={actions.onAccept} busy={busy} disabled={!gates.accept}>
            Accept offer
          </Button>
        )}
        {gates.repay && (
          <Button variant="ok" onClick={actions.onRepay} busy={busy}>
            Repay {fmtMoney(repayment)}
          </Button>
        )}
        {lenderActive && !marginCall && !gates.overdue && (
          <Button variant="danger-ghost" onClick={actions.onIssueMarginCall} busy={busy} disabled={!gates.issue}>
            Issue margin call
          </Button>
        )}
        {borrowerCall && gates.topUp && (
          <Button variant="primary" onClick={() => actions.onTopUp(availableTopUp)} busy={busy}>
            Top up {availableTopUp} units
          </Button>
        )}
        {borrowerCall && !gates.topUp && gates.resolve && (
          <Button variant="ok" onClick={actions.onResolveMarginCall} busy={busy}>
            Resolve margin call
          </Button>
        )}
        {borrowerCall && !gates.topUp && !gates.resolve && (
          <Button variant="primary" disabled>
            Top up collateral
          </Button>
        )}
        {lenderCall && (
          <Button variant="danger" onClick={actions.onLiquidate} busy={busy} disabled={!gates.liquidate}>
            Liquidate collateral
          </Button>
        )}
        {gates.overdue && (
          <Button variant="danger" onClick={actions.onLiquidateOverdue} busy={busy}>
            Liquidate after maturity
          </Button>
        )}
        {gates.closed && (
          <Tag tone={status === 'liquidated' ? 'danger' : 'ok'} dot>
            {status === 'liquidated' ? 'Liquidated' : 'Settled'}
          </Tag>
        )}
      </div>
    </footer>
  )
}
