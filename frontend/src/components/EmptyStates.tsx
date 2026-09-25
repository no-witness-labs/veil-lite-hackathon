import type { Role } from '../types'
import { Label } from '../ui/primitives'

/** Outsider view: the privacy payload. Deliberately the emptiest screen in the
 * app — there is genuinely nothing on the ledger for this party to render. */
export function OutsiderEmpty() {
  return (
    <Shell
      glyph={
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="3 4" />
          <line x1="11" y1="29" x2="29" y2="11" stroke="var(--line-strong)" strokeWidth="1.5" />
        </svg>
      }
      title="Not a stakeholder"
      body="On Canton this party sees nothing — no terms, no collateral, no counterparties, not even that a contract
      exists. There is no filtered view to defeat, because the contract was never distributed to this participant’s
      sub-ledger."
      footnote="active-contracts returned 0 rows"
    />
  )
}

/** Borrower / regulator view before any offer exists. */
export function Waiting({ role }: { role: Role }) {
  return (
    <Shell
      glyph={
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <rect x="9" y="9" width="22" height="22" rx="2" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
          <line x1="15" y1="20" x2="25" y2="20" stroke="var(--line-strong)" strokeWidth="1.5" />
        </svg>
      }
      title="No open position"
      body={
        role === 'regulator'
          ? 'Nothing to observe yet. Refresh after the lender originates a facility.'
          : 'The lender has not extended an offer. Refresh after they originate one.'
      }
      footnote="awaiting origination"
    />
  )
}

function Shell({
  glyph,
  title,
  body,
  footnote,
}: {
  glyph: React.ReactNode
  title: string
  body: string
  footnote: string
}) {
  return (
    <section
      className="v-panel"
      style={{
        display: 'grid',
        justifyItems: 'center',
        textAlign: 'center',
        padding: 'var(--space-10) var(--space-7)',
        gap: 'var(--space-4)',
      }}
    >
      {glyph}
      <h2 className="v-display" style={{ fontSize: 'var(--display-md)' }}>
        {title}
      </h2>
      <p
        style={{
          maxWidth: 460,
          fontSize: 'var(--text-md)',
          color: 'var(--ink-500)',
          lineHeight: 'var(--leading-relaxed)',
        }}
      >
        {body}
      </p>
      <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--line-soft)', width: '100%', maxWidth: 460 }}>
        <Label>{footnote}</Label>
      </div>
    </section>
  )
}

/** Shown before the ledger config has been loaded or when it is absent. */
export function ConnectionGate({ connecting, issue }: { connecting: boolean; issue?: string | null }) {
  return (
    <section
      className="v-panel"
      style={{ padding: 'var(--space-10) var(--space-7)', display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 'var(--space-4)' }}
    >
      <h2 className="v-display" style={{ fontSize: 'var(--display-md)' }}>
        {connecting ? 'Connecting to Canton…' : 'Ledger not ready'}
      </h2>
      {connecting ? (
        <p className="v-dim" style={{ fontSize: 'var(--text-md)' }}>Loading ledger configuration.</p>
      ) : (
        <div style={{ maxWidth: 520 }}>
          <p style={{ fontSize: 'var(--text-md)', color: 'var(--ink-500)', lineHeight: 'var(--leading-relaxed)' }}>
            {issue ?? 'No valid ledger configuration found.'} Start the local sandbox, or configure the DevNet
            deployment:
          </p>
          <pre className="v-code" style={{ marginTop: 'var(--space-4)', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
            ./scripts/start-sandbox.sh
          </pre>
          <p className="v-metric__note" style={{ marginTop: 'var(--space-3)' }}>
            For DevNet and Vercel deployments see docs/DEVNET.md.
          </p>
        </div>
      )}
    </section>
  )
}
