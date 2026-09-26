const { authenticate, AuthError, respondError } = require('./_auth')
const { parseJsonBody, requestBody, stripTrailingSlash } = require('./_ledger')
const { upstreamConfig, upstreamToken } = require('./_upstream')

// The token registry (Canton Coin, via the validator's scan proxy) supplies the
// factory contracts and choice context a Token Standard choice needs. These
// endpoints only *read* registry state; nothing here submits to the ledger.
const ROUTES = [
  { method: 'GET', pattern: /^\/registry\/metadata\/v1\/info$/ },
  { method: 'POST', pattern: /^\/registry\/allocation-instruction\/v2\/allocation-factory$/ },
  { method: 'POST', pattern: /^\/registry\/allocation\/v2\/settlement-factory$/ },
  { method: 'POST', pattern: /^\/registry\/allocations\/v2\/[A-Za-z0-9:_-]{1,256}\/choice-contexts\/cancel$/ },
]
const TRANSACTING_ROLES = new Set(['lender', 'borrower', 'operator'])

function registryTarget(env) {
  const value = typeof env?.VEIL_REGISTRY_URL === 'string' ? env.VEIL_REGISTRY_URL.trim() : ''
  return value ? stripTrailingSlash(value) : ''
}

async function proxyRegistryRequest(req, res, path, env = req?.veilEnv || process.env) {
  const method = String(req.method || 'GET').toUpperCase()
  try {
    const route = ROUTES.find((r) => r.pattern.test(path))
    if (!route) throw new AuthError(404, 'ROUTE_NOT_FOUND')
    if (route.method !== method) throw new AuthError(405, 'METHOD_NOT_ALLOWED')
    const auth = authenticate(req, env)
    if (method === 'POST' && !TRANSACTING_ROLES.has(auth.role)) throw new AuthError(403, 'ROLE_FORBIDDEN')
    const target = registryTarget(env)
    const shared = upstreamConfig(env)
    if (!target || !shared) throw new AuthError(503, 'REGISTRY_UNAVAILABLE')
    const body = method === 'POST' ? JSON.stringify(parseJsonBody(await requestBody(req))) : undefined
    const upstream = await fetch(`${target}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await upstreamToken(shared)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    })
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) {
    if (error instanceof AuthError) {
      respondError(res, error)
      return
    }
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ code: 'REGISTRY_PROXY_ERROR' }))
  }
}

module.exports = { proxyRegistryRequest }
