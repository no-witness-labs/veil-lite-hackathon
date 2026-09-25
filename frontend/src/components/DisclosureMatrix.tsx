import type { Role } from '../types'
import { DISCLOSURE, DISCLOSURE_COLUMNS, VISIBILITY_META, type Visibility } from '../state'
import { Label, Panel, Tag } from '../ui/primitives'

/** The privacy claim rendered as an auditable matrix rather than prose.
 *
 * Each cell is the structural visibility declared in the Daml template — a
 * party sees a contract only if it is a signatory or observer. The Outsider
 * column is empty by construction, which is exactly what the ledger returns.
 * The demo issuer is shown as a column because it co-signs holdings and loans,
 * even though it is never a viewpoint the UI queries as. */
export function DisclosureMatrix({ role }: { role: Role }) {
  return (
    <Panel title="Disclosure matrix" kicker="structural visibility · per Daml template" flush>
      <div style={{ overflowX: 'auto' }} className="veil-scroll">
        <table className="v-table">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Contract</th>
              {DISCLOSURE_COLUMNS.map((c) => (
                <th key={c.key} className="v-center" style={{ width: 96 }}>
                  <span style={{ color: c.key === role ? 'var(--accent)' : undefined }}>
                    {c.label}
                    {c.key === role && ' ▸'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DISCLOSURE.map((row) => (
              <tr key={row.template}>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--ink-900)' }} className="v-mono">
                    {row.template}
                  </div>
                  <div className="v-metric__note">{row.note}</div>
                </td>
                {DISCLOSURE_COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className="v-center"
                    style={{ background: c.key === role ? 'var(--accent-soft)' : undefined }}
                  >
                    <Cell visibility={row.by[c.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="v-panel__foot" style={{ flexWrap: 'wrap', gap: 'var(--space-5)' }}>
        {(Object.keys(VISIBILITY_META) as Visibility[]).map((v) => {
          const meta = VISIBILITY_META[v]
          return (
            <span key={v} className="v-row" style={{ gap: 'var(--space-2)' }} title={meta.title}>
              <Tag tone={meta.tone}>{meta.glyph}</Tag>
              <Label>{meta.label}</Label>
            </span>
          )
        })}
      </footer>
    </Panel>
  )
}

function Cell({ visibility }: { visibility: Visibility }) {
  const meta = VISIBILITY_META[visibility]
  if (visibility === 'none') {
    return (
      <span aria-label={meta.title} title={meta.title} style={{ color: 'var(--ink-300)' }}>
        ·
      </span>
    )
  }
  return (
    <span title={meta.title} aria-label={meta.title}>
      <Tag tone={meta.tone}>{meta.glyph}</Tag>
    </span>
  )
}
