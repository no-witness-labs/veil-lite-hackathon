const { authenticate, authorizeLedgerRequest, AuthError, knownParties, MAX_BODY_BYTES, respondError, routePolicy } = require('./_auth')
const { upstreamConfig, upstreamToken } = require('./_upstream')
const { beginRequest, isTimeout, noteRole, sanitizeCompletionStatus, sanitizeLedgerError, sendError, upstreamFetch } = require('./_http')

const DEFAULT_LEDGER_TARGET = 'https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services'
const SUBMIT_PATH = '/v2/commands/submit-and-wait-for-transaction'
const COMPLETIONS_PATH = '/v2/commands/completions'
// The completions endpoint is a blocking list: it returns after `limit`
// elements or once the stream has been idle this long. The proxy pins both.
const COMPLETIONS_QUERY = '?limit=200&stream_idle_timeout_ms=1000'
const KNOWN_ROUTES = new Set(['/v2/state/ledger-end', '/v2/state/active-contracts', SUBMIT_PATH, COMPLETIONS_PATH])

function stripTrailingSlash(value) {
  return value.replace(/\/$/, '')
}

function env(name, fallback = '', source = process.env) {
  return source?.[name] || fallback
}

function ledgerTarget(source = process.env) {
  return stripTrailingSlash(env('VEIL_LEDGER_TARGET', DEFAULT_LEDGER_TARGET, source))
}

function ledgerConfig(source = process.env) {
  const { issuer, parties } = knownParties(source)
  return {
    jsonApiUrl: '',
    packageRef: env('VEIL_PACKAGE_REF', '#veil-lite', source),
    issuer,
    parties,
  }
}

/** Route label for logs: a known route, never a raw path or query. */
function routeLabel(path) {
  const pathname = String(path).split('?')[0]
  return KNOWN_ROUTES.has(pathname) ? pathname : '/v2/*'
}

async function proxyLedgerRequest(req, res, path, options = {}) {
  const source = options.env || req?.veilEnv || process.env
  const method = String(req.method || 'GET').toUpperCase()
  const ctx = beginRequest(req, res, routeLabel(path))
  let policy
  try {
    policy = routePolicy(path, method)
    if (policy.options) {
      authorizeLedgerRequest(req, path, undefined, source)
      res.statusCode = 204
      res.setHeader('Allow', policy.allow.join(', '))
      res.setHeader('Cache-Control', 'no-store')
      res.end()
      return
    }

    // Authenticate before reading or parsing an untrusted body so malformed
    // input cannot turn an unauthenticated request into a parser oracle.
    noteRole(res, authenticate(req, source).role)
    const rawBody = method === 'GET' || method === 'HEAD' ? undefined : await requestBody(req)
    const body = method === 'GET' || method === 'HEAD' ? undefined : parseJsonBody(rawBody)
    const { auth, policy: authorized } = authorizeLedgerRequest(req, path, body, source)
    const shared = upstreamConfig(source)
    const bearer = shared ? await upstreamToken(shared) : auth.token
    const target = options.target ? stripTrailingSlash(options.target) : ledgerTarget(source)
    const query = authorized.path === COMPLETIONS_PATH ? COMPLETIONS_QUERY : ''
    let upstream
    let responseBody
    try {
      upstream = await upstreamFetch(`${target}${authorized.path}${query}`, {
        method,
        headers: upstreamHeaders(req, bearer),
        body: method === 'GET' || method === 'HEAD' ? undefined : upstreamBody(rawBody, body, authorized.path, shared),
      }, options.timeoutMs)
      responseBody = Buffer.from(await upstream.arrayBuffer())
    } catch (error) {
      // The request may have reached the ledger: for a submission the outcome
      // is unknown, which the UI resolves through the completions route.
      if (isTimeout(error)) sendError(res, 504, 'LEDGER_TIMEOUT')
      else sendError(res, 502, 'PROXY_ERROR')
      return
    }
    if (!upstream.ok) {
      const { code, message, errorId, category } = sanitizeLedgerError(upstream.status, responseBody)
      ctx.ledgerCode = code
      sendError(res, upstream.status, code, message, {
        ...(errorId ? { errorId } : {}),
        ...(category !== undefined ? { category } : {}),
      })
      return
    }
    res.statusCode = upstream.status
    res.setHeader('Cache-Control', 'no-store')
    if (authorized.path === COMPLETIONS_PATH) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(compactCompletions(responseBody)))
      return
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.end(responseBody)
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 405) res.setHeader('Allow', (policy?.allow || error.allow || []).join(', '))
      respondError(res, error)
      return
    }
    sendError(res, 502, 'PROXY_ERROR')
  }
}

