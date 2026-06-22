import type { Role } from '../types'
import { ROLE_LABELS } from '../state'

const ROLES: Role[] = ['lender', 'borrower', 'regulator', 'outsider']

export function RoleTabs({ role, onSelect }: { role: Role; onSelect: (r: Role) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#eef0f3', borderRadius: 10, padding: 4 }}>
      {ROLES.map((k) => {
        const active = k === role
        return (
          <button
            key={k}
            onClick={() => onSelect(k)}
            style={{
              border: 'none',
              background: active ? '#fff' : 'transparent',
              color: active ? '#14171f' : '#6b7280',
              fontWeight: active ? 600 : 500,
              fontSize: 13,
              padding: '8px 16px',
              borderRadius: 7,
              cursor: 'pointer',
              boxShadow: active ? '0 1px 2px rgba(20,23,31,0.10)' : 'none',
              transition: 'all .15s',
            }}
          >
            {ROLE_LABELS[k]}
          </button>
        )
      })}
    </div>
  )
}
