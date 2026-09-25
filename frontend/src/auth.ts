import type { Session, SessionRole } from './types'

const SESSION_ROLES: readonly SessionRole[] = ['lender', 'borrower', 'valuer', 'regulator', 'outsider', 'operator']

/**
 * The browser keeps the bearer only in this module. It is deliberately not
 * mirrored to either Web Storage API, cookies, or the URL.
 */
let accessToken: string | null = null
let activeSession: Session | null = null
let authGeneration = 0
let authAbortController = new AbortController()

export interface AuthSnapshot {
  token: string
  session: Session
  generation: number
  signal: AbortSignal
}

export class SessionError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SessionError'
    this.status = status
  }
}

export function getSession(): Session | null {
  return activeSession
}

export function clearSession(): void {
  authGeneration += 1
  authAbortController.abort()
  authAbortController = new AbortController()
  accessToken = null
  activeSession = null
}

export function captureSession(): AuthSnapshot {
  if (!accessToken || !activeSession) throw new SessionError('Sign in is required before using the ledger.', 401)
  return { token: accessToken, session: activeSession, generation: authGeneration, signal: authAbortController.signal }
}

export function assertSession(snapshot: AuthSnapshot): void {
  if (
    snapshot.signal.aborted
    || snapshot.generation !== authGeneration
    || snapshot.token !== accessToken
    || snapshot.session !== activeSession
  ) {
    throw new SessionError('The role session changed while the ledger request was in flight.', 409)
  }
}

export function requireSession(snapshot?: AuthSnapshot): Session {
  if (snapshot) {
    assertSession(snapshot)
    return snapshot.session
  }
  return captureSession().session
}

export function requireOperator(snapshot?: AuthSnapshot): Session {
  const session = requireSession(snapshot)
  if (session.role !== 'operator') throw new SessionError('Only the demo operator can reset or seed the demo.', 403)
  return session
}

function isSessionRole(value: unknown): value is SessionRole {
  return typeof value === 'string' && SESSION_ROLES.includes(value as SessionRole)
}

function parseSession(value: unknown): Session {
  if (!value || typeof value !== 'object') throw new SessionError('Session service returned an invalid response.', 502)
  const payload = value as Record<string, unknown>
  if (!isSessionRole(payload.role)) throw new SessionError('Session service returned an unknown role.', 502)
  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : ''
  if (!userId) throw new SessionError('Session service returned no user id.', 502)
  if (typeof payload.expiresAt !== 'number' || !Number.isInteger(payload.expiresAt) || !Number.isFinite(payload.expiresAt)) {
    throw new SessionError('Session service returned no valid expiration.', 502)
  }
  if (payload.expiresAt * 1000 <= Date.now()) throw new SessionError('That role token has expired. Paste a fresh token.', 401)
  return { role: payload.role, userId, expiresAt: payload.expiresAt }
}

/** Verify the pasted token at the server. The client never decodes JWT claims. */
export async function signIn(token: string): Promise<Session> {
  const candidate = token.trim()
  if (!candidate) throw new SessionError('Paste a role token to sign in.', 400)
  const attemptGeneration = authGeneration
  const attemptSignal = authAbortController.signal

  let response: Response
  try {
    response = await fetch('/api/session', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${candidate}` },
      cache: 'no-store',
      signal: attemptSignal,
    })
  } catch (error) {
    if (attemptGeneration !== authGeneration) throw new SessionError('Sign-in was cancelled because the session changed.', 409)
    throw new SessionError(`Session service could not be reached: ${error instanceof Error ? error.message : String(error)}`, 503)
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearSession()
      throw new SessionError('That role token was rejected or has expired. Paste a fresh token.', 401)
    }
    if (response.status === 403) throw new SessionError('This role token is not allowed to use the sandbox.', 403)
    throw new SessionError(`Session service failed (HTTP ${response.status}).`, response.status)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new SessionError('Session service returned invalid JSON.', 502)
  }

  let session: Session
  try {
    session = parseSession(payload)
  } catch (error) {
    if (error instanceof SessionError && error.status === 401) clearSession()
    throw error
  }
  if (attemptGeneration !== authGeneration) throw new SessionError('Sign-in was cancelled because the session changed.', 409)
  authAbortController.abort()
  authAbortController = new AbortController()
  authGeneration += 1
  accessToken = candidate
  activeSession = session
  return session
}

export interface DemoLoginInfo {
  enabled: boolean
  operator: boolean
}

/** Whether this deployment exchanges a demo passcode for a role token. */
export async function demoLoginInfo(): Promise<DemoLoginInfo> {
  try {
    const response = await fetch('/api/demo-login', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) return { enabled: false, operator: false }
    const payload = (await response.json()) as Record<string, unknown>
    return { enabled: payload.enabled === true, operator: payload.operator === true }
  } catch {
    return { enabled: false, operator: false }
  }
}

/** Exchange the demo passcode for a role token, then verify it exactly as a
 * pasted token would be. The passcode is never kept after this call. */
export async function signInWithPasscode(role: SessionRole, passcode: string): Promise<Session> {
  if (!passcode.trim()) throw new SessionError('Enter the demo passcode to sign in.', 400)
  let response: Response
  try {
    response = await fetch('/api/demo-login', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, passcode }),
      cache: 'no-store',
    })
  } catch (error) {
    throw new SessionError(`Sign-in service could not be reached: ${error instanceof Error ? error.message : String(error)}`, 503)
  }
  if (response.status === 401) throw new SessionError('That passcode was not accepted for this role.', 401)
  if (!response.ok) throw new SessionError(`Sign-in service failed (HTTP ${response.status}).`, response.status)
  const payload = (await response.json().catch(() => null)) as { token?: unknown } | null
  if (typeof payload?.token !== 'string' || !payload.token) throw new SessionError('Sign-in service returned no token.', 502)
  return signIn(payload.token)
}
