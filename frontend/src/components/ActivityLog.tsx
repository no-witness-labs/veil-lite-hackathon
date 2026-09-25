import type { ActivityEntry } from '../types'
import { shortId } from '../state'
import { Label, Panel, Tag } from '../ui/primitives'

// Hackathon deployment targets the Five North Canton DevNet.
const LIGHTHOUSE_TX_BASE = 'https://lighthouse.devnet.cantonloop.com/transactions'

/** Session log of committed ledger transactions — the evidence trail. Each row
 * carries the real update id, offset, and the contracts created and archived.
 * Hidden from the valuer and outsider viewpoints. */
export function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Panel
      title="Ledger activity"
      kicker={`this session · ${entries.length} transaction${entries.length === 1 ? '' : 's'}`}
      flush
    >
      {entries.length === 0 ? (
        <div style={{ padding: 'var(--space-5)' }} className="v-dim">
          No transactions yet. Every action commits a real transaction to Canton and appears here with its
          on-ledger identifiers.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {entries.map((e) => (
            <li key={e.key} style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--line-soft)' }}>
              <div className="v-row" style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <div className="v-row" style={{ gap: 'var(--space-3)', minWidth: 0 }}>
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 600 }}>{e.action}</span>
                  <Label>by {e.actor}</Label>
                </div>
                <Label>offset {e.result.offset}</Label>
              </div>

              <div style={{ marginTop: 'var(--space-2)' }}>
                {e.result.updateId ? (
                  <a
                    href={`${LIGHTHOUSE_TX_BASE}/${encodeURIComponent(e.result.updateId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="v-mono v-break"
                    style={{ fontSize: 'var(--text-xs)' }}
                    title={`${e.result.updateId} — open in Lighthouse (DevNet deployments only)`}
                    aria-label={`View transaction ${e.result.updateId} on Lighthouse`}
                  >
                    {shortId(e.result.updateId, 18, 8)} ↗
                  </a>
                ) : (
                  <span className="v-id">no update id</span>
                )}
                {e.result.synchronizerId && (
                  <div className="v-id v-break" title={e.result.synchronizerId} style={{ marginTop: 2 }}>
                    sync {shortId(e.result.synchronizerId, 18, 8)}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
                {e.result.created.map((c) => (
                  <Effect key={`c-${c.contractId}`} tone="ok" sign="+" label={c.template} cid={c.contractId} />
                ))}
                {e.result.archived.map((c) => (
                  <Effect key={`a-${c.contractId}`} tone="danger" sign="−" label={c.template} cid={c.contractId} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Effect({
  tone,
  sign,
  label,
  cid,
}: {
  tone: 'ok' | 'danger'
  sign: string
  label: string
  cid: string
}) {
  return (
    <div className="v-row" style={{ gap: 'var(--space-2)', alignItems: 'baseline' }}>
      <Tag tone={tone}>
        {sign} {label}
      </Tag>
      <span className="v-id v-break" title={cid} style={{ whiteSpace: 'normal' }}>
        {shortId(cid, 14, 8)}
      </span>
    </div>
  )
}
