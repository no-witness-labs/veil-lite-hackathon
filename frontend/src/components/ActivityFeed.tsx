import type { ActivityEntry } from '../types'

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace" }
const short = (id: string) => (id.length > 14 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id)

const monoLabel: React.CSSProperties = {
  ...mono,
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8a929e',
}

/** Session log of committed transactions — the on-ledger evidence that actions
 * really hit Canton (transaction id, ledger offset, created/archived contracts). */
export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, boxShadow: '0 1px 2px rgba(20,23,31,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid #eef0f3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#14171f' }}>Ledger activity</div>
        <div style={monoLabel}>this session · {entries.length} tx</div>
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: '28px 24px', fontSize: 13, color: '#8a929e' }}>
          No transactions yet. Each action you take commits a real transaction to the Canton sandbox and will
          appear here with its on-ledger identifiers.
        </div>
      ) : (
        <div>
          {entries.map((e) => (
            <div key={e.key} style={{ padding: '16px 24px', borderTop: '1px solid #f4f5f7' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f' }}>{e.action}</div>
                <div style={{ ...mono, fontSize: 11, color: '#9aa1ad' }}>offset {e.result.offset}</div>
              </div>
              <div style={{ fontSize: 12, color: '#8a929e', marginTop: 2 }}>by {e.actor}</div>

              <div style={{ ...mono, fontSize: 11, color: '#5b6472', marginTop: 8, background: '#f7f8fa', borderRadius: 8, padding: '8px 10px', wordBreak: 'break-all' }}>
                <div>tx {short(e.result.updateId)}</div>
                {e.result.synchronizerId && (
                  <div style={{ color: '#9aa1ad', marginTop: 3 }}>sync {short(e.result.synchronizerId)}</div>
                )}
              </div>

              {e.result.created.map((c) => (
                <Chip key={`c-${c.contractId}`} tone="created" label={`+ created ${c.template}`} cid={c.contractId} />
              ))}
              {e.result.archived.map((c) => (
                <Chip key={`a-${c.contractId}`} tone="archived" label={`− archived ${c.template}`} cid={c.contractId} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Chip({ tone, label, cid }: { tone: 'created' | 'archived'; label: string; cid: string }) {
  const color = tone === 'created' ? '#1f7a4d' : '#a23b2e'
  const bg = tone === 'created' ? '#e8f5ee' : '#fbeae8'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <span style={{ ...mono, fontSize: 10, fontWeight: 600, color, background: bg, padding: '2px 7px', borderRadius: 6, flex: 'none' }}>{label}</span>
      <span style={{ ...mono, fontSize: 11, color: '#9aa1ad', wordBreak: 'break-all' }}>{short(cid)}</span>
    </div>
  )
}
