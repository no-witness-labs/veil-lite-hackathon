import type { Role } from '../types'
import { ROLE_LABELS } from '../state'

const BUSINESS_ROLES: Role[] = ['lender', 'borrower', 'regulator', 'outsider']
const INFRA_ROLES: Role[] = ['registry', 'operator']

const tabStyle = (active: boolean, infra = false): React.CSSProperties => ({
  border: 'none',
  background: active ? '#fff' : 'transparent',
  color: active ? (infra ? '#1f7a4d' : '#14171f') : '#6b7280',
  fontWeight: active ? 600 : 500,
  fontSize: 13,
  padding: '8px 16px',
  borderRadius: 7,
  cursor: 'pointer',
  boxShadow: active ? '0 1px 2px rgba(20,23,31,0.10)' : 'none',
  transition: 'all .15s',
})

export function RoleTabs({ role, onSelect }: { role: Role; onSelect: (r: Role) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#eef0f3', borderRadius: 10, padding: 4 }}>
        {BUSINESS_ROLES.map((k) => (
          <button key={k} onClick={() => onSelect(k)} style={tabStyle(k === role)}>
            {ROLE_LABELS[k]}
          </button>
        ))}
      </div>
      <div style={{ width: 1, height: 28, background: '#dfe2e7', flex: 'none' }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: '#eef6f3',
          border: '1px solid #d8ebe3',
          borderRadius: 10,
          padding: 4,
        }}
      >
        {INFRA_ROLES.map((k) => (
          <button key={k} onClick={() => onSelect(k)} style={tabStyle(k === role, true)}>
            {ROLE_LABELS[k]}
          </button>
        ))}
      </div>
    </div>
  )
}
