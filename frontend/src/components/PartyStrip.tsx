import type { Role } from '../types'
import { ROLE_LABELS, ROLE_SWATCH, ROLES, shortParty } from '../state'
import { Label } from '../ui/primitives'

/** The real Canton party identifiers allocated on the participant, plus the
 * demo issuer. This is the evidence that switching viewpoint changes the
 * querying party rather than filtering the UI, so it sits alongside the
 * disclosure matrix. */
export function PartyStrip({
  parties,
  issuer,
  active,
}: {
  parties: Record<Role, string>
  issuer: string
  active: Role
}) {
  const fingerprint = (parties.lender.split('::')[1] ?? '').slice(0, 12)
  const rows: { key: string; label: string; swatch: string; party: string; isActive: boolean }[] = [
    ...ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r], swatch: ROLE_SWATCH[r], party: parties[r], isActive: r === active })),
    { key: 'issuer', label: 'Demo issuer', swatch: 'var(--ink-400)', party: issuer, isActive: false },
  ]

  return (
    <div className="v-panel">
      <div className="v-panel__head">
        <div className="v-panel__title">
          <h2>Allocated parties</h2>
          <Label>Participant {fingerprint}…</Label>
        </div>
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-7)', display: 'grid', gap: 'var(--space-3)' }}>
        {rows.map((row) => (
          <div
            key={row.key}
            className="v-row"
            style={{ gap: 'var(--space-3)', opacity: row.isActive ? 1 : 0.6, flexWrap: 'wrap' }}
            title={row.party}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 'var(--radius-pill)',
                background: row.swatch,
                flex: 'none',
              }}
            />
            <span
              style={{
                fontSize: 'var(--text-md)',
                fontWeight: row.isActive ? 600 : 500,
                color: 'var(--ink-900)',
                minWidth: 110,
              }}
            >
              {row.label}
            </span>
            <span className="v-id v-break">{shortParty(row.party)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
