import type { Role } from '../types'

const cardBase: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e6e8ec',
  borderRadius: 14,
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  boxShadow: '0 1px 2px rgba(20,23,31,0.04)',
}

const mono: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono',monospace",
}

/** Outsider view: the privacy payload — nothing is visible on the ledger. */
export function OutsiderEmpty() {
  return (
    <div style={{ ...cardBase, padding: '80px 40px' }}>
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 999,
          border: '2px dashed #d2d6dd',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 26,
        }}
      >
        <div style={{ width: 30, height: 30, borderRadius: 999, background: '#eef0f3' }} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: '#14171f', letterSpacing: '-0.01em', marginBottom: 12 }}>
        Not a stakeholder.
      </div>
      <div style={{ fontSize: 15, color: '#5b6472', lineHeight: 1.6, maxWidth: 420 }}>
        On Canton, this party sees nothing — no terms, no collateral, no counterparties, not even that a contract
        exists. The deal is invisible outside the room.
      </div>
      <div
        style={{
          ...mono,
          marginTop: 28,
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#aeb4be',
          borderTop: '1px solid #eef0f3',
          paddingTop: 20,
        }}
      >
        No data on this ledger for this party
      </div>
    </div>
  )
}

/** Borrower / regulator view before any offer exists. */
export function Waiting({ role }: { role: Role }) {
  const text =
    role === 'regulator'
      ? 'No contract to observe yet. Switch to the Lender role to create an offer and start the demo.'
      : 'The lender has not yet extended an offer. Switch to the Lender role to create one and start the demo.'
  return (
    <div style={{ ...cardBase, padding: '72px 40px' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 999,
          background: '#f4f5f7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 22,
        }}
      >
        <div style={{ width: 22, height: 22, borderRadius: 6, border: '2px solid #cfd4dc' }} />
      </div>
      <div style={{ fontSize: 19, fontWeight: 600, color: '#14171f', marginBottom: 10 }}>No active offer</div>
      <div style={{ fontSize: 14, color: '#5b6472', lineHeight: 1.6, maxWidth: 380 }}>{text}</div>
    </div>
  )
}

export function ShockBanner() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#fbeae8',
        border: '1px solid #f1c9c3',
        borderRadius: 10,
        padding: '13px 16px',
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: 999, background: '#d94b3a', flex: 'none' }} />
      <div style={{ fontSize: 13, color: '#a23b2e', lineHeight: 1.45 }}>
        <b>Collateral price shock.</b> T-Bill/MMF units repriced — LTV now breaches the facility limit. The lender
        may liquidate.
      </div>
    </div>
  )
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        background: '#fbeae8',
        border: '1px solid #f1c9c3',
        borderRadius: 10,
        padding: '13px 16px',
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: 999, background: '#c0392b', flex: 'none', marginTop: 5 }} />
      <div style={{ fontSize: 13, color: '#a23b2e', lineHeight: 1.45, flex: 1, wordBreak: 'break-word' }}>
        <b>Ledger error.</b> {message}
      </div>
      <button
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', color: '#a23b2e', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  )
}
