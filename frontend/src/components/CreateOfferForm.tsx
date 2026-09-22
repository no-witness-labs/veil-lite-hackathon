import { useEffect, useState } from 'react'
import type { Draft, Valuation } from '../types'
import { assessValuation, fmtMoney } from '../state'

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
  valuations,
  liquidationThresholdLtv,
  onChange,
  onSubmit,
  busy,
}: {
  draft: Draft
  valuations: Valuation[]
  liquidationThresholdLtv: number
  onChange: (field: keyof Draft, value: number | string) => void
  onSubmit: () => void
  busy: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const repayment = draft.principal + draft.interest
  const maturityMs = parseMaturity(draft.maturity)
  const termMessage = !Number.isFinite(draft.principal) || draft.principal <= 0
    ? 'Principal must be greater than zero.'
    : !Number.isFinite(draft.interest) || draft.interest < 0
      ? 'Interest cannot be negative.'
      : !Number.isFinite(draft.collateral) || draft.collateral <= 0
        ? 'Collateral quantity must be greater than zero.'
        : !Number.isFinite(maturityMs) || now >= maturityMs
          ? 'Maturity must be a future UTC start-of-day timestamp.'
          : undefined
  const assessment = assessValuation(
    valuations,
    draft.principal,
    draft.collateral,
    liquidationThresholdLtv,
    now,
  )
  const markPrice = assessment.mark?.unitPrice
  const collateralValue = markPrice !== undefined ? draft.collateral * markPrice : undefined
  const ltv = collateralValue !== undefined && collateralValue > 0 ? (draft.principal / collateralValue) * 100 : undefined
  const canSubmit = !busy && !termMessage && assessment.status === 'healthy'
  const statusTone = assessment.status === 'healthy'
    ? { color: '#1f7a4d', bg: '#e8f5ee', border: '#cbe8d7' }
    : { color: '#a23b2e', bg: '#fbeae8', border: '#f1c9c3' }

  const num = (field: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange(field, Number(e.target.value) || 0)

  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, boxShadow: '0 1px 2px rgba(20,23,31,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '24px 28px', borderBottom: '1px solid #eef0f3' }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#14171f' }}>Create offer</div>
        <div style={{ fontSize: 13, color: '#8a929e', marginTop: 3 }}>
          Extend a secured credit offer to Northwind Treasury. The offer uses the current ledger-attested mark.
        </div>
      </div>
      <div style={{ padding: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div style={labelStyle}>Principal · USDC</div>
            <input type="number" min="0" value={draft.principal} onChange={num('principal')} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Interest · USDC</div>
            <input type="number" min="0" value={draft.interest} onChange={num('interest')} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Collateral · T-Bill/MMF units</div>
            <input type="number" min="0" value={draft.collateral} onChange={num('collateral')} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Maturity · UTC start of day</div>
            <input
              type="date"
              value={draft.maturity}
              onChange={(e) => onChange('maturity', e.target.value)}
              style={{ ...inputStyle, fontSize: 14 }}
            />
            <div style={{ fontSize: 11, color: '#aeb4be', marginTop: 6 }}>Acceptance and collateral cures must complete before this deadline. Repayment remains available until the loan closes.</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 22, padding: '16px 18px', background: '#f7f8fa', borderRadius: 10 }}>
          <div>
            <div style={{ ...labelStyle, marginBottom: 0 }}>Repayment</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 600, color: '#14171f', marginTop: 4 }}>
              {Number.isFinite(repayment) ? fmtMoney(repayment) : '—'}
            </div>
          </div>
          <div>
            <div style={{ ...labelStyle, marginBottom: 0 }}>Collateral value @ mark</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 600, color: '#14171f', marginTop: 4 }}>
              {collateralValue !== undefined && Number.isFinite(collateralValue) ? `${collateralValue.toFixed(2)} USDC` : '—'}
            </div>
          </div>
          <div>
            <div style={{ ...labelStyle, marginBottom: 0 }}>Current LTV @ mark</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 600, color: ltv !== undefined && ltv < liquidationThresholdLtv ? '#1f7a4d' : '#a23b2e', marginTop: 4 }}>
              {ltv !== undefined && Number.isFinite(ltv) ? `${ltv.toFixed(1)}%` : '—'}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: '13px 15px', borderRadius: 10, background: statusTone.bg, border: `1px solid ${statusTone.border}`, color: statusTone.color, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Ledger-attested mark</div>
          {assessment.mark ? (
            <>
              <b>{assessment.mark.unitPrice.toFixed(2)} USDC/unit</b> · observed {formatObserved(assessment.mark.observedAt)}<br />
              {assessment.message}
            </>
          ) : assessment.message}
        </div>
        {termMessage && <div style={{ marginTop: 10, color: '#a23b2e', fontSize: 12 }}>{termMessage}</div>}

        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            marginTop: 22,
            width: '100%',
            background: canSubmit ? '#2748d8' : '#9fb0ec',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: 14,
            fontSize: 15,
            fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            letterSpacing: '-0.01em',
          }}
        >
          {busy ? 'Submitting…' : canSubmit ? 'Create offer' : 'Offer terms or mark need attention'}
        </button>
      </div>
    </div>
  )
}

function parseMaturity(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN
  return Date.parse(`${value}T00:00:00.000Z`)
}

function formatObserved(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : `${parsed.toISOString().replace('T', ' ').replace(/Z$/, ' UTC')}`
}
