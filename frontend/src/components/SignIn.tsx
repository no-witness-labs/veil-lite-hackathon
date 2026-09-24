import type { FormEvent } from 'react'

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace" }

export function SignIn({
  token,
  error,
  busy,
  onTokenChange,
  onSubmit,
}: {
  token: string
  error: string | null
  busy: boolean
  onTokenChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '15vh 32px 64px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 14, height: 14, background: '#2748d8', borderRadius: 3, transform: 'rotate(45deg)' }} />
          <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: '-0.01em', color: '#14171f' }}>Veil</div>
        </div>
        <div style={{ ...mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9aa1ad', marginTop: 12 }}>
          Canton · role sign-in
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, padding: '32px 34px', boxShadow: '0 1px 2px rgba(20,23,31,0.04)' }}
      >
        <div style={{ fontSize: 20, fontWeight: 600, color: '#14171f', marginBottom: 9 }}>Sign in to the sandbox</div>
        <div style={{ fontSize: 14, color: '#5b6472', lineHeight: 1.6, marginBottom: 24 }}>
          Paste the expiring role token issued for your Canton party. The server verifies it before any ledger data is requested.
        </div>
        <label htmlFor="role-token" style={{ ...mono, display: 'block', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a929e', marginBottom: 8 }}>
          Role token
        </label>
        <input
          id="role-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => onTokenChange(event.target.value)}
          disabled={busy}
          placeholder="Paste token"
          style={{ width: '100%', border: '1px solid #cfd4dc', borderRadius: 8, padding: '12px 13px', fontSize: 14, color: '#14171f', outline: 'none', boxSizing: 'border-box' }}
        />
        {error && (
          <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 9, background: '#fbeae8', border: '1px solid #f1c9c3', borderRadius: 8, padding: '10px 12px', marginTop: 14, fontSize: 13, lineHeight: 1.45, color: '#a23b2e' }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: '#c0392b', flex: 'none', marginTop: 5 }} />
            <span>{error}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !token.trim()}
          style={{ width: '100%', marginTop: 18, border: 'none', borderRadius: 8, background: busy || !token.trim() ? '#aeb9e8' : '#2748d8', color: '#fff', fontSize: 14, fontWeight: 600, padding: '12px 16px', cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? 'Verifying token…' : 'Sign in'}
        </button>
        <div style={{ ...mono, fontSize: 10, lineHeight: 1.6, color: '#9aa1ad', marginTop: 18 }}>
          Obtain a role token from the sandbox operator. Tokens are never printed or saved by this app.
        </div>
      </form>
    </main>
  )
}
