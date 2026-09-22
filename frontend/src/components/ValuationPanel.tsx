import { useState } from 'react'
import type { Contract, Valuation } from '../types'

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace" }
const label: React.CSSProperties = {
  ...mono,
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8a929e',
}

/** Valuer-only publishing surface. A mark is a signed ledger record, not a
 * client-side price toggle or a claim that an external oracle was consulted. */
export function ValuationPanel({
  contracts,
  latest,
  onPublish,
  busy,
}: {
  contracts: Contract[]
  latest?: Valuation
  onPublish: (unitPrice: number) => void
  busy: boolean
}) {
  const [price, setPrice] = useState('1')
  const marks = contracts
    .filter((contract) => contract.template === 'CollateralValuation' && typeof contract.args.streamId === 'string')
    .sort((a, b) => b.offset - a.offset)
  const streamId = marks.length === 1 ? marks[0].args.streamId : undefined
  const streamReady = marks.length === 1 && typeof streamId === 'string'
  const parsedPrice = Number(price)
  const validPrice = Number.isFinite(parsedPrice) && parsedPrice > 0
  const submit = () => {
    if (validPrice) onPublish(parsedPrice)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, boxShadow: '0 1px 2px rgba(20,23,31,0.04)', overflow: 'hidden' }}>
      <div style={{ padding: '24px 28px', borderBottom: '1px solid #eef0f3' }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#14171f' }}>Publish collateral mark</div>
        <div style={{ fontSize: 13, color: '#8a929e', marginTop: 4, lineHeight: 1.5 }}>
          Sign a timestamped unit price for the Veil demo deal. This is manually attested demo data; it is not a live
          oracle feed.
        </div>
        <div style={{ ...label, marginTop: 14 }}>
          {streamReady ? `Current stream lineage · ${shortCid(streamId ?? '')}` : `Current mark unavailable · ${marks.length} found`}
        </div>
        {!streamReady && <div style={{ fontSize: 12, color: '#a23b2e', marginTop: 6 }}>Exactly one current mark with a stream lineage is required before publishing.</div>}
      </div>

      <div style={{ padding: 28 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setPrice('1')} disabled={busy} style={presetStyle}>
            Healthy · 1.00
          </button>
          <button onClick={() => setPrice('0.62')} disabled={busy} style={presetStyle}>
            Stress · 0.62
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'end', gap: 12, marginTop: 18 }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...label, marginBottom: 8 }}>Unit price · USDC</div>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              style={{ width: '100%', border: '1px solid #e6e8ec', borderRadius: 9, padding: '11px 13px', ...mono, fontSize: 15, color: '#14171f', outline: 'none' }}
            />
          </div>
          <button onClick={submit} disabled={busy || !validPrice || !streamReady} style={publishStyle(busy || !validPrice || !streamReady)}>
            {busy ? 'Publishing…' : 'Publish mark'}
          </button>
        </div>

        <div style={{ marginTop: 22, padding: '14px 16px', borderRadius: 10, background: '#f7f8fa' }}>
          <div style={label}>Latest visible mark</div>
          {latest ? (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginTop: 6 }}>
              <div style={{ ...mono, fontSize: 20, fontWeight: 600, color: '#14171f' }}>{latest.unitPrice.toFixed(2)} USDC/unit</div>
              <div style={{ ...mono, fontSize: 10, color: '#8a929e', textAlign: 'right' }}>{formatObserved(latest.observedAt)}</div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#8a929e', marginTop: 6 }}>No mark published yet.</div>
          )}
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={label}>Signed valuation history · {marks.length}</div>
          {marks.length === 0 ? (
            <div style={{ fontSize: 13, color: '#8a929e', marginTop: 8 }}>Your signed marks will appear here.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
              {marks.slice(0, 4).map((mark) => (
                <div key={mark.contractId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12, color: '#5b6472' }}>
                  <span style={{ ...mono, fontWeight: 600, color: '#14171f' }}>{Number(mark.args.unitPrice).toFixed(2)} USDC/unit</span>
                  <span style={{ ...mono, fontSize: 10, color: '#9aa1ad' }}>{formatObserved(mark.args.observedAt ?? '')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const presetStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e6e8ec',
  color: '#5b6472',
  borderRadius: 8,
  padding: '9px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

const publishStyle = (busy: boolean): React.CSSProperties => ({
  background: busy ? '#95cfc3' : '#197d69',
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  padding: '11px 16px',
  fontSize: 14,
  fontWeight: 600,
  cursor: busy ? 'wait' : 'pointer',
  whiteSpace: 'nowrap',
})

function formatObserved(value: string): string {
  if (!value) return 'unknown time'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function shortCid(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}
