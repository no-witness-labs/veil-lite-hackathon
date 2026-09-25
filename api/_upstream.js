const { AuthError } = require('./_auth')

// Shared-node mode. The hosted HackCanton participant gives the team one
// ledger user that holds CanActAs/CanReadAs for every demo party, so the
// server exchanges an offline refresh token for that user's access token and
// submits on the caller's behalf. Role separation is then enforced by the
// server's own role checks only; Canton cannot tell the roles apart.
const REFRESH_MARGIN_SECONDS = 60

let cached = null
let inflight = null

function envValue(name, env) {
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

/** Null when the proxy should forward the caller's own token (local sandbox). */
function upstreamConfig(env = process.env) {
  const refreshToken = envValue('VEIL_UPSTREAM_REFRESH_TOKEN', env)
  if (!refreshToken) return null
  const tokenUrl = envValue('VEIL_OIDC_TOKEN_URL', env)
  const clientId = envValue('VEIL_OIDC_CLIENT_ID', env)
  const ledgerUserId = envValue('VEIL_LEDGER_USER_ID', env)
  if (!tokenUrl || !clientId || !ledgerUserId) throw new AuthError(503, 'UPSTREAM_UNAVAILABLE')
  return { refreshToken, tokenUrl, clientId, ledgerUserId }
}

async function upstreamToken(config, now = Math.floor(Date.now() / 1000)) {
  if (cached && cached.key === config.refreshToken && cached.expiresAt - REFRESH_MARGIN_SECONDS > now) return cached.token
  if (!inflight) {
    inflight = fetchToken(config).finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function fetchToken(config) {
  let response
  try {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        refresh_token: config.refreshToken,
      }),
    })
  } catch {
    throw new AuthError(503, 'UPSTREAM_UNAVAILABLE')
  }
  if (!response.ok) throw new AuthError(503, 'UPSTREAM_UNAVAILABLE')
  const payload = await response.json().catch(() => null)
  const token = payload?.access_token
  const expiresIn = payload?.expires_in
  if (typeof token !== 'string' || !token || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
    throw new AuthError(503, 'UPSTREAM_UNAVAILABLE')
  }
  cached = { key: config.refreshToken, token, expiresAt: Math.floor(Date.now() / 1000) + expiresIn }
  return token
}

function resetUpstreamCache() {
  cached = null
  inflight = null
}

module.exports = { resetUpstreamCache, upstreamConfig, upstreamToken }
