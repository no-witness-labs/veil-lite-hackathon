const crypto = require('node:crypto')

// Shared response plumbing for every api/ handler: a request id on every
// response, one error envelope ({code, message, requestId}), one structured
// log line per request, and bounded upstream fetches.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
const UPSTREAM_TIMEOUT_MS = 25_000

const MESSAGES = Object.freeze({
  AUTH_REQUIRED: 'Sign in to continue.',
  AUTH_INVALID: 'The session token was rejected. Sign in again.',
  AUTH_EXPIRED: 'The session expired. Sign in again.',
  AUTH_NOT_YET_VALID: 'The session token is not valid yet. Check the clock and sign in again.',
  AUTH_UNAVAILABLE: 'Sign-in is not configured on this server.',
  AUTH_ERROR: 'Sign-in failed.',
  ROLE_FORBIDDEN: 'This role may not perform that request.',
  PARTY_FORBIDDEN: 'This role may not act or read as that party.',
  USER_FORBIDDEN: 'The request names a different ledger user than the session.',
  COMMAND_FORBIDDEN: 'This role may not submit that command.',
  REQUEST_INVALID: 'The request is malformed.',
  REQUEST_TOO_LARGE: 'The request body is too large.',
  ROUTE_NOT_FOUND: 'No such route.',
  METHOD_NOT_ALLOWED: 'That method is not allowed on this route.',
  PASSCODE_INVALID: 'That passcode was not accepted for this role.',
  DEMO_LOGIN_DISABLED: 'Passcode sign-in is not enabled here.',
  UPSTREAM_UNAVAILABLE: 'The ledger credential service is unavailable.',
  REGISTRY_UNAVAILABLE: 'The token registry is not configured here.',
  REGISTRY_PROXY_ERROR: 'The token registry could not be reached.',
  REGISTRY_TIMEOUT: 'The token registry did not answer in time.',
  REGISTRY_RESPONSE_TOO_LARGE: 'The token registry returned an oversized response.',
  PROXY_ERROR: 'The ledger could not be reached.',
  LEDGER_TIMEOUT: 'The ledger did not answer in time; the outcome is unknown.',
  LEDGER_ERROR: 'The ledger returned an error.',
  CONFIG_ERROR: 'Ledger configuration is incomplete on this server.',
})

function header(req, name) {
  const value = req?.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function requestIdFor(req) {
  const incoming = header(req, 'x-request-id')
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID()
}

/** Tag the response with a request id and log one line when it ends. `route`
 * is a pattern, never the raw path, so contract ids and queries stay out of logs. */
function beginRequest(req, res, route) {
  if (res.veilRequest) {
    if (route) res.veilRequest.route = route
    return res.veilRequest
  }
  const ctx = {
    id: requestIdFor(req),
    method: String(req?.method || 'GET').toUpperCase(),
    route: route || 'unknown',
    role: null,
    ledgerCode: undefined,
    start: Date.now(),
    logged: false,
  }
  res.veilRequest = ctx
  res.setHeader('X-Request-Id', ctx.id)
  const end = res.end
  res.end = function endAndLog(...args) {
    if (!ctx.logged) {
      ctx.logged = true
      logRequest(ctx, res.statusCode)
    }
    return end.apply(this, args)
  }
  return ctx
}

function logRequest(ctx, status) {
  const line = {
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    msg: 'request',
    requestId: ctx.id,
    method: ctx.method,
    route: ctx.route,
    status,
    durationMs: Date.now() - ctx.start,
    role: ctx.role,
  }
  if (ctx.ledgerCode) line.ledgerCode = ctx.ledgerCode
  console.log(JSON.stringify(line))
}

function noteRole(res, role) {
  if (res.veilRequest) res.veilRequest.role = role
}

function requestId(res) {
  return res.veilRequest ? res.veilRequest.id : beginRequest(undefined, res).id
}

function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(value))
}

/** Every error body is {code, message, requestId} plus optional safe fields. */
function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { code, message: message || MESSAGES[code] || 'The request failed.', requestId: requestId(res), ...extra })
}

/** fetch() for server-to-server calls: no redirects (a redirect could carry the
 * node bearer to another origin) and a hard deadline. */
function upstreamFetch(url, init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
}

function isTimeout(error) {
  return error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError'
}

class ResponseTooLargeError extends Error {
  constructor() {
    super('upstream response too large')
    this.name = 'ResponseTooLargeError'
  }
}

/** Read a response body, refusing once it exceeds maxBytes. */
async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new ResponseTooLargeError()
  }
  if (!response.body) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new ResponseTooLargeError()
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/* ------------------------------------------------ Ledger error hygiene -- */

