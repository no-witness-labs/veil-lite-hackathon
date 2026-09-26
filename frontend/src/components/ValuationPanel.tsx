import { useState } from 'react'
import type { Contract } from '../types'
import { UNIT_CASH, fmtTimestamp, shortId } from '../state'
import { Button, Field, Label, Metric, Panel, Section, Tag } from '../ui/primitives'

/** Preset marks for the demo: par, and the stressed mark that breaches the
 * default 150-unit facility's 90% threshold. */
const PRESETS = [
  { label: 'Healthy · 1.00', value: '1' },
  { label: 'Stress · 0.62', value: '0.62' },
]

/** Valuer-only publishing surface. A mark is a signed ledger record, not a
 * client-side price toggle or a claim that an external oracle was consulted.
 * Each eligible collateral asset has its own agreed stream and current mark. */
export function ValuationPanel({
  contracts,
  assets,
  onPublish,
  busy,
}: {
  contracts: Contract[]
  assets: readonly string[]
  onPublish: (unitPrice: number, asset: string) => void
  busy: boolean
}) {
  const [price, setPrice] = useState('1')
  const [asset, setAsset] = useState(assets[0])
  const allMarks = contracts
    .filter((contract) => contract.template === 'CollateralValuation' && typeof contract.args.streamId === 'string')
    .sort((a, b) => b.offset - a.offset)
  const marks = allMarks.filter((contract) => contract.args.collateralAsset === asset)
  const latest = marks.length === 1 ? marks[0] : undefined
  const streamId = latest?.args.streamId
  const streamReady = typeof streamId === 'string'
  const parsedPrice = Number(price)
  const validPrice = Number.isFinite(parsedPrice) && parsedPrice > 0
  const submit = () => {
    if (validPrice) onPublish(parsedPrice, asset)
  }

  return (
    <Panel
      title="Publish collateral mark"
      kicker={streamReady ? `stream · ${shortId(streamId ?? '', 10, 6)}` : `current mark unavailable · ${marks.length} found`}
      actions={<Tag tone={streamReady ? 'ok' : 'danger'} dot>{streamReady ? 'Stream ready' : 'No single stream'}</Tag>}
      flush
    >
      <div style={{ padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-5)' }}>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--ink-500)', lineHeight: 'var(--leading-relaxed)' }}>
          Sign a timestamped unit price for the Veil demo deal. This is manually attested demo data; it is not a live
          oracle feed.
        </p>
        <div className="v-row" role="radiogroup" aria-label="Collateral asset" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {assets.map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={candidate === asset ? 'primary' : 'ghost'}
              onClick={() => setAsset(candidate)}
              disabled={busy}
            >
              {candidate}
            </Button>
          ))}
        </div>
        {!streamReady && (
          <p className="v-metric__note" style={{ color: 'var(--danger)' }}>
            Exactly one current {asset} mark with a stream lineage is required before publishing.
          </p>
        )}

        <div className="v-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <Button key={p.value} size="sm" onClick={() => setPrice(p.value)} disabled={busy}>
              {p.label}
            </Button>
          ))}
        </div>

        <div className="v-row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="v-grow" style={{ minWidth: 200 }}>
            <Field label={`Unit price · ${UNIT_CASH}`}>
              <input
                className="v-input"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </Field>
          </div>
          <Button variant="primary" size="lg" onClick={submit} busy={busy} disabled={!validPrice || !streamReady}>
            Publish mark
          </Button>
        </div>
      </div>

      <Section label={`Latest visible mark · ${asset}`}>
        {latest ? (
          <div className="v-row" style={{ justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <Metric label="" value={Number(latest.args.unitPrice).toFixed(2)} unit={`${UNIT_CASH} / unit`} size="lg" />
            <Label>observed {fmtTimestamp(latest.args.observedAt ?? '')}</Label>
          </div>
        ) : (
          <p className="v-dim">No mark published yet.</p>
        )}
      </Section>

      <Section label={`Current marks · ${allMarks.length}`}>
        {allMarks.length === 0 ? (
          <p className="v-dim">Your signed marks will appear here.</p>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            {allMarks.map((mark) => (
              <div key={mark.contractId} className="v-row" style={{ justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span className="v-mono" style={{ fontWeight: 600, color: 'var(--ink-900)' }}>
                  {mark.args.collateralAsset} · {Number(mark.args.unitPrice).toFixed(2)} {UNIT_CASH} / unit
                </span>
                <span className="v-id">{fmtTimestamp(mark.args.observedAt ?? '')}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </Panel>
  )
}
