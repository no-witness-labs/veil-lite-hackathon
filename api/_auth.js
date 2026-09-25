const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

// The browser presents one of these short-lived role credentials.  The role is
// deliberately derived from the signed subject; a role tab or request field is
// never an identity assertion.
const ROLE_SUBJECTS = Object.freeze({
  lender: 'veil-lender',
  borrower: 'veil-borrower',
  valuer: 'veil-valuer',
  regulator: 'veil-regulator',
  outsider: 'veil-outsider',
  operator: 'veil-operator',
})

const ROLES = Object.freeze(Object.keys(ROLE_SUBJECTS))
const READ_ROLES = Object.freeze(['lender', 'borrower', 'valuer', 'regulator', 'outsider'])
const MAX_BODY_BYTES = 1_048_576
const DEFAULT_AUDIENCE = 'veil-local'
const DEFAULT_ISSUER = 'veil-local'
const DEFAULT_PUBLIC_KEY_FILE = path.resolve(__dirname, '../.local/auth/public.pem')

class AuthError extends Error {
  constructor(status, code, message = code) {
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.code = code
  }
}

function envValue(name, env = process.env) {
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function publicKeyFromEnv(env = process.env) {
  const inline = envValue('VEIL_AUTH_PUBLIC_KEY', env)
  if (inline) return inline.replace(/\\n/g, '\n')

  const file = envValue('VEIL_AUTH_PUBLIC_KEY_FILE', env) || DEFAULT_PUBLIC_KEY_FILE
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    throw new AuthError(503, 'AUTH_UNAVAILABLE')
  }
}

function authConfig(env = process.env) {
  let publicKey
  try {
    publicKey = crypto.createPublicKey(publicKeyFromEnv(env))
  } catch {
    throw new AuthError(503, 'AUTH_UNAVAILABLE')
  }

  const audience = envValue('VEIL_AUTH_AUDIENCE', env) || DEFAULT_AUDIENCE
  if (!audience) throw new AuthError(503, 'AUTH_UNAVAILABLE')
  return { publicKey, audience }
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuthError(401, 'AUTH_INVALID')
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

function decodeJsonSegment(value) {
  try {
    const decoded = JSON.parse(decodeBase64Url(value).toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('invalid JSON object')
    return decoded
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError(401, 'AUTH_INVALID')
  }
}

function bearerToken(req) {
  const value = req?.headers?.authorization
  if (Array.isArray(value) && value.length !== 1) throw new AuthError(401, 'AUTH_INVALID')
  const header = Array.isArray(value) ? value[0] : value
  if (typeof header !== 'string' || !/^Bearer [^\s]+$/i.test(header)) {
    throw new AuthError(401, 'AUTH_REQUIRED')
  }
  return header.slice('Bearer '.length)
}

function audienceMatches(aud, expected) {
  if (typeof aud === 'string') return aud === expected
  return Array.isArray(aud) && aud.length > 0 && aud.every((entry) => typeof entry === 'string') && aud.includes(expected)
}

function authenticate(req, env = req?.veilEnv || process.env) {
  const token = bearerToken(req)
  const segments = token.split('.')
  if (segments.length !== 3) throw new AuthError(401, 'AUTH_INVALID')

  const header = decodeJsonSegment(segments[0])
  const claims = decodeJsonSegment(segments[1])
  if (header.alg !== 'RS256' || header.typ !== 'JWT') throw new AuthError(401, 'AUTH_INVALID')

  const signature = decodeBase64Url(segments[2])
  const signed = Buffer.from(`${segments[0]}.${segments[1]}`)
  let valid = false
  let config
  try {
    config = authConfig(env)
    valid = crypto.verify('RSA-SHA256', signed, config.publicKey, signature)
  } catch {
    throw new AuthError(503, 'AUTH_UNAVAILABLE')
  }
  if (!valid) throw new AuthError(401, 'AUTH_INVALID')

  const { audience } = config
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(claims.exp) || !Number.isInteger(claims.exp) || claims.exp <= now) {
    throw new AuthError(401, 'AUTH_EXPIRED')
  }
  // Match the sandbox Ledger API's default maximum remaining token lifetime.
  if (claims.exp > now + 300) throw new AuthError(401, 'AUTH_INVALID')
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || !Number.isInteger(claims.nbf) || claims.nbf > now)) {
    throw new AuthError(401, 'AUTH_NOT_YET_VALID')
  }
  if (claims.iat !== undefined && (!Number.isFinite(claims.iat) || !Number.isInteger(claims.iat) || claims.iat > now)) {
    throw new AuthError(401, 'AUTH_NOT_YET_VALID')
  }
  if (!audienceMatches(claims.aud, audience)) throw new AuthError(401, 'AUTH_INVALID')
  if (claims.iss !== DEFAULT_ISSUER) throw new AuthError(401, 'AUTH_INVALID')
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AuthError(401, 'AUTH_INVALID')

  const role = ROLES.find((candidate) => ROLE_SUBJECTS[candidate] === claims.sub)
  if (!role) throw new AuthError(403, 'ROLE_FORBIDDEN')

  // The Canton user identity is the signed JWT subject. The web role mapping
  // and the participant's own user-rights configuration are separate checks.
  const userId = claims.sub
  return {
    token,
    role,
    userId,
    expiresAt: claims.exp,
    claims,
  }
}