// Canton's JSON API error body carries the participant name, trace ids, the
// submitted command (parties, user, dedup period), exercise traces with package
// ids and more. The browser needs only: which error, its category (to tell a
// definite rejection from an unknown outcome) and, for a Daml failure, the
// contract's own message, which is the text the user acts on (stale price,
// LTV breach, ...).
const ERROR_ID_PATTERN = /^[A-Za-z0-9_./:-]{1,160}$/
const MAX_MESSAGE_LENGTH = 400

const LEDGER_MESSAGES = Object.freeze({
  CONTRACT_NOT_FOUND: 'A contract this action uses is no longer active. Refresh and try again.',
  CONTRACT_NOT_ACTIVE: 'A contract this action uses is no longer active. Refresh and try again.',
  DAML_AUTHORIZATION_ERROR: 'The ledger refused the action: the submitting party lacks the required authority.',
  LOCAL_VERDICT_LOCKED_CONTRACTS: 'Another transaction is using the same contracts. Refresh and try again.',
  LOCAL_VERDICT_INACTIVE_CONTRACTS: 'A contract this action uses was archived meanwhile. Refresh and try again.',
  INCONSISTENT_CONTRACTS: 'A contract this action uses changed meanwhile. Refresh and try again.',
  DUPLICATE_COMMAND: 'This command was already submitted.',
  SUBMISSION_ALREADY_IN_FLIGHT: 'This command is already being processed.',
  REQUEST_TIMEOUT: 'The ledger did not answer in time; the outcome is unknown.',
  PERMISSION_DENIED: 'The ledger refused the credential for this request.',
  UNAUTHENTICATED: 'The ledger refused the credential for this request.',
  PACKAGE_NOT_FOUND: 'The Veil package is not available on this ledger.',
  TEMPLATES_OR_INTERFACES_NOT_FOUND: 'The Veil package is not available on this ledger.',
})

function clip(text) {
  const trimmed = text.trim()
  return trimmed.length > MAX_MESSAGE_LENGTH ? `${trimmed.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : trimmed
}

/** The user-facing part of a Canton cause/status message, if it is a Daml failure. */
function damlMessage(cause) {
  if (typeof cause !== 'string') return null
  const failure = /User failure: (\S+) \(error category \d+\): ([\s\S]+)$/.exec(cause)
  if (failure) return { errorId: failure[1], message: clip(failure[2]) }
  const abort = /User abort: ([\s\S]+)$/.exec(cause)
  if (abort) return { errorId: undefined, message: clip(abort[1]) }
  return null
}

/** Reduce an upstream ledger error body to {code, message, errorId, category}. */
function sanitizeLedgerError(status, raw) {
  let body
  try {
    body = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw))
  } catch {
    body = null
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.code !== 'string' || !ERROR_ID_PATTERN.test(body.code)) {
    return { code: 'LEDGER_ERROR', message: `The ledger returned HTTP ${status}.`, status }
  }
  const daml = damlMessage(body.cause)
  const contextId = typeof body.context?.error_id === 'string' && ERROR_ID_PATTERN.test(body.context.error_id) ? body.context.error_id : undefined
  const candidateId = contextId || daml?.errorId
  const errorId = candidateId && ERROR_ID_PATTERN.test(candidateId) ? candidateId : undefined
  const category = Number.isSafeInteger(body.errorCategory) ? body.errorCategory : undefined
  const message = daml?.message || LEDGER_MESSAGES[body.code] || `The ledger rejected the request (${body.code}).`
  const result = { code: body.code, message, status }
  if (errorId) result.errorId = errorId
  if (category !== undefined) result.category = category
  return result
}

/** Same reduction for a completion's google.rpc.Status (code/message/details). */
function sanitizeCompletionStatus(status) {
  const message = typeof status?.message === 'string' ? status.message : ''
  // "<ERROR_CODE>(<category>,<correlation>): <cause>"
  const head = /^([A-Za-z0-9_.-]{1,160})\((\d+),[^)]*\): ([\s\S]*)$/.exec(message)
  const code = head ? head[1] : 'LEDGER_REJECTED'
  const category = head ? Number(head[2]) : undefined
  const daml = damlMessage(head ? head[3] : message)
  const result = {
    code,
    message: daml?.message || LEDGER_MESSAGES[code] || `The ledger rejected the command (${code}).`,
  }
  if (daml?.errorId && ERROR_ID_PATTERN.test(daml.errorId)) result.errorId = daml.errorId
  if (Number.isSafeInteger(category)) result.category = category
  return result
}

module.exports = {
  MESSAGES,
  REQUEST_ID_PATTERN,
  ResponseTooLargeError,
  beginRequest,
  isTimeout,
  noteRole,
  readCapped,
  requestId,
  sanitizeCompletionStatus,
  sanitizeLedgerError,
  sendError,
  sendJson,
  upstreamFetch,
}
