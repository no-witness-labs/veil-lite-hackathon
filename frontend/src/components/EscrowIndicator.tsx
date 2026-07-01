import type { Contract } from '../types'
import { collateralLabel } from '../ledger'
import { ROLE_DOT } from '../state'

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace" }
const accent = ROLE_DOT.operator

/** Shown when the active party holds `Escrow` but cannot see the loan terms (custodian view). */
export function EscrowIndicator({ escrows }: { escrows: Contract[] }) {
  return (
    <div
      data-testid="escrow-indicator"
      style={{
        background: '#fff',
        border: `1px solid #d8ebe3`,
        borderRadius: 14,
        boxShadow: '0 1px 2px rgba(20,23,31,0.04)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '18px 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 999, background: accent, flex: 'none' }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: '#14171f' }}>Collateral in custody</div>
        <div
          style={{
            ...mono,
            marginLeft: 'auto',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: accent,
            background: '#eef6f3',
            padding: '3px 8px',
            borderRadius: 6,
          }}
        >
          Escrow
        </div>
      </div>

      <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {escrows.map((e) => {
          const qty = Number(e.args.collateralQuantity)
          const label = collateralLabel(e.args.collateralInstrumentId)
          return (
            <div key={e.contractId}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f' }}>
                Holding {qty} units · {label}
              </div>
              <div style={{ ...mono, fontSize: 11, color: '#9aa1ad', marginTop: 4 }}>
                Escrow · {e.contractId.slice(0, 10)}…{e.contractId.slice(-4)}
              </div>
            </div>
          )
        })}
        <div style={{ fontSize: 13, color: '#5b6472', lineHeight: 1.55, borderTop: '1px solid #eef0f3', paddingTop: 14 }}>
          Held for a loan whose terms are private to the lender and borrower — the custodian cannot see
          them.
        </div>
      </div>
    </div>
  )
}
