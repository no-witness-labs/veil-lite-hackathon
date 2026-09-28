const { authenticate, AuthError, respondError } = require('./_auth')
const { parseJsonBody, requestBody, stripTrailingSlash } = require('./_ledger')
const { upstreamConfig, upstreamToken } = require('./_upstream')
const { beginRequest, isTimeout, noteRole, readCapped, ResponseTooLargeError, sendError, upstreamFetch } = require('./_http')

// The token registry (Canton Coin, via the validator's scan proxy) supplies the
// factory contracts and choice context a Token Standard choice needs. These
// endpoints only *read* registry state; nothing here submits to the ledger.
const ROUTES = [
  { method: 'GET', pattern: /^\/registry\/metadata\/v1\/info$/, label: '/api/registry/registry/metadata/v1/info' },
  { method: 'POST', pattern: /^\/registry\/allocation-instruction\/v2\/allocation-factory$/, label: '/api/registry/registry/allocation-instruction/v2/allocation-factory' },
  { method: 'POST', pattern: /^\/registry\/allocation\/v2\/settlement-factory$/, label: '/api/registry/registry/allocation/v2/settlement-factory' },
  { method: 'POST', pattern: /^\/registry\/allocations\/v2\/[A-Za-z0-9:_-]{1,256}\/choice-contexts\/cancel$/, label: '/api/registry/registry/allocations/v2/:allocationId/choice-contexts/cancel' },
]
const TRANSACTING_ROLES = new Set(['lender', 'borrower', 'operator'])

// The node bearer is sent to the registry, so the registry base URL must be an
// https URL on a known host. Anything else leaves the registry disabled.
const REGISTRY_HOSTS = new Set(['validator-api-http.validator.hackcanton-01.devnet.naas.noders.services'])
const REGISTRY_TIMEOUT_MS = 10_000
const MAX_REGISTRY_RESPONSE_BYTES = 1_048_576
const MAX_ERROR_TEXT = 300

function registryTarget(env) {
  const value = typeof env?.VEIL_REGISTRY_URL === 'string' ? env.VEIL_REGISTRY_URL.trim() : ''
  if (!value) return ''
  let url
  try {
    url = new URL(value)
  } catch {
    return ''
  }
  if (url.protocol !== 'https:' || !REGISTRY_HOSTS.has(url.hostname) || (url.port && url.port !== '443')) return ''
  if (url.username || url.password || url.search || url.hash) return ''
  return stripTrailingSlash(`${url.origin}${url.pathname}`)
}

/** Registry errors carry {error: "..."}; forward only that text, clipped. */
function registryErrorMessage(status, raw) {
  try {
    const body = JSON.parse(raw.toString('utf8'))
    if (typeof body?.error === 'string' && body.error.trim()) {
      const text = body.error.trim()
      return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT - 1)}…` : text
    }
  } catch {
    // Not JSON: fall through to the status-only message.
  }
  return `The token registry returned HTTP ${status}.`
}

async function proxyRegistryRequest(req, res, path, env = req?.veilEnv || process.env) {
  const method = String(req.method || 'GET').toUpperCase()
  const route = ROUTES.find((r) => r.pattern.test(path))
  beginRequest(req, res, route ? route.label : '/api/registry/*')
  try {
    if (!route) throw new AuthError(404, 'ROUTE_NOT_FOUND')
    if (route.method !== method) throw new AuthError(405, 'METHOD_NOT_ALLOWED')
    const auth = authenticate(req, env)
    noteRole(res, auth.role)
    if (method === 'POST' && !TRANSACTING_ROLES.has(auth.role)) throw new AuthError(403, 'ROLE_FORBIDDEN')
    const target = registryTarget(env)
    const shared = upstreamConfig(env)
    if (!target || !shared) throw new AuthError(503, 'REGISTRY_UNAVAILABLE')
    const body = method === 'POST' ? JSON.stringify(parseJsonBody(await requestBody(req))) : undefined
    const bearer = await upstreamToken(shared)
    let upstream
    let responseBody
    try {
      upstream = await upstreamFetch(`${target}${path}`, {
        method,
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      }, REGISTRY_TIMEOUT_MS)
      responseBody = await readCapped(upstream, MAX_REGISTRY_RESPONSE_BYTES)
    } catch (error) {
      if (error instanceof ResponseTooLargeError) sendError(res, 502, 'REGISTRY_RESPONSE_TOO_LARGE')
      else if (isTimeout(error)) sendError(res, 504, 'REGISTRY_TIMEOUT')
      else sendError(res, 502, 'REGISTRY_PROXY_ERROR')
      return
    }
    if (!upstream.ok) {
      sendError(res, upstream.status, 'REGISTRY_ERROR', registryErrorMessage(upstream.status, responseBody))
      return
    }
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(responseBody)
  } catch (error) {
    if (error instanceof AuthError) {
      respondError(res, error)
      return
    }
    sendError(res, 502, 'REGISTRY_PROXY_ERROR')
  }
}

module.exports = { proxyRegistryRequest, registryTarget }
