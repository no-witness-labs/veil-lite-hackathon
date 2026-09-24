import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { generateKeyPairSync, sign } from 'node:crypto'

const require = createRequire(import.meta.url)
const { AuthError, authenticate, authorizeLedgerRequest, routePolicy } = require('../api/_auth.js')
const { proxyLedgerRequest } = require('../api/_ledger.js')
const sessionHandler = require('../api/session.js')

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const partyEnv = {
  VEIL_PARTY_ISSUER: 'Issuer::local',
  VEIL_PARTY_LENDER: 'Lender::local',
  VEIL_PARTY_BORROWER: 'Borrower::local',
  VEIL_PARTY_REGULATOR: 'Regulator::local',
  VEIL_PARTY_VALUER: 'Valuer::local',
  VEIL_PARTY_OUTSIDER: 'Outsider::local',
  VEIL_PACKAGE_REF: '#veil-lite',
}

beforeEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv, partyEnv, {
    VEIL_AUTH_PUBLIC_KEY: publicPem,
    VEIL_AUTH_AUDIENCE: 'veil-local',
  })
})

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  globalThis.fetch = originalFetch
})

function baseClaims(sub = 'veil-lender') {
  const now = Math.floor(Date.now() / 1000)
  return { iss: 'veil-local', aud: 'veil-local', sub, iat: now - 10, exp: now + 300 }
}

function jwt(claims = {}, header = { alg: 'RS256', typ: 'JWT' }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const encodedHeader = encode(header)
  const encodedClaims = encode({ ...baseClaims(), ...claims })
  const input = `${encodedHeader}.${encodedClaims}`
  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')
  return `${input}.${signature}`
}

function req(token, method = 'GET', url = '/v2/state/ledger-end', body) {
  return { method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, body }
}

function response() {
  const headers = new Map()
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), value) },
    getHeader(name) { return headers.get(name.toLowerCase()) },
    end(value = '') { this.body = Buffer.isBuffer(value) ? value.toString('utf8') : String(value) },
  }
}

function assertAuthError(fn, status, code) {
  assert.throws(fn, (error) => error instanceof AuthError && error.status === status && error.code === code)
}

function activeBody(party) {
  return {
    filter: {
      filtersByParty: {
        [party]: {
          cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
        },
      },
    },
    verbose: false,
    activeAtOffset: 0,
  }
}

function exerciseBody(actAs, readAs, userId = 'veil-lender') {
  return {
    commands: {
      commands: [{ ExerciseCommand: {
        templateId: '#veil-lite:Veil:Loan',
        contractId: '#contract',
        choice: 'Repay',
        choiceArgument: {},
      } }],
      commandId: 'auth-test-command',
      actAs,
      ...(readAs === undefined ? {} : { readAs }),
      userId,
    },
  }
}

test('session authentication verifies signature, fixed issuer/audience/subject and returns exp seconds', async () => {
  const token = jwt({ sub: 'veil-lender' })
  const auth = authenticate(req(token))
  assert.equal(auth.role, 'lender')
  assert.equal(auth.userId, 'veil-lender')
  assert.equal(auth.expiresAt, auth.claims.exp)

  const res = response()
  await sessionHandler(req(token), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), { role: 'lender', userId: 'veil-lender', expiresAt: auth.claims.exp })
})

