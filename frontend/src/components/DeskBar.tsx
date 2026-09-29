import { useState } from 'react'
import type { Desk } from '../desk'
import { fmtTimestamp, shortId } from '../state'
import { Button, Panel, Tag } from '../ui/primitives'

const note: React.CSSProperties = { margin: 0, color: 'var(--ink-700)', lineHeight: 'var(--leading-relaxed)' }

/** This browser's desk: its own price streams, offers and loans. Start over
 * closes them on the ledger and opens a fresh desk, after an inline confirm. */
export function DeskBar({
  desk,
  preparing,
  error,
  busy,
  onStartOver,
  onRetry,
}: {
  desk: Desk | null
  preparing: boolean
  error: string | null
  busy: boolean
  onStartOver: () => void
  onRetry: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  const actions = desk && !confirming
    ? <Button size="sm" onClick={() => setConfirming(true)} disabled={busy || preparing}>Start over</Button>
    : !desk && !preparing
      ? <Button size="sm" onClick={onRetry} disabled={busy}>Retry</Button>
      : undefined

  return (
    <Panel
      title="Your desk"
      kicker={desk ? `desk ${shortId(desk.deskId, 8, 4)} · until ${fmtTimestamp(new Date(desk.expiresAt * 1000).toISOString())}` : preparing ? 'opening…' : 'not ready'}
      actions={actions}
    >
      <div style={{ display: 'grid', gap: 'var(--space-3)' }} data-testid="desk-bar">
        {error && !desk && (
          <div className="v-banner v-banner--danger" role="alert">
            <div className="v-banner__body">{error}</div>
          </div>
        )}
        {confirming && desk && (
          <div className="v-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...note, flex: '1 1 16rem' }}>
              Withdraw your offers, close your loans (Canton Coin is released first) and archive your prices, then open a new desk?
            </span>
            <Button size="sm" variant="danger" onClick={() => { setConfirming(false); onStartOver() }} busy={busy}>
              Close and start over
            </Button>
            <Button size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </div>
        )}
        <p style={note}>
          <Tag tone="accent">Your desk</Tag>{' '}
          Your prices, offers and loans stay on your own price streams, so other visitors do not move them. Desks separate
          visitors in this app, not on the ledger: every visitor signs in as the same demo parties and shares their wallets.
        </p>
      </div>
    </Panel>
  )
}
