const crypto = require('node:crypto')
const { authConfig, AuthError, DEFAULT_ISSUER, respondError, ROLE_SUBJECTS, ROLES } = require('./_auth')
const { parseJsonBody, requestBody } = require('./_ledger')

// Hosted judges have no way to obtain a locally minted role token, so the
// server issues one in exchange for a shared demo passcode. The token is the
// same short-lived RS256 role credential the local issuer produces and goes
// through the same verification and per-role party checks afterwards. The
// operator role (reset, cross-role viewing) needs its own passcode.
//
// With VEIL_DEMO_OPEN=true the ordinary parties need no passcode at all, so
// anyone can try the public demo. Each still gets its own role session and
// the same server-side party checks; only the operator stays gated.
const TOKEN_TTL_SECONDS = 300
const MIN_PASSCODE_LENGTH = 12
const FAILURE_DELAY_MS = 750

function envValue(name, env) {
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function loginConfig(env = process.env) {
  const open = envValue('VEIL_DEMO_OPEN', env) === 'true'
  const passcode = envValue('VEIL_DEMO_PASSCODE', env)
  const operatorPasscode = envValue('VEIL_OPERATOR_PASSCODE', env)
  const privateKeyPem = envValue('VEIL_AUTH_PRIVATE_KEY', env).replace(/\\n/g, '\n')
  if (!privateKeyPem || (!open && passcode.length < MIN_PASSCODE_LENGTH)) return null
  const operator = operatorPasscode.length >= MIN_PASSCODE_LENGTH && operatorPasscode !== passcode ? operatorPasscode : null
  return { open, passcode: open ? null : passcode, operatorPasscode: operator, privateKeyPem }
}

function sameSecret(candidate, expected) {
  const a = crypto.createHash('sha256').update(String(candidate)).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

function mintRoleToken(role, privateKeyPem, env, now = Math.floor(Date.now() / 1000)) {
  const { audience } = authConfig(env)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: DEFAULT_ISSUER,
    aud: audience,
    sub: ROLE_SUBJECTS[role],
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  })}`
  let signature
  try {
    signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), crypto.createPrivateKey(privateKeyPem))
  } catch {
    throw new AuthError(503, 'AUTH_UNAVAILABLE')
  }
  return `${signingInput}.${signature.toString('base64url')}`
}

function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(value))
}

module.exports = async function handler(req, res) {
  const env = req?.veilEnv || process.env
  const method = String(req.method || 'GET').toUpperCase()
  const config = loginConfig(env)

  if (method === 'GET') {
    sendJson(res, 200, { enabled: Boolean(config), open: Boolean(config?.open), operator: Boolean(config?.operatorPasscode) })
    return
  }
  if (method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED' })
    return
  }

  try {
    if (!config) throw new AuthError(404, 'DEMO_LOGIN_DISABLED')
    const body = parseJsonBody(await requestBody(req))
    const { role, passcode = '' } = body
    if (!ROLES.includes(role) || typeof passcode !== 'string' || Object.keys(body).some((key) => key !== 'role' && key !== 'passcode')) {
      throw new AuthError(400, 'REQUEST_INVALID')
    }
    const openRole = config.open && role !== 'operator'
    const expected = role === 'operator' ? config.operatorPasscode : config.passcode
    if (!openRole && (!expected || !sameSecret(passcode, expected))) {
      await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS))
      throw new AuthError(401, 'PASSCODE_INVALID')
    }
    sendJson(res, 200, { token: mintRoleToken(role, config.privateKeyPem, env) })
  } catch (error) {
    respondError(res, error instanceof AuthError ? error : new AuthError(500, 'AUTH_ERROR'))
  }
}

module.exports.loginConfig = loginConfig
module.exports.mintRoleToken = mintRoleToken