test('authentication fails closed for missing, malformed, expired, not-yet-valid and mismatched JWTs', () => {
  assertAuthError(() => authenticate(req()), 401, 'AUTH_REQUIRED')
  assertAuthError(() => authenticate(req('not-a-jwt')), 401, 'AUTH_INVALID')
  assertAuthError(() => authenticate(req(jwt({ exp: Math.floor(Date.now() / 1000) - 1 }))), 401, 'AUTH_EXPIRED')
  assertAuthError(() => authenticate(req(jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }))), 401, 'AUTH_INVALID')
  assertAuthError(() => authenticate(req(jwt({ nbf: Math.floor(Date.now() / 1000) + 30 }))), 401, 'AUTH_NOT_YET_VALID')
  assertAuthError(() => authenticate(req(jwt({ iat: Math.floor(Date.now() / 1000) + 30 }))), 401, 'AUTH_NOT_YET_VALID')
  assertAuthError(() => authenticate(req(jwt({ aud: 'other-audience' }))), 401, 'AUTH_INVALID')
  assertAuthError(() => authenticate(req(jwt({ iss: 'other-issuer' }))), 401, 'AUTH_INVALID')
  assertAuthError(() => authenticate(req(jwt({ sub: 'veil-lender' }, { alg: 'HS256', typ: 'JWT' }))), 401, 'AUTH_INVALID')
  const signed = jwt({ sub: 'veil-lender' })
  const [signedHeader, signedClaims, signedSignature] = signed.split('.')
  const alteredSignature = `${signedSignature.slice(0, -2)}${signedSignature.endsWith('aa') ? 'bb' : 'aa'}`
  assertAuthError(() => authenticate(req(`${signedHeader}.${signedClaims}.${alteredSignature}`)), 401, 'AUTH_INVALID')
  assertAuthError(() => authenticate(req(jwt({ sub: 'veil-admin' }))), 403, 'ROLE_FORBIDDEN')

  delete process.env.VEIL_AUTH_PUBLIC_KEY
  process.env.VEIL_AUTH_PUBLIC_KEY_FILE = '/definitely/missing/public.pem'
  assertAuthError(() => authenticate(req(jwt())), 503, 'AUTH_UNAVAILABLE')
})

test('ordinary role queries are scoped to own party and command identity', () => {
  const lender = jwt({ sub: 'veil-lender' })
  const lenderParty = partyEnv.VEIL_PARTY_LENDER
  authorizeLedgerRequest(req(lender, 'POST', '/v2/state/active-contracts', activeBody(lenderParty)), '/v2/state/active-contracts', activeBody(lenderParty))
  assertAuthError(
    () => authorizeLedgerRequest(req(lender, 'POST', '/v2/state/active-contracts', activeBody(partyEnv.VEIL_PARTY_BORROWER)), '/v2/state/active-contracts', activeBody(partyEnv.VEIL_PARTY_BORROWER)),
    403,
    'PARTY_FORBIDDEN',
  )
  assertAuthError(
    () => authorizeLedgerRequest(req(lender, 'POST', '/v2/state/active-contracts', { ...activeBody(lenderParty), readAs: [lenderParty] }), '/v2/state/active-contracts', { ...activeBody(lenderParty), readAs: [lenderParty] }),
    400,
    'REQUEST_INVALID',
  )

  authorizeLedgerRequest(req(lender, 'POST', '/v2/commands/submit-and-wait-for-transaction', exerciseBody([lenderParty])), '/v2/commands/submit-and-wait-for-transaction', exerciseBody([lenderParty]))
  assertAuthError(
    () => authorizeLedgerRequest(req(lender, 'POST', '/v2/commands/submit-and-wait-for-transaction', exerciseBody([partyEnv.VEIL_PARTY_BORROWER])), '/v2/commands/submit-and-wait-for-transaction', exerciseBody([partyEnv.VEIL_PARTY_BORROWER])),
    403,
    'PARTY_FORBIDDEN',
  )
  assertAuthError(
    () => authorizeLedgerRequest(req(lender, 'POST', '/v2/commands/submit-and-wait-for-transaction', exerciseBody([lenderParty], [partyEnv.VEIL_PARTY_BORROWER])), '/v2/commands/submit-and-wait-for-transaction', exerciseBody([lenderParty], [partyEnv.VEIL_PARTY_BORROWER])),
    403,
    'PARTY_FORBIDDEN',
  )
  assertAuthError(
    () => authorizeLedgerRequest(req(lender, 'POST', '/v2/commands/submit-and-wait-for-transaction', exerciseBody([lenderParty], undefined, 'wrong-user')), '/v2/commands/submit-and-wait-for-transaction', exerciseBody([lenderParty], undefined, 'wrong-user')),
    403,
    'USER_FORBIDDEN',
  )
})

