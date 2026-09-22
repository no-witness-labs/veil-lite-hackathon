import { useEffect, useState } from 'react'
import type { Contract, Role, Status, Valuation } from '../types'
import { STATUS_TONE, dealNumbers, fmtMoney, fmtUtcTime, lockTone, ltvTone, marginCallOf } from '../state'
import { Stepper } from './Stepper'
import { RoomChips } from './RoomChips'

const monoLabel: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono',monospace",
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8a929e',
}
const monoValue: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono',monospace",
  fontSize: 16,
  fontWeight: 600,
  color: '#14171f',
  marginTop: 6,
}
const section: React.CSSProperties = { padding: '24px 28px', borderBottom: '1px solid #eef0f3' }

export interface DealActions {
  onWithdraw: () => void
  onAccept: () => void
  onRepay: () => void
  onIssueMarginCall: () => void
  onTopUp: (quantity: number) => void
  onResolveMarginCall: () => void
  onLiquidate: () => void
  onLiquidateOverdue: () => void
}

export function DealCard({
  role,
  status,
  deal,
  valuation,
  availableTopUp,
  busy,
  actions,
}: {
  role: Role
  status: Status
  deal: Contract
  valuation?: Valuation
  availableTopUp: number
  busy: boolean
  actions: DealActions
}) {
  const [now, setNow] = useState(() => Date.now())
  const principal = Number(deal.args.principal)
  const interest = Number(deal.args.interest)
  const collateral = Number(deal.args.collateralQuantity)
  const parsedThreshold = Number(deal.args.liquidationThresholdLtv)
  const liquidationThreshold = Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : undefined
  const markPrice = valuation?.unitPrice
  const { collateralValue, ltv, repayment } = dealNumbers({ principal, interest, collateral }, markPrice ?? 1)
  const marginCall = marginCallOf(deal)
  const deadlineMs = marginCall ? Date.parse(marginCall.deadline) : Number.NaN
  const maturityMs = deal.args.maturity ? Date.parse(deal.args.maturity) : Number.NaN
  useEffect(() => {
    if ((status !== 'active' && status !== 'offered') || !Number.isFinite(maturityMs)) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status, maturityMs])
  const beforeDeadline = Number.isFinite(deadlineMs) ? now < deadlineMs : false
  const beforeMaturity = Number.isFinite(maturityMs) ? now < maturityMs : false
  const pastMaturity = Number.isFinite(maturityMs) ? now > maturityMs : false
  const markAgeMs = valuation?.observedAt ? now - Date.parse(valuation.observedAt) : Number.POSITIVE_INFINITY
  const markFresh = Boolean(valuation && Number.isFinite(markAgeMs) && markAgeMs >= 0 && markAgeMs <= 5 * 60 * 1000)
  const markIssue = markAgeMs < 0 ? 'future-dated — use a synchronized ledger clock' : 'stale — publish a fresh mark'
  const markBreach = Boolean(markFresh && liquidationThreshold !== undefined && ltv >= liquidationThreshold)
  const topUpLtv = availableTopUp > 0 && markPrice && collateral + availableTopUp > 0
    ? (principal / ((collateral + availableTopUp) * markPrice)) * 100
    : Number.POSITIVE_INFINITY
  const topUpRestores = liquidationThreshold !== undefined && topUpLtv < liquidationThreshold

  const sp = marginCall ? { label: 'Margin call', color: '#b7791f', bg: '#fdf3e0' } : STATUS_TONE[status]
  const lock = lockTone(status)
  const lb = markPrice ? ltvTone(ltv, liquidationThreshold) : { label: 'No mark', color: '#8a929e', bg: '#f4f5f7', dot: '#cfd4dc' }
  const agreedAgent = deal.args.valuationAgent ? deal.args.valuationAgent.split('::')[0] : 'Not set'
  const agreedWindow = Number(deal.args.marginCallWindowSeconds)

  const fObserver = role === 'regulator'
  const fLenderWithdraw = role === 'lender' && status === 'offered'
  const fBorrowerAccept = role === 'borrower' && status === 'offered' && beforeMaturity
  const fBorrowerRepay = role === 'borrower' && status === 'active'
  const fLenderIssue = role === 'lender' && status === 'active' && beforeMaturity && !marginCall && markBreach
  const fBorrowerTopUp = role === 'borrower' && status === 'active' && beforeMaturity && Boolean(marginCall) && beforeDeadline && markBreach && topUpRestores
  const fBorrowerResolve = role === 'borrower' && status === 'active' && beforeMaturity && Boolean(marginCall) && !markBreach && markFresh
  const fLenderLiquidate = role === 'lender' && status === 'active' && Boolean(marginCall) && !beforeDeadline && markBreach
  const fLenderOverdue = role === 'lender' && status === 'active' && pastMaturity
  const fClosed = (role === 'lender' || role === 'borrower') && (status === 'repaid' || status === 'liquidated')

  let actionHint = 'Actions available to you'
  if (fObserver) actionHint = 'Read-only observer'
  else if (fClosed) actionHint = 'Facility closed'
  else if (role === 'lender' && fLenderOverdue) actionHint = 'Loan past maturity — lender may liquidate without a valuation'
  else if (role === 'lender' && status === 'active' && !marginCall) actionHint = markFresh && liquidationThreshold !== undefined ? `Issue a call when the attested mark breaches ${liquidationThreshold}% LTV` : 'Fresh ledger valuation required'
  else if (role === 'lender' && marginCall && beforeDeadline) actionHint = 'Liquidation unlocks when the margin-call deadline passes'
  else if (role === 'borrower' && marginCall && beforeDeadline) actionHint = 'Restore LTV before the margin-call deadline'

  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, boxShadow: '0 1px 2px rgba(20,23,31,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '22px 28px', borderBottom: '1px solid #eef0f3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: '#14171f', letterSpacing: '-0.01em' }}>Secured Credit Facility</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: '#9aa1ad', marginTop: 3 }}>VEIL-0001 · Repo-style · USDC</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: '#bcc2cb', marginTop: 4 }}>
            {deal.template} · {deal.contractId.slice(0, 10)}…{deal.contractId.slice(-4)} · offset {deal.offset}
          </div>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: sp.color, background: sp.bg, padding: '6px 12px', borderRadius: 999 }}>
          {sp.label}
        </div>
      </div>

      <div style={{ ...section, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar initials="MC" bg="#eef2fe" color="#2748d8" />
          <div><div style={{ ...monoLabel, fontSize: 9, letterSpacing: '0.12em' }}>Lender</div><div style={{ fontSize: 14, fontWeight: 600, color: '#14171f', marginTop: 1 }}>Meridian Capital</div></div>
        </div>
        <div style={{ color: '#cfd4dc', fontSize: 18, flex: 'none' }}>→</div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', textAlign: 'right' }}>
          <div><div style={{ ...monoLabel, fontSize: 9, letterSpacing: '0.12em' }}>Borrower</div><div style={{ fontSize: 14, fontWeight: 600, color: '#14171f', marginTop: 1 }}>Northwind Treasury</div></div>
          <Avatar initials="NT" bg="#f4f5f7" color="#5b6472" />
        </div>
      </div>

      <div style={{ ...section, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
        <div><div style={monoLabel}>Principal</div><div style={monoValue}>{fmtMoney(principal)}</div></div>
        <div><div style={monoLabel}>Interest</div><div style={monoValue}>{interest} USDC · {((interest / principal) * 100).toFixed(1)}%</div></div>
        <div><div style={monoLabel}>Repayment</div><div style={monoValue}>{fmtMoney(repayment)}</div></div>
        <div>
          <div style={monoLabel}>Maturity · ledger UTC</div>
          <div style={monoValue}>{fmtUtcTime(deal.args.maturity ?? '')}</div>
          <div style={{ fontSize: 11, color: pastMaturity ? '#a23b2e' : '#aeb4be', marginTop: 3 }}>
            {pastMaturity
              ? status === 'active' && role === 'lender'
                ? 'Past maturity — overdue liquidation is available'
                : status === 'offered'
                  ? 'Past maturity — offer acceptance is closed'
                  : 'Past maturity — facility is closed'
              : beforeMaturity
                ? 'Maturity rules are enforced by the ledger'
                : 'Maturity reached — ledger actions are boundary-checked'}
          </div>
        </div>
      </div>

      <div style={{ ...section, display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 28 }}>
        <div>
          <div style={{ ...monoLabel, marginBottom: 10 }}>Collateral</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f' }}>{deal.args.collateralAsset ?? 'Tokenized T-Bill / MMF'}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: '#5b6472', marginTop: 3 }}>
                {collateral} units · {markPrice ? `${collateralValue.toFixed(2)} USDC` : 'awaiting mark'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: lock.color, background: lock.bg, padding: '7px 13px', borderRadius: 999, flex: 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: 999, background: lock.dot }} />{lock.label}
            </div>
          </div>
          <div style={{ marginTop: 18, padding: '12px 14px', borderRadius: 9, background: !valuation ? '#f7f8fa' : markFresh ? '#f7f8fa' : '#fdf6f5', border: `1px solid ${!valuation || markFresh ? '#eef0f3' : '#f1c9c3'}` }}>
            <div style={monoLabel}>Ledger-attested mark</div>
            {valuation ? (
              <div style={{ fontSize: 13, color: markFresh ? '#3d4452' : '#a23b2e', marginTop: 5, lineHeight: 1.45 }}>
                <b>{valuation.unitPrice.toFixed(2)} USDC/unit</b> · observed {formatTime(valuation.observedAt)} · {markFresh ? 'fresh for margin actions' : markIssue}
              </div>
            ) : <div style={{ fontSize: 13, color: '#8a929e', marginTop: 5 }}>No valuation has been published for this facility.</div>}
            {(deal.args.valuationStreamId || valuation?.streamId) && <div style={{ ...monoLabel, fontSize: 9, marginTop: 9 }}>Valuation stream · {shortCid(deal.args.valuationStreamId ?? valuation?.streamId ?? '')}</div>}
          </div>
          {status === 'offered' && <div style={{ marginTop: 12, fontSize: 12, color: '#5b6472', lineHeight: 1.45 }}><b>Agreed valuation agent:</b> {agreedAgent}<br /><b>Margin-call window:</b> {Number.isFinite(agreedWindow) ? `${agreedWindow} seconds` : 'not set'}</div>}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}><div style={monoLabel}>Loan-to-value</div><div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: lb.color, background: lb.bg, padding: '3px 9px', borderRadius: 999 }}>{lb.label}</div></div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 24, fontWeight: 600, color: '#14171f', lineHeight: 1 }}>{markPrice ? `${ltv.toFixed(1)}%` : '—'}</div>
          <div style={{ marginTop: 10, height: 7, width: '100%', background: '#eef0f3', borderRadius: 999, overflow: 'hidden' }}><div style={{ height: '100%', width: `${markPrice ? (Math.min(ltv, 120) / 120) * 100 : 0}%`, background: lb.dot, borderRadius: 999 }} /></div>
          {marginCall && <div style={{ marginTop: 18, padding: '11px 13px', borderRadius: 9, background: '#fdf3e0', border: '1px solid #f3dfb4', color: '#815a17', fontSize: 12, lineHeight: 1.45 }}><b>Margin call open.</b><br />Issued at {formatTime(marginCall.issuedAt)} · mark {Number(marginCall.unitPrice).toFixed(2)}<br />Deadline {formatTime(marginCall.deadline)} ({beforeDeadline ? 'window open' : 'deadline passed'})</div>}
        </div>
      </div>

      <div style={{ padding: '26px 28px 24px', borderBottom: '1px solid #eef0f3' }}><div style={{ ...monoLabel, marginBottom: 18 }}>Lifecycle</div><Stepper status={status} /></div>
      <div style={section}><div style={{ ...monoLabel, marginBottom: 14 }}>In the room · who can see this contract</div><RoomChips role={role} /></div>

      <div style={{ padding: '20px 28px', background: '#fbfbfc' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ ...monoLabel, color: '#aeb4be' }}>{actionHint}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {fObserver && <ObserverBadge />}
            {fLenderWithdraw && <ActionButton label="Withdraw offer" onClick={actions.onWithdraw} busy={busy} variant="danger-outline" />}
            {fBorrowerAccept && <ActionButton label="Accept offer" onClick={actions.onAccept} busy={busy} variant="primary" />}
            {role === 'borrower' && status === 'offered' && !beforeMaturity && <DisabledButton label="Offer expired at maturity" />}
            {fBorrowerRepay && <ActionButton label={`Repay ${fmtMoney(repayment)}`} onClick={actions.onRepay} busy={busy} variant="success" />}
            {role === 'lender' && status === 'active' && !marginCall && !fLenderIssue && !fLenderOverdue && <DisabledButton label={markFresh ? (markBreach ? 'Issue margin call' : 'Healthy — no call') : 'Fresh mark required'} />}
            {fLenderIssue && <ActionButton label="Issue margin call" onClick={actions.onIssueMarginCall} busy={busy} variant="danger-outline" />}
            {role === 'borrower' && marginCall && fBorrowerTopUp && <ActionButton label={`Top up ${availableTopUp} units`} onClick={() => actions.onTopUp(availableTopUp)} busy={busy} variant="primary" />}
            {role === 'borrower' && marginCall && !fBorrowerTopUp && fBorrowerResolve && <ActionButton label="Resolve margin call" onClick={actions.onResolveMarginCall} busy={busy} variant="success" />}
            {role === 'borrower' && marginCall && !fBorrowerTopUp && !fBorrowerResolve && <DisabledButton label={!beforeMaturity ? 'Maturity reached — repay or await lender liquidation' : beforeDeadline ? (availableTopUp > 0 ? 'Fresh mark or exact top-up required' : 'No reserve restores LTV') : 'Call expired — lender may liquidate'} />}
            {role === 'lender' && marginCall && beforeDeadline && <DisabledButton label="Liquidate after deadline" />}
            {fLenderLiquidate && <ActionButton label="Liquidate collateral" onClick={actions.onLiquidate} busy={busy} variant="danger" />}
            {role === 'lender' && marginCall && !beforeDeadline && !fLenderLiquidate && <DisabledButton label="Fresh breached mark required" />}
            {fLenderOverdue && <ActionButton label="Liquidate after maturity" onClick={actions.onLiquidateOverdue} busy={busy} variant="danger" />}
            {fClosed && <div style={{ fontSize: 13, color: '#8a929e' }}>This facility is closed.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Avatar({ initials, bg, color }: { initials: string; bg: string; color: string }) {
  return <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, color, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{initials}</div>
}

function ObserverBadge() {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0eefb', border: '1px solid #e0dbf6', color: '#5b46b8', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600 }}><div style={{ width: 7, height: 7, borderRadius: 999, background: '#7c5cd6' }} />Observer — cannot act</div>
}

function DisabledButton({ label }: { label: string }) {
  return <button disabled style={{ background: '#f4f5f7', border: '1px solid #eef0f3', color: '#aeb4be', fontSize: 13, fontWeight: 600, padding: '11px 16px', borderRadius: 9, cursor: 'not-allowed' }}>{label}</button>
}

type Variant = 'primary' | 'success' | 'danger' | 'danger-outline'
const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: { background: '#2748d8', color: '#fff', border: 'none' },
  success: { background: '#1f7a4d', color: '#fff', border: 'none' },
  danger: { background: '#c0392b', color: '#fff', border: 'none' },
  'danger-outline': { background: '#fff', color: '#c0392b', border: '1px solid #e6c4c0' },
}

function ActionButton({ label, onClick, busy, variant }: { label: string; onClick: () => void; busy: boolean; variant: Variant }) {
  return <button onClick={onClick} disabled={busy} style={{ ...VARIANTS[variant], fontSize: 14, fontWeight: 600, padding: '11px 18px', borderRadius: 9, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Working…' : label}</button>
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().replace('T', ' ').replace(/Z$/, ' UTC')}`
}

function shortCid(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}
