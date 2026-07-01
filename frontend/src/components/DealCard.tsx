import type { Contract, Role, Status } from '../types'
import { collateralLabel } from '../ledger'
import {
  STATUS_TONE,
  dealNumbers,
  fmtDate,
  fmtMoney,
  daysTo,
  lockTone,
  ltvTone,
} from '../state'
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
  onLiquidate: (collateralValue: number) => void
  onSimulateShock: () => void
}

export function DealCard({
  role,
  status,
  deal,
  shock,
  busy,
  actions,
}: {
  role: Role
  status: Status
  deal: Contract
  shock: boolean
  busy: boolean
  actions: DealActions
}) {
  const principal = Number(deal.args.principal)
  const interest = Number(deal.args.interest)
  const collateral = Number(deal.args.collateralQuantity)
  const { collateralValue, ltv, repayment } = dealNumbers({ principal, interest, collateral }, shock)

  const sp = STATUS_TONE[status]
  const lock = lockTone(status)
  const lb = ltvTone(ltv)

  // Action flags by role + status.
  const fInfra = role === 'registry' || role === 'operator'
  const fObserver = role === 'regulator' || fInfra
  const fLenderWithdraw = role === 'lender' && status === 'offered'
  const fBorrowerAccept = role === 'borrower' && status === 'offered'
  const fBorrowerRepay = role === 'borrower' && status === 'active'
  const fLenderActive = role === 'lender' && status === 'active'
  const fShockBtn = fLenderActive && !shock
  const fLiquidateDisabled = fLenderActive && !shock
  const fLiquidateActive = fLenderActive && shock
  const fClosed = (role === 'lender' || role === 'borrower') && (status === 'repaid' || status === 'liquidated')

  let actionHint = 'Actions available to you'
  if (fObserver) {
    if (role === 'registry') actionHint = 'Token issuer — cannot act on the deal'
    else if (role === 'operator') actionHint = 'Escrow custodian — cannot act on the deal'
    else actionHint = 'Read-only observer'
  }
  else if (fClosed) actionHint = 'Facility closed'
  else if (fLenderActive && !shock) actionHint = 'Liquidate available only on LTV breach'

  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, boxShadow: '0 1px 2px rgba(20,23,31,0.04)', overflow: 'hidden' }}>
      {/* header */}
      <div style={{ padding: '22px 28px', borderBottom: '1px solid #eef0f3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: '#14171f', letterSpacing: '-0.01em' }}>Secured Credit Facility</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: '#9aa1ad', marginTop: 3 }}>
            VEIL-0001 · Repo-style · USDC
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: '#bcc2cb', marginTop: 4 }}>
            {deal.template} · {deal.contractId.slice(0, 10)}…{deal.contractId.slice(-4)} · offset {deal.offset}
          </div>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: sp.color, background: sp.bg, padding: '6px 12px', borderRadius: 999 }}>
          {sp.label}
        </div>
      </div>

      {/* parties */}
      <div style={{ ...section, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar initials="MC" bg="#eef2fe" color="#2748d8" />
          <div>
            <div style={{ ...monoLabel, fontSize: 9, letterSpacing: '0.12em' }}>Lender</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f', marginTop: 1 }}>Meridian Capital</div>
          </div>
        </div>
        <div style={{ color: '#cfd4dc', fontSize: 18, flex: 'none' }}>→</div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', textAlign: 'right' }}>
          <div>
            <div style={{ ...monoLabel, fontSize: 9, letterSpacing: '0.12em' }}>Borrower</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f', marginTop: 1 }}>Northwind Treasury</div>
          </div>
          <Avatar initials="NT" bg="#f4f5f7" color="#5b6472" />
        </div>
      </div>

      {/* terms grid */}
      <div style={{ ...section, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
        <div>
          <div style={monoLabel}>Principal</div>
          <div style={monoValue}>{fmtMoney(principal)}</div>
        </div>
        <div>
          <div style={monoLabel}>Interest</div>
          <div style={monoValue}>{interest} USDC · {((interest / principal) * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div style={monoLabel}>Repayment</div>
          <div style={monoValue}>{fmtMoney(repayment)}</div>
        </div>
        <div>
          <div style={monoLabel}>Maturity</div>
          <div style={monoValue}>{fmtDate(deal.args.maturity ?? '')}</div>
          <div style={{ fontSize: 11, color: '#aeb4be', marginTop: 3 }}>Matures in {daysTo(deal.args.maturity ?? '')} days</div>
        </div>
      </div>

      {/* collateral + LTV */}
      <div style={{ ...section, display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 28 }}>
        <div>
          <div style={{ ...monoLabel, marginBottom: 10 }}>Collateral</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f' }}>{collateralLabel(deal.args.collateralInstrumentId)}</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: '#5b6472', marginTop: 3 }}>
                {collateral} units · {collateralValue.toFixed(0)} USDC
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: lock.color, background: lock.bg, padding: '7px 13px', borderRadius: 999, flex: 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: 999, background: lock.dot }} />
              {lock.label}
            </div>
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={monoLabel}>Loan-to-value</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: lb.color, background: lb.bg, padding: '3px 9px', borderRadius: 999 }}>
              {lb.label}
            </div>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 24, fontWeight: 600, color: '#14171f', lineHeight: 1 }}>
            {ltv.toFixed(1)}%
          </div>
          <div style={{ marginTop: 10, height: 7, width: '100%', background: '#eef0f3', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(Math.min(ltv, 120) / 120) * 100}%`, background: lb.dot, borderRadius: 999, transition: 'width .4s ease, background .3s' }} />
          </div>
        </div>
      </div>

      {/* lifecycle */}
      <div style={{ padding: '26px 28px 24px 28px', borderBottom: '1px solid #eef0f3' }}>
        <div style={{ ...monoLabel, marginBottom: 18 }}>Lifecycle</div>
        <Stepper status={status} />
      </div>

      {/* who can see */}
      <div style={{ ...section }}>
        <div style={{ ...monoLabel, marginBottom: 14 }}>In the room · who can see this contract</div>
        <RoomChips role={role} />
      </div>

      {/* action bar */}
      <div style={{ padding: '20px 28px', background: '#fbfbfc' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ ...monoLabel, color: '#aeb4be' }}>{actionHint}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {fInfra && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: role === 'registry' ? '#eef6f3' : '#eef4f8', border: role === 'registry' ? '1px solid #d8ebe3' : '1px solid #d0e0ea', color: role === 'registry' ? '#1f7a4d' : '#2c6e8a', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600 }}>
                <div style={{ width: 7, height: 7, borderRadius: 999, background: role === 'registry' ? '#2ea36a' : '#3a8fb5' }} />
                {role === 'registry' ? 'Registry — cannot act' : 'Custodian — cannot act'}
              </div>
            )}
            {fObserver && !fInfra && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0eefb', border: '1px solid #e0dbf6', color: '#5b46b8', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600 }}>
                <div style={{ width: 7, height: 7, borderRadius: 999, background: '#7c5cd6' }} />
                Observer — cannot act
              </div>
            )}
            {fLenderWithdraw && (
              <ActionButton label="Withdraw offer" onClick={actions.onWithdraw} busy={busy} variant="danger-outline" />
            )}
            {fBorrowerAccept && <ActionButton label="Accept offer" onClick={actions.onAccept} busy={busy} variant="primary" />}
            {fBorrowerRepay && <ActionButton label={`Repay ${fmtMoney(repayment)}`} onClick={actions.onRepay} busy={busy} variant="success" />}
            {fShockBtn && <ActionButton label="Simulate price drop" onClick={actions.onSimulateShock} busy={busy} variant="neutral" />}
            {fLiquidateDisabled && (
              <button disabled style={{ background: '#f4f5f7', border: '1px solid #eef0f3', color: '#bcc2cb', fontSize: 14, fontWeight: 600, padding: '11px 20px', borderRadius: 9, cursor: 'not-allowed' }}>
                Liquidate
              </button>
            )}
            {fLiquidateActive && <ActionButton label="Liquidate collateral" onClick={() => actions.onLiquidate(collateralValue)} busy={busy} variant="danger" />}
            {fClosed && <div style={{ fontSize: 13, color: '#8a929e' }}>This facility is closed.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Avatar({ initials, bg, color }: { initials: string; bg: string; color: string }) {
  return (
    <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, color, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      {initials}
    </div>
  )
}

type Variant = 'primary' | 'success' | 'danger' | 'danger-outline' | 'neutral'
const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: { background: '#2748d8', color: '#fff', border: 'none' },
  success: { background: '#1f7a4d', color: '#fff', border: 'none' },
  danger: { background: '#c0392b', color: '#fff', border: 'none' },
  'danger-outline': { background: '#fff', color: '#c0392b', border: '1px solid #e6c4c0' },
  neutral: { background: '#fff', color: '#5b6472', border: '1px solid #e6e8ec' },
}

function ActionButton({ label, onClick, busy, variant }: { label: string; onClick: () => void; busy: boolean; variant: Variant }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{ ...VARIANTS[variant], fontSize: 14, fontWeight: 600, padding: '11px 22px', borderRadius: 9, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
    >
      {busy ? 'Working…' : label}
    </button>
  )
}