/** Reduce the completion stream to what the UI needs to resolve a command:
 * its id, offset and either the update id or a sanitized rejection. Trace
 * contexts, submission ids, dedup periods and act-as lists are dropped. */
function compactCompletions(raw) {
  let entries
  try {
    entries = JSON.parse(raw.toString('utf8'))
  } catch {
    entries = null
  }
  if (!Array.isArray(entries)) throw new Error('completions: unexpected response')
  const completions = []
  let lastOffset = null
  for (const entry of entries) {
    const response = entry?.completionResponse
    const checkpoint = response?.OffsetCheckpoint?.value?.offset
    if (Number.isSafeInteger(checkpoint)) lastOffset = Math.max(lastOffset ?? 0, checkpoint)
    const value = response?.Completion?.value
    if (!value || typeof value.commandId !== 'string' || !Number.isSafeInteger(value.offset)) continue
    lastOffset = Math.max(lastOffset ?? 0, value.offset)
    const status = value.status
    const succeeded = !status || status.code === 0
    completions.push(succeeded
      ? { commandId: value.commandId, offset: value.offset, succeeded: true, updateId: typeof value.updateId === 'string' ? value.updateId : '' }
      : { commandId: value.commandId, offset: value.offset, succeeded: false, error: sanitizeCompletionStatus(status) })
  }
  return { completions, lastOffset }
}

function upstreamHeaders(req, bearer) {
  const headers = {}
  const contentType = header(req, 'content-type')
  if (contentType) headers['Content-Type'] = contentType
  const accept = header(req, 'accept')
  if (accept) headers.Accept = accept
  // Locally this is the caller's verified role token, so Canton re-checks the
  // role's user rights. On the shared node it is the team's ledger-user token,
  // substituted only after the role checks in authorizeLedgerRequest passed.
  headers.Authorization = `Bearer ${bearer}`
  return headers
}

/** On the shared node, commands and completion queries must name the team's
 * ledger user rather than the role subject the browser session carries. The
 * body is otherwise the already-validated request, forwarded unchanged. */
function upstreamBody(rawBody, body, path, shared) {
  if (!shared) return rawBody
  if (path === SUBMIT_PATH) return JSON.stringify({ ...body, commands: { ...body.commands, userId: shared.ledgerUserId } })
  if (path === COMPLETIONS_PATH) return JSON.stringify({ ...body, userId: shared.ledgerUserId })
  return rawBody
}

function requestBody(req) {
  if (req.body !== undefined) {
    const value = Buffer.isBuffer(req.body) || typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
    if (buffer.length > MAX_BODY_BYTES) throw new AuthError(413, 'REQUEST_TOO_LARGE')
    return Promise.resolve(buffer)
  }

  if (!req || typeof req.on !== 'function') throw new AuthError(400, 'REQUEST_INVALID')

  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        reject(new AuthError(413, 'REQUEST_TOO_LARGE'))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseJsonBody(raw) {
  if (!raw || raw.length === 0) throw new AuthError(400, 'REQUEST_INVALID')
  try {
    const body = JSON.parse(raw.toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object expected')
    return body
  } catch {
    throw new AuthError(400, 'REQUEST_INVALID')
  }
}

function header(req, name) {
  const value = req?.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

module.exports = {
  ledgerConfig,
  ledgerTarget,
  parseJsonBody,
  proxyLedgerRequest,
  requestBody,
  stripTrailingSlash,
}
