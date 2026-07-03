import { useState } from 'react'
import type { Role } from '../types'
import { PARTY_NAMES } from '../state'

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace" }

/** Shows the exact JSON the active party gets back from the ledger. */
export function RawInspector({ role, raw, offset }: { role: Role; raw: unknown[]; offset: number }) {
  const [open, setOpen] = useState(false)
  const isEmpty = raw.length === 0
  const json = JSON.stringify(raw, null, 2)

  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, boxShadow: '0 1px 2px rgba(20,23,31,0.04)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '18px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#14171f' }}>Raw ledger view</div>
          <div style={{ fontSize: 12, color: '#8a929e', marginTop: 2 }}>
            active-contracts as {PARTY_NAMES[role]} · offset {offset}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...mono, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', color: isEmpty ? '#a23b2e' : '#1f7a4d', background: isEmpty ? '#fbeae8' : '#e8f5ee', padding: '3px 9px', borderRadius: 999 }}>
            {isEmpty ? '0 contracts' : `${raw.length} contract${raw.length === 1 ? '' : 's'}`}
          </span>
          <span style={{ color: '#9aa1ad', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid #eef0f3', padding: 0 }}>
          {isEmpty && (
            <div style={{ padding: '14px 24px', fontSize: 12, color: '#a23b2e', background: '#fdf6f5' }}>
              This party is not a stakeholder on any contract — the active-contracts response is empty. Nothing leaks.
            </div>
          )}
          <pre style={{ ...mono, fontSize: 11, lineHeight: 1.5, color: '#3d4452', background: '#0d0f140a', margin: 0, padding: '16px 24px', overflowX: 'auto', maxHeight: 360 }}>
            {json}
          </pre>
        </div>
      )}
    </div>
  )
}
