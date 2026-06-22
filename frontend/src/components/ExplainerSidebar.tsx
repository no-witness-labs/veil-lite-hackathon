import type { Role } from '../types'
import { EXPLAINER, PARTY_NAMES, ROLE_LABELS, SIDEBAR_AVATAR } from '../state'

const label: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono',monospace",
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8a929e',
  marginBottom: 8,
}
const body: React.CSSProperties = { fontSize: 13, color: '#3d4452', lineHeight: 1.6 }

export function ExplainerSidebar({ role }: { role: Role }) {
  const av = SIDEBAR_AVATAR[role]
  const expl = EXPLAINER[role]
  return (
    <div
      style={{
        position: 'sticky',
        top: 96,
        background: '#fff',
        border: '1px solid #e6e8ec',
        borderRadius: 14,
        boxShadow: '0 1px 2px rgba(20,23,31,0.04)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '20px 22px', borderBottom: '1px solid #eef0f3', display: 'flex', alignItems: 'center', gap: 11 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            background: av.bg,
            color: av.color,
            fontFamily: "'IBM Plex Mono',monospace",
            fontWeight: 600,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          {av.initials}
        </div>
        <div>
          <div style={{ ...label, marginBottom: 0, fontSize: 9, letterSpacing: '0.12em' }}>You are</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f' }}>
            {ROLE_LABELS[role]} · {PARTY_NAMES[role]}
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 22px', borderBottom: '1px solid #eef0f3' }}>
        <div style={label}>What you can see</div>
        <div style={body}>{expl.sees}</div>
      </div>

      <div style={{ padding: '20px 22px', borderBottom: '1px solid #eef0f3' }}>
        <div style={label}>What you can do</div>
        <div style={body}>{expl.can}</div>
      </div>

      <div style={{ padding: '20px 22px', borderBottom: '1px solid #eef0f3', background: '#fbfbfc' }}>
        <div style={label}>Why private on Canton</div>
        <div style={body}>
          Every Veil contract lives only on its stakeholders’ sub-ledgers. There is no public mempool or global
          state to scan — so no competitor, bot, or onlooker can observe the position. On a public chain, every
          transaction is visible to all.
        </div>
      </div>

      <div style={{ padding: '20px 22px' }}>
        <div style={label}>Why known counterparties</div>
        <div style={body}>
          Repo-style credit is bilateral and KYC’d off-ledger, so identities are known by design. Veil keeps the{' '}
          <i>terms</i> confidential while preserving a provable, auditable record for the parties and any invited
          regulator.
        </div>
      </div>
    </div>
  )
}
