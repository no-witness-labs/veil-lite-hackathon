import { useState } from 'react'
import type { Role } from '../types'
import { PARTY_NAMES } from '../state'
import { Label, Mono, Tag } from '../ui/primitives'

/** The exact JSON the active party receives from the JSON Ledger API v2.
 * For the Outsider this is an empty array — the privacy claim, unmediated. */
export function LedgerInspector({ role, raw, offset }: { role: Role; raw: unknown[]; offset: number }) {
  const [open, setOpen] = useState(false)
  const empty = raw.length === 0

  return (
    <section className="v-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="v-panel__head"
        style={{ width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--line)' }}
      >
        <div className="v-panel__title">
          <h2>Raw ledger view</h2>
          <Label>
            active-contracts as {PARTY_NAMES[role]} · offset {offset} · includes all issuers
          </Label>
        </div>
        <div className="v-row" style={{ gap: 'var(--space-3)' }}>
          <Tag tone={empty ? 'danger' : 'ok'}>
            {empty ? '0 contracts' : `${raw.length} contract${raw.length === 1 ? '' : 's'}`}
          </Tag>
          <span aria-hidden="true" className="v-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {open ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {open && (
        <>
          {empty && (
            <div
              style={{
                padding: 'var(--space-3) var(--space-5)',
                background: 'var(--danger-soft)',
                borderBottom: '1px solid var(--danger-line)',
                fontSize: 'var(--text-base)',
                color: 'var(--ink-700)',
              }}
            >
              This party is not a stakeholder on any contract, so the response is empty. Nothing leaks — there is
              no filtered-out data to reveal.
            </div>
          )}
          <pre className="v-code veil-scroll">
            <Mono>{JSON.stringify(raw, null, 2)}</Mono>
          </pre>
        </>
      )}
    </section>
  )
}
