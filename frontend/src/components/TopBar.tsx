import type { Role } from '../types'
import { PARTY_NAMES, ROLE_LABELS, ROLE_SWATCH, ROLE_TONE, ROLES } from '../state'
import { Button, Label, Segmented, Tag } from '../ui/primitives'
import type { Theme } from '../theme/useTheme'
import { ThemeToggle } from './ThemeToggle'

/** Application chrome: identity, the viewpoint, and session controls. Sticky,
 * so the active viewpoint is never scrolled out of sight.
 *
 * Only the demo operator can switch viewpoint or reset the ledger. Every other
 * session is bound to the single party its role token was issued for, so the
 * switcher is replaced by a fixed tag rather than rendered disabled. */
export function TopBar({
  role,
  isOperator,
  onRoleChange,
  onReset,
  onRefresh,
  onSignOut,
  busy,
  loading,
  connected,
  theme,
  onToggleTheme,
}: {
  role: Role
  isOperator: boolean
  onRoleChange: (role: Role) => void
  onReset: () => void
  onRefresh: () => void
  onSignOut: () => void
  busy: boolean
  loading: boolean
  connected: boolean
  theme: Theme
  onToggleTheme: () => void
}) {
  return (
    <header className="v-topbar">
      <div className="v-topbar__inner">
        <Wordmark connected={connected} isOperator={isOperator} />

        <div className="v-grow v-row v-topbar__switch" style={{ justifyContent: 'center' }}>
          {isOperator ? (
            <Segmented
              ariaLabel="Ledger viewpoint"
              value={role}
              onChange={onRoleChange}
              disabled={busy}
              options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], dot: ROLE_SWATCH[r] }))}
            />
          ) : (
            <Tag tone={ROLE_TONE[role]} dot>
              Signed in as {ROLE_LABELS[role]}
            </Tag>
          )}
        </div>

        <div className="v-row v-topbar__identity" style={{ gap: 'var(--space-3)', flex: 'none' }}>
          <div className="v-topbar__who" style={{ textAlign: 'right', lineHeight: 1.3, marginRight: 'var(--space-2)' }}>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink-900)' }}>
              {PARTY_NAMES[role]}
            </div>
            <Label>{ROLE_LABELS[role]}</Label>
          </div>
          {isOperator && (
            <Button
              size="sm"
              onClick={onReset}
              disabled={busy || !connected}
              title="Archive all contracts and re-seed the demo wallets"
            >
              Reset demo
            </Button>
          )}
          <Button size="sm" onClick={onRefresh} disabled={busy || loading || !connected} title="Re-query the ledger as this party">
            Refresh
          </Button>
          <Button size="sm" onClick={onSignOut} disabled={busy} title="Discard the role token held in memory">
            Sign out
          </Button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  )
}

function Wordmark({ connected, isOperator }: { connected: boolean; isOperator: boolean }) {
  return (
    <div className="v-row" style={{ gap: 'var(--space-3)', flex: 'none' }}>
      <svg width="15" height="15" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="4.5" y="4.5" width="9" height="9" rx="1" transform="rotate(45 9 9)" fill="var(--accent)" />
      </svg>
      <span className="v-wordmark">Veil</span>
      <span
        className="v-row"
        style={{
          gap: 'var(--space-2)',
          paddingLeft: 'var(--space-4)',
          borderLeft: '1px solid var(--line-strong)',
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 'var(--radius-pill)',
            background: connected ? 'var(--ok)' : 'var(--ink-300)',
            flex: 'none',
          }}
        />
        <Label>{connected ? 'Canton ledger' : 'Disconnected'}</Label>
      </span>
      {isOperator && <Tag tone="warn">Demo operator</Tag>}
    </div>
  )
}