function knownParties(env = process.env) {
  const parties = {
    lender: envValue('VEIL_PARTY_LENDER', env),
    borrower: envValue('VEIL_PARTY_BORROWER', env),
    regulator: envValue('VEIL_PARTY_REGULATOR', env),
    valuer: envValue('VEIL_PARTY_VALUER', env),
    outsider: envValue('VEIL_PARTY_OUTSIDER', env),
  }
  const issuer = envValue('VEIL_PARTY_ISSUER', env)
  if (!issuer || Object.values(parties).some((party) => !party)) throw new AuthError(503, 'AUTH_UNAVAILABLE')
  const values = [issuer, ...Object.values(parties)]
  if (new Set(values).size !== values.length) throw new AuthError(503, 'AUTH_UNAVAILABLE')
  return { issuer, parties }
}

function packageRef(env = process.env) {
  return envValue('VEIL_PACKAGE_REF', env) || '#veil-lite'
}

function roleParty(auth, config) {
  if (auth.role === 'operator') return null
  return config.parties[auth.role]
}

function operatorReadableParties(config) {
  return new Set([config.issuer, ...Object.values(config.parties)])
}

function operatorWritableParties(config) {
  return new Set([config.issuer, config.parties.lender, config.parties.borrower, config.parties.valuer])
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key))
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function uniqueStrings(value, field, max = 8, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > max || value.some((entry) => typeof entry !== 'string' || !entry)) {
    throw new AuthError(400, 'REQUEST_INVALID', `${field} is invalid`)
  }
  if (new Set(value).size !== value.length) throw new AuthError(400, 'REQUEST_INVALID', `${field} contains duplicates`)
  return value
}

function checkPartySet(values, allowed, field) {
  if (values.some((party) => !allowed.has(party))) throw new AuthError(403, 'PARTY_FORBIDDEN', `${field} is not authorized`)
}

function validateActiveContracts(body, auth, env = process.env) {
  const config = knownParties(env)
  if (!exactKeys(body, ['filter', 'verbose', 'activeAtOffset'])) throw new AuthError(400, 'REQUEST_INVALID')
  if (body.verbose !== undefined && body.verbose !== false) throw new AuthError(400, 'REQUEST_INVALID')
  if (body.activeAtOffset !== undefined && (!Number.isSafeInteger(body.activeAtOffset) || body.activeAtOffset < 0)) {
    throw new AuthError(400, 'REQUEST_INVALID')
  }

  const filter = body.filter
  if (!exactKeys(filter, ['filtersByParty']) || !record(filter.filtersByParty)) throw new AuthError(400, 'REQUEST_INVALID')
  const parties = Object.keys(filter.filtersByParty)
  if (parties.length !== 1) throw new AuthError(400, 'REQUEST_INVALID')
  const requested = parties[0]
  const readable = auth.role === 'operator' ? operatorReadableParties(config) : new Set([roleParty(auth, config)])
  checkPartySet(parties, readable, 'filter')

  const partyFilter = filter.filtersByParty[requested]
  if (!exactKeys(partyFilter, ['cumulative']) || !Array.isArray(partyFilter.cumulative) || partyFilter.cumulative.length !== 1) {
    throw new AuthError(400, 'REQUEST_INVALID')
  }
  const cumulative = partyFilter.cumulative[0]
  if (!exactKeys(cumulative, ['identifierFilter']) || !exactKeys(cumulative.identifierFilter, ['WildcardFilter'])) {
    throw new AuthError(400, 'REQUEST_INVALID')
  }
  const wildcard = cumulative.identifierFilter.WildcardFilter
  if (!exactKeys(wildcard, ['value']) || !exactKeys(wildcard.value, ['includeCreatedEventBlob']) || wildcard.value.includeCreatedEventBlob !== false) {
    throw new AuthError(400, 'REQUEST_INVALID')
  }
  return { config, party: requested }
}

function commandShape(command, env = process.env) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new AuthError(400, 'REQUEST_INVALID')
  const keys = Object.keys(command)
  if (keys.length !== 1 || !['CreateCommand', 'CreateAndExerciseCommand', 'ExerciseCommand'].includes(keys[0])) {
    throw new AuthError(400, 'REQUEST_INVALID')
  }
  const kind = keys[0]
  const value = command[kind]
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'REQUEST_INVALID')
  const allowed = kind === 'CreateCommand'
    ? ['templateId', 'createArguments']
    : kind === 'CreateAndExerciseCommand'
      ? ['templateId', 'createArguments', 'choice', 'choiceArgument']
      : ['templateId', 'contractId', 'choice', 'choiceArgument']
  const templatePrefix = `${packageRef(env)}:`
  if (!exactKeys(value, allowed) || typeof value.templateId !== 'string' || !value.templateId.startsWith(templatePrefix) || value.templateId.length <= templatePrefix.length) {
    throw new AuthError(400, 'REQUEST_INVALID')
  }
  if (kind === 'ExerciseCommand') {
    if (typeof value.contractId !== 'string' || !value.contractId || typeof value.choice !== 'string' || !value.choice) {
      throw new AuthError(400, 'REQUEST_INVALID')
    }
    if (value.choiceArgument !== undefined && !record(value.choiceArgument)) throw new AuthError(400, 'REQUEST_INVALID')
  } else {
    if (!record(value.createArguments)) throw new AuthError(400, 'REQUEST_INVALID')
    if (kind === 'CreateAndExerciseCommand' && (typeof value.choice !== 'string' || !value.choice || !record(value.choiceArgument))) {
      throw new AuthError(400, 'REQUEST_INVALID')
    }
  }
  return { kind, value }
}

