import { useState, type FormEvent } from 'react'
import type { DemoLoginInfo } from '../auth'
import type { SessionRole } from '../types'
import type { Theme } from '../theme/useTheme'
import { ROLE_LABELS } from '../state'
import { Label } from '../ui/primitives'
import { ThemeToggle } from './ThemeToggle'

const PASSCODE_ROLES: SessionRole[] = ['lender', 'borrower', 'valuer', 'regulator', 'outsider']

/** Token gate. Nothing is requested from the ledger until the server has
 * verified the role token, and the token is never stored or echoed. A hosted
 * deployment may instead exchange a demo passcode for the chosen role's token. */
export function SignIn({
  token,
  error,
  busy,
  onTokenChange,
  onSubmit,
  demoLogin,
  onPasscodeSubmit,
  theme,
  onToggleTheme,
}: {
  token: string
  error: string | null
  busy: boolean
  onTokenChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  demoLogin: DemoLoginInfo
  onPasscodeSubmit: (role: SessionRole, passcode: string) => void
  theme: Theme
  onToggleTheme: () => void
}) {
  const [useToken, setUseToken] = useState(false)
  const passcodeMode = demoLogin.enabled && !useToken
  const canSubmit = !busy && token.trim().length > 0

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="v-row" style={{ justifyContent: 'flex-end', padding: 'var(--space-5) var(--shell-gutter)' }}>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 560,
          margin: '0 auto',
          padding: '8vh var(--space-5) var(--space-10)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-7)' }}>
          <div className="v-row" style={{ gap: 'var(--space-3)', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <rect x="4.5" y="4.5" width="9" height="9" rx="1" transform="rotate(45 9 9)" fill="var(--accent)" />
            </svg>
            <span className="v-wordmark" style={{ fontSize: 'var(--display-md)' }}>Veil</span>
          </div>
          <Label className="v-muted">Canton · role sign-in</Label>
        </div>

        {passcodeMode ? (
          <PasscodeForm
            busy={busy}
            error={error}
            roles={demoLogin.operator ? [...PASSCODE_ROLES, 'operator'] : PASSCODE_ROLES}
            onSubmit={onPasscodeSubmit}
            onUseToken={() => setUseToken(true)}
          />
        ) : (
        <form onSubmit={onSubmit} className="v-panel">
          <header className="v-panel__head">
            <div className="v-panel__title">
              <h2>Sign in to the sandbox</h2>
            </div>
          </header>

          <div style={{ padding: 'var(--space-6) var(--space-7)', display: 'grid', gap: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--text-md)', color: 'var(--ink-500)', lineHeight: 'var(--leading-relaxed)' }}>
              Paste the expiring role token issued for your Canton party. The server verifies it before any ledger
              data is requested.
            </p>

            <div className="v-field">
              <label htmlFor="role-token" className="v-label">
                Role token
              </label>
              <input
                id="role-token"
                className="v-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(event) => onTokenChange(event.target.value)}
                disabled={busy}
                placeholder="Paste token"
              />
            </div>

            {error && (
              <div className="v-banner v-banner--danger" role="alert">
                <span className="v-tag__dot" style={{ marginTop: 7 }} />
                <div className="v-banner__body">{error}</div>
              </div>
            )}

            <button type="submit" disabled={!canSubmit} className="v-btn v-btn--primary v-btn--lg v-btn--block">
              {busy ? 'Verifying token…' : 'Sign in'}
            </button>
          </div>

          <footer className="v-panel__foot">
            <span className="v-metric__note">
              Obtain a role token from the sandbox operator. Tokens are never printed or saved by this app.
            </span>
          </footer>
        </form>
        )}
      </main>
    </div>
  )
}

function PasscodeForm({
  busy,
  error,
  roles,
  onSubmit,
  onUseToken,
}: {
  busy: boolean
  error: string | null
  roles: SessionRole[]
  onSubmit: (role: SessionRole, passcode: string) => void
  onUseToken: () => void
}) {
  const [role, setRole] = useState<SessionRole>('lender')
  const [passcode, setPasscode] = useState('')
  const canSubmit = !busy && passcode.trim().length > 0

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    const value = passcode
    setPasscode('')
    onSubmit(role, value)
  }

  return (
    <form onSubmit={submit} className="v-panel">
      <header className="v-panel__head">
        <div className="v-panel__title">
          <h2>Sign in as a party</h2>
        </div>
      </header>

      <div style={{ padding: 'var(--space-6) var(--space-7)', display: 'grid', gap: 'var(--space-5)' }}>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--ink-500)', lineHeight: 'var(--leading-relaxed)' }}>
          Each party gets its own five-minute session and sees only what Canton discloses to it. Sign out and back in
          to switch parties.
        </p>

        <div className="v-field">
          <span className="v-label">Party</span>
          <div className="v-row" role="radiogroup" aria-label="Party" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {roles.map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={role === candidate}
                className={`v-btn v-btn--sm ${role === candidate ? 'v-btn--primary' : 'v-btn--ghost'}`}
                onClick={() => setRole(candidate)}
                disabled={busy}
              >
                {candidate === 'operator' ? 'Demo operator' : ROLE_LABELS[candidate]}
              </button>
            ))}
          </div>
        </div>

        <div className="v-field">
          <label htmlFor="demo-passcode" className="v-label">
            {role === 'operator' ? 'Operator passcode' : 'Demo passcode'}
          </label>
          <input
            id="demo-passcode"
            className="v-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            disabled={busy}
            placeholder="Passcode from the submission notes"
          />
        </div>

        {error && (
          <div className="v-banner v-banner--danger" role="alert">
            <span className="v-tag__dot" style={{ marginTop: 7 }} />
            <div className="v-banner__body">{error}</div>
          </div>
        )}

        <button type="submit" disabled={!canSubmit} className="v-btn v-btn--primary v-btn--lg v-btn--block">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>

      <footer className="v-panel__foot">
        <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={onUseToken} disabled={busy}>
          Use a role token instead
        </button>
      </footer>
    </form>
  )
}