test('regulator and outsider cannot submit; ordinary users cannot create; operator may mint/reset writable parties', () => {
  for (const role of ['regulator', 'outsider']) {
    const token = jwt({ sub: `veil-${role}` })
    const party = partyEnv[`VEIL_PARTY_${role.toUpperCase()}`]
    assertAuthError(
      () => authorizeLedgerRequest(req(token, 'POST', '/v2/commands/submit-and-wait-for-transaction', exerciseBody([party], undefined, `veil-${role}`)), '/v2/commands/submit-and-wait-for-transaction', exerciseBody([party], undefined, `veil-${role}`)),
      403,
      'ROLE_FORBIDDEN',
    )
  }

  const lender = jwt({ sub: 'veil-lender' })
  const create = { commands: { commands: [{ CreateCommand: { templateId: '#veil-lite:Veil:CashHolding', createArguments: {} } }], commandId: 'create', actAs: [partyEnv.VEIL_PARTY_LENDER], userId: 'veil-lender' } }
  assertAuthError(() => authorizeLedgerRequest(req(lender, 'POST', '/v2/commands/submit-and-wait-for-transaction', create), '/v2/commands/submit-and-wait-for-transaction', create), 403, 'COMMAND_FORBIDDEN')

  const operator = jwt({ sub: 'veil-operator' })
  const operatorCreate = { ...create, commands: { ...create.commands, actAs: [partyEnv.VEIL_PARTY_ISSUER, partyEnv.VEIL_PARTY_LENDER], userId: 'veil-operator' } }
  authorizeLedgerRequest(req(operator, 'POST', '/v2/commands/submit-and-wait-for-transaction', operatorCreate), '/v2/commands/submit-and-wait-for-transaction', operatorCreate)
  const reset = exerciseBody([partyEnv.VEIL_PARTY_ISSUER, partyEnv.VEIL_PARTY_LENDER, partyEnv.VEIL_PARTY_BORROWER], undefined, 'veil-operator')
  authorizeLedgerRequest(req(operator, 'POST', '/v2/commands/submit-and-wait-for-transaction', reset), '/v2/commands/submit-and-wait-for-transaction', reset)
  const readonly = exerciseBody([partyEnv.VEIL_PARTY_REGULATOR], undefined, 'veil-operator')
  assertAuthError(() => authorizeLedgerRequest(req(operator, 'POST', '/v2/commands/submit-and-wait-for-transaction', readonly), '/v2/commands/submit-and-wait-for-transaction', readonly), 403, 'PARTY_FORBIDDEN')
})

test('unknown/admin routes are not proxied and caller bearer is forwarded unchanged', async () => {
  assertAuthError(() => routePolicy('/v2/packages', 'POST'), 404, 'ROUTE_NOT_FOUND')
  const token = jwt({ sub: 'veil-lender' })
  assertAuthError(
    () => authorizeLedgerRequest(req(token, 'GET', '/v2/state/ledger-end?admin=true'), '/v2/state/ledger-end'),
    400,
    'REQUEST_INVALID',
  )
  assertAuthError(
    () => authorizeLedgerRequest(req(undefined, 'OPTIONS', '/v2/state/ledger-end?admin=true'), '/v2/state/ledger-end'),
    400,
    'REQUEST_INVALID',
  )

  const captured = {}
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured.url = url
    captured.init = init
    return new Response('{"offset":0}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const res = response()
  await proxyLedgerRequest(req(token), res, '/v2/state/ledger-end', { target: 'http://ledger.test' })
  assert.equal(res.statusCode, 200)
  assert.equal(captured.url, 'http://ledger.test/v2/state/ledger-end')
  assert.equal(captured.init.headers.Authorization, `Bearer ${token}`)
  globalThis.fetch = oldFetch
})
