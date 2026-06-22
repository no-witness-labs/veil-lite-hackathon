import type { Holding, Role } from '../types'
import { PARTY_NAMES } from '../state'

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace" }

/** The active party's own wallet. Holdings are owner-signatory with no
 * observers, so each role sees only its own — a second privacy signal. */
export function HoldingsPanel({ role, holdings }: { role: Role; holdings: Holding[] }) {
  const cash = holdings.filter((h) => h.kind === 'cash').sort((a, b) => b.amount - a.amount)
  const collateral = holdings.filter((h) => h.kind === 'collateral')

  return (
    <div data-testid="holdings" style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, boxShadow: '0 1px 2px rgba(20,23,31,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid #eef0f3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#14171f' }}>Your holdings</div>
        <div style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a929e' }}>
          {PARTY_NAMES[role]}’s wallet
        </div>
      </div>

      {holdings.length === 0 ? (
        <div style={{ padding: '20px 24px', fontSize: 13, color: '#8a929e' }}>No holdings.</div>
      ) : (
        <div style={{ padding: '14px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cash.map((h) => (
            <Row key={h.contractId} label="Cash" detail="USDC" value={`${h.amount} USDC`} bg="#eef2fe" color="#2748d8" />
          ))}
          {collateral.map((h) => (
            <Row key={h.contractId} label="Collateral" detail={h.asset ?? ''} value={`${h.amount} units`} bg="#f0eefb" color="#6b46c1" />
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ label, detail, value, bg, color }: { label: string; detail: string; value: string; bg: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ ...mono, fontSize: 10, fontWeight: 600, color, background: bg, padding: '3px 8px', borderRadius: 6, flex: 'none' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#5b6472', flex: 1 }}>{detail}</span>
      <span style={{ ...mono, fontSize: 14, fontWeight: 600, color: '#14171f' }}>{value}</span>
    </div>
  )
}
