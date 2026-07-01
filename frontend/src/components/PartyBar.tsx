import type { Role } from '../types'
import { getParties, type RuntimeMode } from '../runtime'
import { ROLE_DOT, ROLE_LABELS } from '../state'

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace" }
const ROLES: Role[] = ['lender', 'borrower', 'regulator', 'outsider']

function shortParty(p: string): string {
  const [hint, fp = ''] = p.split('::')
  return fp ? `${hint}::${fp.slice(0, 8)}…${fp.slice(-4)}` : hint
}

/** Slim strip exposing the active party identifiers. In ledger mode these are
 * Canton parties; in static mode they are deterministic demo identities. */
export function PartyBar({ active, mode }: { active: Role; mode: RuntimeMode }) {
  const parties = getParties()
  const fingerprint = (parties.lender.split('::')[1] ?? '').slice(0, 10)
  const label = mode === 'static' ? 'Static demo parties' : `Canton parties · participant sandbox::${fingerprint}…`
  return (
    <div style={{ borderBottom: '1px solid #eef0f3', background: '#fbfbfc' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '8px 32px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ ...mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9aa1ad', flex: 'none' }}>
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {ROLES.map((r) => {
            const isActive = r === active
            return (
              <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isActive ? 1 : 0.6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: ROLE_DOT[r], flex: 'none' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#5b6472' }}>{ROLE_LABELS[r]}</span>
                <span style={{ ...mono, fontSize: 11, color: '#9aa1ad' }}>{shortParty(parties[r])}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