function validateCommands(body, auth, env = process.env) {
  const config = knownParties(env)
  if (!exactKeys(body, ['commands'])) throw new AuthError(400, 'REQUEST_INVALID')
  const commands = body.commands
  if (!exactKeys(commands, ['commands', 'commandId', 'actAs', 'readAs', 'userId'])) throw new AuthError(400, 'REQUEST_INVALID')
  if (!Array.isArray(commands.commands) || commands.commands.length !== 1) throw new AuthError(400, 'REQUEST_INVALID')
  if (typeof commands.commandId !== 'string' || commands.commandId.length === 0 || commands.commandId.length > 200) {
    throw new AuthError(400, 'REQUEST_INVALID')
  }
  if (typeof commands.userId !== 'string' || commands.userId !== auth.userId) throw new AuthError(403, 'USER_FORBIDDEN')

  const actAs = uniqueStrings(commands.actAs, 'actAs')
  const readAs = commands.readAs === undefined ? [] : uniqueStrings(commands.readAs, 'readAs', 8, true)
  const rolePartyValue = roleParty(auth, config)
  if (auth.role === 'regulator' || auth.role === 'outsider') throw new AuthError(403, 'ROLE_FORBIDDEN')

  if (auth.role === 'operator') {
    checkPartySet(actAs, operatorWritableParties(config), 'actAs')
    checkPartySet(readAs, operatorReadableParties(config), 'readAs')
  } else {
    if (actAs.length !== 1 || actAs[0] !== rolePartyValue) throw new AuthError(403, 'PARTY_FORBIDDEN')
    if (readAs.some((party) => party !== rolePartyValue)) throw new AuthError(403, 'PARTY_FORBIDDEN')
  }

  const command = commandShape(commands.commands[0], env)
  if (auth.role !== 'operator' && (command.kind === 'CreateCommand' || command.kind === 'CreateAndExerciseCommand')) {
    throw new AuthError(403, 'COMMAND_FORBIDDEN')
  }
  return { config, actAs, readAs }
}

function routePolicy(pathname, method) {
  const normalized = pathname.split('?')[0]
  const policies = {
    '/v2/state/ledger-end': ['GET', 'HEAD'],
    '/v2/state/active-contracts': ['POST'],
    '/v2/commands/submit-and-wait-for-transaction': ['POST'],
  }
  const methods = policies[normalized]
  if (!methods) throw new AuthError(404, 'ROUTE_NOT_FOUND')
  if (method === 'OPTIONS') return { path: normalized, options: true, allow: [...methods, 'OPTIONS'] }
  if (!methods.includes(method)) {
    const error = new AuthError(405, 'METHOD_NOT_ALLOWED')
    error.allow = [...methods, 'OPTIONS']
    throw error
  }
  return { path: normalized, options: false, allow: [...methods, 'OPTIONS'] }
}

function authorizeLedgerRequest(req, path, body, env = req?.veilEnv || process.env) {
  const policy = routePolicy(path, String(req.method || 'GET').toUpperCase())
  const requestUrl = new URL(req.url || '/', 'https://veil.local')
  const pathUrl = new URL(path, 'https://veil.local')
  if (requestUrl.search || pathUrl.search) throw new AuthError(400, 'REQUEST_INVALID')
  if (policy.options) return { policy, auth: null }
  const auth = authenticate(req, env)
  if (policy.path === '/v2/state/active-contracts') validateActiveContracts(body, auth, env)
  if (policy.path === '/v2/commands/submit-and-wait-for-transaction') validateCommands(body, auth, env)
  return { policy, auth }
}

function respondError(res, error) {
  const status = error instanceof AuthError ? error.status : 500
  const code = error instanceof AuthError ? error.code : 'AUTH_ERROR'
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify({ code }))
}

function requireAuth(req, res, env = req?.veilEnv || process.env) {
  try {
    return authenticate(req, env)
  } catch (error) {
    respondError(res, error)
    return null
  }
}

module.exports = {
  AuthError,
  DEFAULT_AUDIENCE,
  DEFAULT_ISSUER,
  MAX_BODY_BYTES,
  ROLE_SUBJECTS,
  ROLES,
  authConfig,
  authenticate,
  authorizeLedgerRequest,
  knownParties,
  packageRef,
  requireAuth,
  respondError,
  routePolicy,
}
