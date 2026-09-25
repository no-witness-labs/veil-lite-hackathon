const { authenticate, authorizeLedgerRequest, AuthError, knownParties, MAX_BODY_BYTES, respondError, routePolicy } = require('./_auth')
const { upstreamConfig, upstreamToken } = require('./_upstream')

const DEFAULT_LEDGER_TARGET = 'https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services'

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

async function proxyLedgerRequest(req, res, path, options = {}) {
  const source = options.env || req?.veilEnv || process.env
  const method = String(req.method || 'GET').toUpperCase()
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
    authenticate(req, source)
    const rawBody = method === 'GET' || method === 'HEAD' ? undefined : await requestBody(req)
    const body = method === 'GET' || method === 'HEAD' ? undefined : parseJsonBody(rawBody)
    const { auth, policy: authorized } = authorizeLedgerRequest(req, path, body, source)
    const shared = upstreamConfig(source)
    const bearer = shared ? await upstreamToken(shared) : auth.token
    const target = options.target ? stripTrailingSlash(options.target) : ledgerTarget(source)
    const upstream = await fetch(`${target}${pathWithQuery(req, path)}`, {
      method,
      headers: upstreamHeaders(req, bearer),
      body: method === 'GET' || method === 'HEAD' ? undefined : upstreamBody(rawBody, body, authorized.path, shared),
    })
    const responseBody = Buffer.from(await upstream.arrayBuffer())
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(responseBody)
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 405) res.setHeader('Allow', (policy?.allow || error.allow || []).join(', '))
      respondError(res, error)
      return
    }
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ code: 'PROXY_ERROR' }))
  }
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

/** On the shared node, commands must name the team's ledger user rather than
 * the role subject the browser session carries. The body is otherwise the
 * already-validated request, forwarded unchanged. */
function upstreamBody(rawBody, body, path, shared) {
  if (!shared || path !== '/v2/commands/submit-and-wait-for-transaction') return rawBody
  return JSON.stringify({ ...body, commands: { ...body.commands, userId: shared.ledgerUserId } })
}

function pathWithQuery(req, path) {
  const requestUrl = new URL(req.url || '', 'https://veil.local')
  const separator = path.indexOf('?')
  if (separator >= 0) return path
  return `${path}${requestUrl.search}`
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
