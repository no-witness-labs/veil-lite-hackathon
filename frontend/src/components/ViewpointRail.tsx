import type { Role } from '../types'
import { EXPLAINER, PARTY_NAMES, ROLE_INITIALS, ROLE_LABELS, ROLE_TONE } from '../state'
import { Avatar, Label, Panel } from '../ui/primitives'

const note: React.CSSProperties = {
  fontSize: 'var(--text-base)',
  color: 'var(--ink-700)',
  lineHeight: 'var(--leading-relaxed)',
}

/** Persistent explainer for the active viewpoint. Sticky so the "what can this
 * party see and do" framing stays anchored while the blotter scrolls. */
export function ViewpointRail({ role }: { role: Role }) {
  const expl = EXPLAINER[role]

  return (
    <aside
      style={{
        position: 'sticky',
        top: 'calc(var(--topbar-height) + var(--tabbar-height) + var(--space-5))',
        display: 'grid',
        gap: 'var(--space-5)',
        alignContent: 'start',
      }}
    >
      <Panel flush>
        <header
          className="v-row"
          style={{
            gap: 'var(--space-3)',
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: '1px solid var(--line)',
            background: 'var(--surface-raised)',
          }}
        >
          <Avatar initials={ROLE_INITIALS[role]} tone={ROLE_TONE[role]} size="lg" />
          <div style={{ minWidth: 0 }}>
            <Label>Acting as</Label>
            <div className="v-display" style={{ fontSize: 'var(--text-xl)' }}>{ROLE_LABELS[role]}</div>
            <div className="v-metric__note v-truncate">{PARTY_NAMES[role]}</div>
          </div>
        </header>

        <div className="v-section">
          <Label>What this party sees</Label>
          <p style={{ ...note, marginTop: 'var(--space-2)' }}>{expl.sees}</p>
        </div>

        <div className="v-section">
          <Label>What this party can do</Label>
          <p style={{ ...note, marginTop: 'var(--space-2)' }}>{expl.can}</p>
        </div>
      </Panel>

      <Panel title="Why Canton">
        <p style={note}>
          Every Veil contract lives only on its stakeholders’ sub-ledgers. There is no public mempool or global
          state to scan, so no competitor, bot or onlooker can observe the position. Visibility is a property of
          the contract itself, not an access-control layer bolted on top.
        </p>
        <p style={{ ...note, marginTop: 'var(--space-4)' }}>
          The demo issuer is an explicit stakeholder and sees holdings and loans to authorise the simulated
          assets; the valuer still sees only the valuation records it signs.
        </p>
        <p style={{ ...note, marginTop: 'var(--space-4)' }}>
          Repo-style credit is bilateral and KYC’d off-ledger, so counterparty identities are known by design.
          Veil keeps the <i>terms</i> confidential while preserving a provable, auditable record for the parties
          and any invited regulator.
        </p>
      </Panel>
    </aside>
  )
}
