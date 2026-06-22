import type { Draft } from '../types'
import { fmtMoney } from '../state'

const labelStyle: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono',monospace",
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8a929e',
  marginBottom: 8,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #e6e8ec',
  borderRadius: 9,
  padding: '11px 13px',
  fontFamily: "'IBM Plex Mono',monospace",
  fontSize: 15,
  color: '#14171f',
  outline: 'none',
}

export function CreateOfferForm({
  draft,
  onChange,
  onSubmit,
  busy,
}: {
  draft: Draft
  onChange: (field: keyof Draft, value: number | string) => void
  onSubmit: () => void
  busy: boolean
}) {
  const repayment = draft.principal + draft.interest
  const ltv = draft.collateral > 0 ? ((draft.principal / draft.collateral) * 100).toFixed(1) : '—'

  const num = (field: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange(field, Number(e.target.value) || 0)

  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, boxShadow: '0 1px 2px rgba(20,23,31,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '24px 28px', borderBottom: '1px solid #eef0f3' }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#14171f' }}>Create offer</div>
        <div style={{ fontSize: 13, color: '#8a929e', marginTop: 3 }}>
          Extend a secured credit offer to Northwind Treasury. Prefilled with demo defaults.
        </div>
      </div>
      <div style={{ padding: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div style={labelStyle}>Principal · USDC</div>
            <input type="number" value={draft.principal} onChange={num('principal')} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Interest · USDC</div>
            <input type="number" value={draft.interest} onChange={num('interest')} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Collateral · T-Bill/MMF units</div>
            <input type="number" value={draft.collateral} onChange={num('collateral')} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Maturity</div>
            <input
              type="date"
              value={draft.maturity}
              onChange={(e) => onChange('maturity', e.target.value)}
              style={{ ...inputStyle, fontSize: 14 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, marginTop: 22, padding: '16px 18px', background: '#f7f8fa', borderRadius: 10 }}>
          <div>
            <div style={{ ...labelStyle, marginBottom: 0 }}>Repayment</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 18, fontWeight: 600, color: '#14171f', marginTop: 4 }}>
              {fmtMoney(repayment)}
            </div>
          </div>
          <div style={{ width: 1, background: '#e6e8ec' }} />
          <div>
            <div style={{ ...labelStyle, marginBottom: 0 }}>Loan-to-value</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 18, fontWeight: 600, color: '#14171f', marginTop: 4 }}>
              {ltv}%
            </div>
          </div>
        </div>

        <button
          onClick={onSubmit}
          disabled={busy}
          style={{
            marginTop: 22,
            width: '100%',
            background: busy ? '#9fb0ec' : '#2748d8',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: 14,
            fontSize: 15,
            fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
            letterSpacing: '-0.01em',
          }}
        >
          {busy ? 'Submitting…' : 'Create offer'}
        </button>
      </div>
    </div>
  )
}
