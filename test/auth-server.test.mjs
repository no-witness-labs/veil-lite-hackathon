import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { generateKeyPairSync, sign } from 'node:crypto'

const require = createRequire(import.meta.url)
const { AuthError, authenticate, authorizeLedgerRequest, routePolicy } = require('../api/_auth.js')
const { proxyLedgerRequest } = require('../api/_ledger.js')
const sessionHandler = require('../api/session.js')
const demoLoginHandler = require('../api/demo-login.js')
const { resetUpstreamCache } = require('../api/_upstream.js')
const { proxyRegistryRequest } = require('../api/_registry.js')

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const originalLog = console.log
const REGISTRY_URL = 'https://validator-api-http.validator.hackcanton-01.devnet.naas.noders.services/api/validator/v0/scan-proxy'
// Structured request logs are captured per test instead of printed.
let logLines = []
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
  logLines = []
  console.log = (line) => { logLines.push(String(line)) }
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv, partyEnv, {
    VEIL_AUTH_PUBLIC_KEY: publicPem,
    VEIL_AUTH_AUDIENCE: 'veil-local',
  })
})

afterEach(() => {
  console.log = originalLog
  resetUpstreamCache()
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
    eventFormat: {
      filtersByParty: {
        [party]: {
          cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
        },
      },
      verbose: false,
    },
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

test('active-contracts accepts only the eventFormat shape (Canton 3.6 disables filter/verbose)', () => {
  const lender = jwt({ sub: 'veil-lender' })
  const { eventFormat, activeAtOffset } = activeBody(partyEnv.VEIL_PARTY_LENDER)
  const legacy = { filter: { filtersByParty: eventFormat.filtersByParty }, verbose: false, activeAtOffset }
  assertAuthError(
    () => authorizeLedgerRequest(req(lender, 'POST', '/v2/state/active-contracts', legacy), '/v2/state/active-contracts', legacy),
    400,
    'REQUEST_INVALID',
  )
  const verbose = { eventFormat: { ...eventFormat, verbose: true }, activeAtOffset }
  assertAuthError(
    () => authorizeLedgerRequest(req(lender, 'POST', '/v2/state/active-contracts', verbose), '/v2/state/active-contracts', verbose),
    400,
    'REQUEST_INVALID',
  )
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

const sharedNodeEnv = {
  VEIL_UPSTREAM_REFRESH_TOKEN: 'offline-refresh',
  VEIL_OIDC_TOKEN_URL: 'http://idp.test/token',
  VEIL_OIDC_CLIENT_ID: 'web-app',
  VEIL_LEDGER_USER_ID: 'team-ledger-user',
}

function sharedNodeFetch(captured) {
  return async (url, init) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) {
      captured.tokenRequests = (captured.tokenRequests || 0) + 1
      captured.tokenBody = String(init.body)
      return new Response(JSON.stringify({ access_token: 'node-access', expires_in: 10800 }), { status: 200 })
    }
    captured.ledger = { url, init }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

test('shared node: role checks run first, then the node token and ledger user replace the role identity', async () => {
  Object.assign(process.env, sharedNodeEnv)
  const captured = {}
  globalThis.fetch = sharedNodeFetch(captured)
  const token = jwt({ sub: 'veil-lender' })

  const res = response()
  const body = exerciseBody(['Lender::local'])
  await proxyLedgerRequest(req(token, 'POST', '/v2/commands/submit-and-wait-for-transaction', body), res, '/v2/commands/submit-and-wait-for-transaction', { target: 'http://ledger.test' })
  assert.equal(res.statusCode, 200)
  assert.equal(captured.ledger.init.headers.Authorization, 'Bearer node-access')
  const forwarded = JSON.parse(captured.ledger.init.body)
  assert.equal(forwarded.commands.userId, 'team-ledger-user')
  assert.deepEqual(forwarded.commands.actAs, ['Lender::local'])
  assert.match(captured.tokenBody, /grant_type=refresh_token/)

  // Cached until close to expiry: a second call does not refresh again.
  await proxyLedgerRequest(req(token), response(), '/v2/state/ledger-end', { target: 'http://ledger.test' })
  assert.equal(captured.tokenRequests, 1)
  assert.equal(captured.ledger.init.headers.Authorization, 'Bearer node-access')

  // The node token can act as every party, so the server must still refuse
  // a lender acting as the borrower before anything is forwarded.
  captured.ledger = undefined
  const denied = response()
  const forged = exerciseBody(['Borrower::local'])
  await proxyLedgerRequest(req(token, 'POST', '/v2/commands/submit-and-wait-for-transaction', forged), denied, '/v2/commands/submit-and-wait-for-transaction', { target: 'http://ledger.test' })
  assert.equal(denied.statusCode, 403)
  assert.equal(captured.ledger, undefined)
})

test('shared node: missing upstream settings or a failed refresh fail closed', async () => {
  Object.assign(process.env, sharedNodeEnv, { VEIL_LEDGER_USER_ID: '' })
  const res = response()
  await proxyLedgerRequest(req(jwt()), res, '/v2/state/ledger-end', { target: 'http://ledger.test' })
  assert.equal(res.statusCode, 503)

  Object.assign(process.env, sharedNodeEnv)
  let ledgerCalled = false
  globalThis.fetch = async (url) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return new Response('{"error":"invalid_grant"}', { status: 400 })
    ledgerCalled = true
    return new Response('{}', { status: 200 })
  }
  const failed = response()
  await proxyLedgerRequest(req(jwt()), failed, '/v2/state/ledger-end', { target: 'http://ledger.test' })
  assert.equal(failed.statusCode, 503)
  assert.equal(ledgerCalled, false)
})

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })

function loginReq(body, method = 'POST') {
  return { method, url: '/api/demo-login', headers: {}, body: body === undefined ? undefined : JSON.stringify(body) }
}

test('demo login is disabled without a long passcode and signing key', async () => {
  const res = response()
  await demoLoginHandler(loginReq(undefined, 'GET'), res)
  assert.deepEqual(JSON.parse(res.body), { enabled: false, open: false, operator: false })

  Object.assign(process.env, { VEIL_DEMO_PASSCODE: 'short', VEIL_AUTH_PRIVATE_KEY: privatePem })
  const post = response()
  await demoLoginHandler(loginReq({ role: 'lender', passcode: 'short' }), post)
  assert.equal(post.statusCode, 404)
})

test('demo login issues a verifiable five-minute role token only for the right passcode', async () => {
  Object.assign(process.env, {
    VEIL_DEMO_PASSCODE: 'judge-passcode-123',
    VEIL_OPERATOR_PASSCODE: 'operator-passcode-456',
    VEIL_AUTH_PRIVATE_KEY: privatePem,
  })
  const info = response()
  await demoLoginHandler(loginReq(undefined, 'GET'), info)
  assert.deepEqual(JSON.parse(info.body), { enabled: true, open: false, operator: true })

  const wrong = response()
  await demoLoginHandler(loginReq({ role: 'lender', passcode: 'nope' }), wrong)
  assert.equal(wrong.statusCode, 401)

  const ok = response()
  await demoLoginHandler(loginReq({ role: 'borrower', passcode: 'judge-passcode-123' }), ok)
  assert.equal(ok.statusCode, 200)
  const { token } = JSON.parse(ok.body)
  const auth = authenticate(req(token))
  assert.equal(auth.role, 'borrower')
  assert.ok(auth.expiresAt - Math.floor(Date.now() / 1000) <= 300)

  // The judge passcode never grants the operator; the operator passcode does.
  const escalate = response()
  await demoLoginHandler(loginReq({ role: 'operator', passcode: 'judge-passcode-123' }), escalate)
  assert.equal(escalate.statusCode, 401)
  const operator = response()
  await demoLoginHandler(loginReq({ role: 'operator', passcode: 'operator-passcode-456' }), operator)
  assert.equal(authenticate(req(JSON.parse(operator.body).token)).role, 'operator')

  const extra = response()
  await demoLoginHandler(loginReq({ role: 'lender', passcode: 'judge-passcode-123', sub: 'veil-operator' }), extra)
  assert.equal(extra.statusCode, 400)
})

test('open demo: ordinary parties need no passcode, the operator still does', async () => {
  Object.assign(process.env, {
    VEIL_DEMO_OPEN: 'true',
    VEIL_OPERATOR_PASSCODE: 'operator-passcode-456',
    VEIL_AUTH_PRIVATE_KEY: privatePem,
  })
  const info = response()
  await demoLoginHandler(loginReq(undefined, 'GET'), info)
  assert.deepEqual(JSON.parse(info.body), { enabled: true, open: true, operator: true })

  const lender = response()
  await demoLoginHandler(loginReq({ role: 'lender' }), lender)
  assert.equal(lender.statusCode, 200)
  const auth = authenticate(req(JSON.parse(lender.body).token))
  assert.equal(auth.role, 'lender')
  assert.ok(auth.expiresAt - Math.floor(Date.now() / 1000) <= 300)
  // The open session is still bound to its own party.
  assertAuthError(
    () => authorizeLedgerRequest(req(JSON.parse(lender.body).token, 'POST', '/v2/state/active-contracts'), '/v2/state/active-contracts', activeBody('Borrower::local')),
    403,
    'PARTY_FORBIDDEN',
  )

  const operatorNoCode = response()
  await demoLoginHandler(loginReq({ role: 'operator' }), operatorNoCode)
  assert.equal(operatorNoCode.statusCode, 401)
  const operator = response()
  await demoLoginHandler(loginReq({ role: 'operator', passcode: 'operator-passcode-456' }), operator)
  assert.equal(authenticate(req(JSON.parse(operator.body).token)).role, 'operator')

  const extra = response()
  await demoLoginHandler(loginReq({ role: 'lender', sub: 'veil-operator' }), extra)
  assert.equal(extra.statusCode, 400)

  // Without the signing key nothing is issued, open or not.
  process.env.VEIL_AUTH_PRIVATE_KEY = ''
  const disabled = response()
  await demoLoginHandler(loginReq({ role: 'lender' }), disabled)
  assert.equal(disabled.statusCode, 404)
})

test('commands may carry well-formed disclosed contracts only', () => {
  const token = jwt({ sub: 'veil-borrower' })
  const disclosed = [{ templateId: 'pkg:Mod:T', contractId: '00ab', createdEventBlob: 'CgMyLjE=', synchronizerId: 'global-domain::1220' }]
  const withDisclosed = (value) => {
    const body = exerciseBody(['Borrower::local'], undefined, 'veil-borrower')
    body.commands.disclosedContracts = value
    return req(token, 'POST', '/v2/commands/submit-and-wait-for-transaction', body)
  }
  authorizeLedgerRequest(withDisclosed(disclosed), '/v2/commands/submit-and-wait-for-transaction', withDisclosed(disclosed).body)
  for (const bad of ['x', [{ contractId: '00ab' }], [{ ...disclosed[0], extra: 1 }], Array(17).fill(disclosed[0])]) {
    assertAuthError(() => authorizeLedgerRequest(withDisclosed(bad), '/v2/commands/submit-and-wait-for-transaction', withDisclosed(bad).body), 400, 'REQUEST_INVALID')
  }
})

test('registry proxy: whitelisted reads only, transacting roles only, node token forwarded', async () => {
  Object.assign(process.env, sharedNodeEnv, { VEIL_REGISTRY_URL: REGISTRY_URL })
  const captured = {}
  globalThis.fetch = async (url, init) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return new Response(JSON.stringify({ access_token: 'node-access', expires_in: 10800 }), { status: 200 })
    captured.url = url
    captured.init = init
    return new Response('{"factoryId":"f"}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const post = (sub, path, body = { choiceArguments: {} }) => ({ method: 'POST', url: `/api${path}`, headers: { authorization: `Bearer ${jwt({ sub })}` }, body: JSON.stringify(body) })

  const ok = response()
  await proxyRegistryRequest(post('veil-borrower', '/registry/allocation-instruction/v2/allocation-factory'), ok, '/registry/allocation-instruction/v2/allocation-factory')
  assert.equal(ok.statusCode, 200)
  assert.equal(captured.url, `${REGISTRY_URL}/registry/allocation-instruction/v2/allocation-factory`)
  assert.equal(captured.init.headers.Authorization, 'Bearer node-access')

  const regulator = response()
  await proxyRegistryRequest(post('veil-regulator', '/registry/allocation/v2/settlement-factory'), regulator, '/registry/allocation/v2/settlement-factory')
  assert.equal(regulator.statusCode, 403)

  const unknown = response()
  await proxyRegistryRequest(post('veil-lender', '/registry/transfer-instruction/v1/transfer-factory'), unknown, '/registry/transfer-instruction/v1/transfer-factory')
  assert.equal(unknown.statusCode, 404)

  const anonymous = response()
  await proxyRegistryRequest({ method: 'GET', url: '/api/registry/metadata/v1/info', headers: {} }, anonymous, '/registry/metadata/v1/info')
  assert.equal(anonymous.statusCode, 401)

  process.env.VEIL_REGISTRY_URL = ''
  const off = response()
  await proxyRegistryRequest(post('veil-lender', '/registry/allocation/v2/settlement-factory'), off, '/registry/allocation/v2/settlement-factory')
  assert.equal(off.statusCode, 503)
})

test('registry handler maps /api/registry/<registry path> onto the registry', async () => {
  Object.assign(process.env, sharedNodeEnv, { VEIL_REGISTRY_URL: REGISTRY_URL })
  const registryHandler = require('../api/registry.js')
  let calledUrl
  globalThis.fetch = async (url) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return new Response(JSON.stringify({ access_token: 'node-access', expires_in: 10800 }), { status: 200 })
    calledUrl = url
    return new Response('{"adminId":"DSO::1"}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const res = response()
  await registryHandler({ method: 'GET', url: '/api/registry/registry/metadata/v1/info', headers: { authorization: `Bearer ${jwt({ sub: 'veil-lender' })}` } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(calledUrl, `${REGISTRY_URL}/registry/metadata/v1/info`)
  // The Vercel rewrite form: /api/registry?path=<registry path>
  calledUrl = undefined
  const rewritten = response()
  await registryHandler({ method: 'GET', url: '/api/registry?path=registry/metadata/v1/info', headers: { authorization: `Bearer ${jwt({ sub: 'veil-lender' })}` } }, rewritten)
  assert.equal(rewritten.statusCode, 200)
  assert.equal(calledUrl, `${REGISTRY_URL}/registry/metadata/v1/info`)
})

/* ------------------------------------------------ proxy hardening -- */

const ledgerConfigHandler = require('../api/ledger-config.js')
const { sanitizeLedgerError, sanitizeCompletionStatus } = require('../api/_http.js')
const { registryTarget } = require('../api/_registry.js')

const SUBMIT = '/v2/commands/submit-and-wait-for-transaction'
const COMPLETIONS = '/v2/commands/completions'

// Recorded from the local sandbox: an assertion failure on LoanOffer.Accept.
const damlFailure = {
  code: 'DAML_FAILURE',
  cause: 'Interpretation error: Error: User failure: UNHANDLED_EXCEPTION/DA.Exception.AssertionFailed:AssertionFailed (error category 9): acceptance LTV must be below the liquidation threshold',
  correlationId: '4d4e8858-a2e1-4658-bdc0-4fa4b8cdf944',
  traceId: '7ea95c2815fcdd6c1b3f2da5141ae3b6',
  context: {
    participant: "'sandbox'",
    error_id: 'UNHANDLED_EXCEPTION/DA.Exception.AssertionFailed:AssertionFailed',
    exercise_trace: '    in choice 21745d06:Veil:LoanOffer:Accept on contract 0058e71a27 (#0)\n',
    category: '9',
    tid: '7ea95c2815fcdd6c1b3f2da5141ae3b6',
    definite_answer: 'false',
    commands: "{actAs: ['Borrower::1220abcd'], commandId: 'c1', userId: 'veil'}",
  },
  resources: [],
  errorCategory: 9,
  grpcCodeValue: 9,
  retryInfo: null,
  definiteAnswer: null,
}

function withHeaders(request, headers) {
  return { ...request, headers: { ...request.headers, ...headers } }
}

function body(res) {
  return JSON.parse(res.body)
}

function assertEnvelope(res, status, code) {
  assert.equal(res.statusCode, status)
  const payload = body(res)
  assert.equal(payload.code, code)
  assert.equal(typeof payload.message, 'string')
  assert.ok(payload.message.length > 0)
  assert.equal(payload.requestId, res.getHeader('x-request-id'))
  return payload
}

function completionsBody(party, userId = 'veil-lender', beginExclusive = 10) {
  return { userId, parties: [party], beginExclusive }
}

const nodeToken = () => new Response(JSON.stringify({ access_token: 'node-access', expires_in: 10800 }), { status: 200 })

test('every response carries X-Request-Id; a well-formed incoming id is kept, anything else replaced', async () => {
  globalThis.fetch = async () => new Response('{"offset":1}', { status: 200, headers: { 'content-type': 'application/json' } })
  const ok = response()
  await proxyLedgerRequest(withHeaders(req(jwt()), { 'x-request-id': 'abc-123' }), ok, '/v2/state/ledger-end', { target: 'http://ledger.test' })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.getHeader('x-request-id'), 'abc-123')

  for (const bad of ['a'.repeat(65), 'has space', 'semi;colon', '../etc', '']) {
    const res = response()
    await sessionHandler(withHeaders(req(undefined, 'GET', '/api/session'), { 'x-request-id': bad }), res)
    const id = res.getHeader('x-request-id')
    assert.notEqual(id, bad)
    assert.match(id, /^[A-Za-z0-9-]{1,64}$/)
    assertEnvelope(res, 401, 'AUTH_REQUIRED')
  }
})

test('api errors use the {code, message, requestId} envelope', async () => {
  const ledger = response()
  await proxyLedgerRequest(req(undefined), ledger, '/v2/state/ledger-end', { target: 'http://ledger.test' })
  assertEnvelope(ledger, 401, 'AUTH_REQUIRED')

  const unknown = response()
  await proxyLedgerRequest(req(jwt(), 'POST', '/v2/packages'), unknown, '/v2/packages', { target: 'http://ledger.test' })
  assertEnvelope(unknown, 404, 'ROUTE_NOT_FOUND')

  const invalid = response()
  await proxyLedgerRequest(req(jwt(), 'POST', SUBMIT, exerciseBody(['Lender::local'])), invalid, SUBMIT, { target: 'http://ledger.test', env: { ...process.env, VEIL_PACKAGE_REF: '#other' } })
  assertEnvelope(invalid, 400, 'REQUEST_INVALID')

  const session = response()
  await sessionHandler(req(jwt(), 'POST', '/api/session'), session)
  assertEnvelope(session, 405, 'METHOD_NOT_ALLOWED')

  const login = response()
  await demoLoginHandler(loginReq(undefined, 'PUT'), login)
  assertEnvelope(login, 405, 'METHOD_NOT_ALLOWED')

  const config = response()
  await ledgerConfigHandler({ method: 'POST', url: '/ledger-config.json', headers: {} }, config)
  assertEnvelope(config, 405, 'METHOD_NOT_ALLOWED')

  const registry = response()
  await proxyRegistryRequest({ method: 'GET', url: '/api/registry/registry/metadata/v1/info', headers: {} }, registry, '/registry/metadata/v1/info')
  assertEnvelope(registry, 401, 'AUTH_REQUIRED')
})

test('one structured log line per request: route pattern, status, role; no tokens, passcodes, bodies or ids', async () => {
  Object.assign(process.env, sharedNodeEnv, { VEIL_REGISTRY_URL: REGISTRY_URL })
  globalThis.fetch = async (url) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return nodeToken()
    return new Response('{"choiceContextData":{},"disclosedContracts":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const token = jwt({ sub: 'veil-borrower' })
  const allocation = '00deadbeef1234'
  const res = response()
  await proxyRegistryRequest(
    { method: 'POST', url: `/api/registry/registry/allocations/v2/${allocation}/choice-contexts/cancel?secret=1`, headers: { authorization: `Bearer ${token}`, 'x-request-id': 'log-check' }, body: '{"excludeDebugFields":true}' },
    res,
    `/registry/allocations/v2/${allocation}/choice-contexts/cancel`,
  )
  assert.equal(res.statusCode, 200)

  Object.assign(process.env, { VEIL_DEMO_PASSCODE: 'judge-passcode-123', VEIL_AUTH_PRIVATE_KEY: privatePem })
  await demoLoginHandler(loginReq({ role: 'lender', passcode: 'judge-passcode-123' }), response())

  assert.equal(logLines.length, 2)
  const [registryLine, loginLine] = logLines.map((line) => JSON.parse(line))
  assert.deepEqual(Object.keys(registryLine).sort(), ['durationMs', 'level', 'method', 'msg', 'requestId', 'role', 'route', 'status'])
  assert.equal(registryLine.requestId, 'log-check')
  assert.equal(registryLine.method, 'POST')
  assert.equal(registryLine.route, '/api/registry/registry/allocations/v2/:allocationId/choice-contexts/cancel')
  assert.equal(registryLine.status, 200)
  assert.equal(registryLine.role, 'borrower')
  assert.equal(loginLine.route, '/api/demo-login')
  assert.equal(loginLine.role, 'lender')
  const all = logLines.join('\n')
  for (const secret of [token, 'node-access', 'offline-refresh', 'judge-passcode-123', allocation, 'secret=1', 'excludeDebugFields']) {
    assert.ok(!all.includes(secret), `log leaked ${secret}`)
  }
})

test('ledger errors are sanitized: Daml message, code, error id and category kept; internals dropped', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(damlFailure), { status: 400, headers: { 'content-type': 'application/json' } })
  const res = response()
  const request = req(jwt({ sub: 'veil-borrower' }), 'POST', SUBMIT, exerciseBody(['Borrower::local'], undefined, 'veil-borrower'))
  await proxyLedgerRequest(request, res, SUBMIT, { target: 'http://ledger.test' })
  const payload = assertEnvelope(res, 400, 'DAML_FAILURE')
  assert.deepEqual(payload, {
    code: 'DAML_FAILURE',
    message: 'acceptance LTV must be below the liquidation threshold',
    requestId: res.getHeader('x-request-id'),
    errorId: 'UNHANDLED_EXCEPTION/DA.Exception.AssertionFailed:AssertionFailed',
    category: 9,
  })
  for (const leaked of ['participant', 'sandbox', 'Borrower::', 'correlationId', 'traceId', 'exercise_trace', 'definite', 'commands', '21745d06']) {
    assert.ok(!res.body.includes(leaked), `forwarded ${leaked}`)
  }
  assert.equal(JSON.parse(logLines[0]).ledgerCode, 'DAML_FAILURE')

  // A token-standard failWithStatus keeps its own error id.
  const withdraw = sanitizeLedgerError(400, JSON.stringify({
    code: 'DAML_FAILURE',
    cause: 'Interpretation error: Error: User failure: cannot-withdraw-committed-allocation (error category 9): Cannot withdraw a committed allocation before its settlement deadline.',
    context: { participant: 'p', tid: 't' },
    errorCategory: 9,
  }))
  assert.deepEqual(withdraw, { code: 'DAML_FAILURE', message: 'Cannot withdraw a committed allocation before its settlement deadline.', status: 400, errorId: 'cannot-withdraw-committed-allocation', category: 9 })

  // Non-Daml errors get a short message instead of the raw cause.
  const missing = sanitizeLedgerError(404, JSON.stringify({ code: 'CONTRACT_NOT_FOUND', cause: 'Contract could not be found with id 00abc on participant p1', errorCategory: 11 }))
  assert.equal(missing.code, 'CONTRACT_NOT_FOUND')
  assert.equal(missing.category, 11)
  assert.ok(!missing.message.includes('00abc'))
  const auth = sanitizeLedgerError(403, JSON.stringify({ code: 'DAML_AUTHORIZATION_ERROR', cause: 'Interpretation error: Error: node NodeId(0) requires authorizers Lender::1220, but only Borrower::1220 were given', errorCategory: 7 }))
  assert.equal(auth.code, 'DAML_AUTHORIZATION_ERROR')
  assert.ok(!auth.message.includes('::'))

  // Gateway HTML or garbage never reaches the browser.
  assert.deepEqual(sanitizeLedgerError(502, '<html>bad gateway</html>'), { code: 'LEDGER_ERROR', message: 'The ledger returned HTTP 502.', status: 502 })
})

test('ledger fetch refuses redirects and times out; both come back as proxy errors', async () => {
  const { createServer } = await import('node:http')
  let redirectedHit = false
  const server = createServer((request, reply) => {
    if (request.url.startsWith('/elsewhere')) {
      redirectedHit = true
      reply.end('{}')
      return
    }
    if (request.url.startsWith('/v2/state/ledger-end')) {
      reply.statusCode = 302
      reply.setHeader('Location', '/elsewhere')
      reply.end()
    }
    // Submissions are never answered.
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const target = `http://127.0.0.1:${server.address().port}`
  try {
    const redirected = response()
    await proxyLedgerRequest(req(jwt()), redirected, '/v2/state/ledger-end', { target })
    assertEnvelope(redirected, 502, 'PROXY_ERROR')
    assert.equal(redirectedHit, false)

    const slow = response()
    await proxyLedgerRequest(req(jwt(), 'POST', SUBMIT, exerciseBody(['Lender::local'])), slow, SUBMIT, { target, timeoutMs: 200 })
    assertEnvelope(slow, 504, 'LEDGER_TIMEOUT')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('token and registry fetches refuse redirects and carry a deadline', async () => {
  Object.assign(process.env, sharedNodeEnv, { VEIL_REGISTRY_URL: REGISTRY_URL })
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, redirect: init.redirect, signal: init.signal })
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return nodeToken()
    // What undici does when redirect: 'error' meets a 3xx.
    throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') })
  }
  const get = () => ({ method: 'GET', url: '/api/registry/registry/metadata/v1/info', headers: { authorization: `Bearer ${jwt()}` } })
  const res = response()
  await proxyRegistryRequest(get(), res, '/registry/metadata/v1/info')
  assertEnvelope(res, 502, 'REGISTRY_PROXY_ERROR')
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.redirect, 'error')
    assert.ok(call.signal instanceof AbortSignal)
  }

  globalThis.fetch = async (url) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return nodeToken()
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  }
  const slow = response()
  await proxyRegistryRequest(get(), slow, '/registry/metadata/v1/info')
  assertEnvelope(slow, 504, 'REGISTRY_TIMEOUT')

  // A token endpoint that hangs fails closed as unavailable.
  resetUpstreamCache()
  globalThis.fetch = async (url, init) => {
    assert.equal(init.redirect, 'error')
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  }
  const noToken = response()
  await proxyLedgerRequest(req(jwt()), noToken, '/v2/state/ledger-end', { target: 'http://ledger.test' })
  assertEnvelope(noToken, 503, 'UPSTREAM_UNAVAILABLE')
})

test('registry responses are size-capped and upstream error bodies reduced to their message', async () => {
  Object.assign(process.env, sharedNodeEnv, { VEIL_REGISTRY_URL: REGISTRY_URL })
  let reply
  globalThis.fetch = async (url) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return nodeToken()
    return reply()
  }
  const get = () => ({ method: 'GET', url: '/api/registry/registry/metadata/v1/info', headers: { authorization: `Bearer ${jwt()}` } })

  // Streamed without a length: cut off once past the cap.
  reply = () => new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < 5; i += 1) controller.enqueue(new Uint8Array(256 * 1024))
      controller.close()
    },
  }), { status: 200 })
  const streamed = response()
  await proxyRegistryRequest(get(), streamed, '/registry/metadata/v1/info')
  assertEnvelope(streamed, 502, 'REGISTRY_RESPONSE_TOO_LARGE')

  reply = () => new Response('x', { status: 200, headers: { 'content-length': String(2 * 1024 * 1024) } })
  const declared = response()
  await proxyRegistryRequest(get(), declared, '/registry/metadata/v1/info')
  assertEnvelope(declared, 502, 'REGISTRY_RESPONSE_TOO_LARGE')

  reply = () => new Response(JSON.stringify({ error: 'insufficient funds', trace: 'internal' }), { status: 400 })
  const failed = response()
  await proxyRegistryRequest(get(), failed, '/registry/metadata/v1/info')
  const payload = assertEnvelope(failed, 400, 'REGISTRY_ERROR')
  assert.equal(payload.message, 'insufficient funds')
  assert.ok(!failed.body.includes('internal'))
})

test('registry base URL must be https on an allow-listed host', async () => {
  assert.equal(registryTarget({ VEIL_REGISTRY_URL: `${REGISTRY_URL}/` }), REGISTRY_URL)
  for (const bad of [
    REGISTRY_URL.replace('https:', 'http:'),
    'https://evil.example/api/validator/v0/scan-proxy',
    'https://validator-api-http.validator.hackcanton-01.devnet.naas.noders.services.evil.example/x',
    'https://user:pw@validator-api-http.validator.hackcanton-01.devnet.naas.noders.services/x',
    'https://validator-api-http.validator.hackcanton-01.devnet.naas.noders.services:8443/x',
    `${REGISTRY_URL}?a=1`,
    'not a url',
  ]) {
    assert.equal(registryTarget({ VEIL_REGISTRY_URL: bad }), '', bad)
  }

  Object.assign(process.env, sharedNodeEnv, { VEIL_REGISTRY_URL: 'https://evil.example/scan-proxy' })
  let registryCalled = false
  globalThis.fetch = async (url) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return nodeToken()
    registryCalled = true
    return new Response('{}', { status: 200 })
  }
  const res = response()
  await proxyRegistryRequest({ method: 'GET', url: '/api/registry/registry/metadata/v1/info', headers: { authorization: `Bearer ${jwt()}` } }, res, '/registry/metadata/v1/info')
  assertEnvelope(res, 503, 'REGISTRY_UNAVAILABLE')
  assert.equal(registryCalled, false)
})

test('completions route: caller user and own party only, stream parameters pinned by the proxy', async () => {
  const lender = jwt({ sub: 'veil-lender' })
  const post = (token, value, url = COMPLETIONS) => req(token, 'POST', url, value)
  let forwarded = null
  globalThis.fetch = async (url, init) => {
    forwarded = { url, init }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const refused = async (request, status, code) => {
    forwarded = null
    const res = response()
    await proxyLedgerRequest(request, res, COMPLETIONS, { target: 'http://ledger.test' })
    assertEnvelope(res, status, code)
    assert.equal(forwarded, null)
  }

  await refused(post(lender, completionsBody('Borrower::local')), 403, 'PARTY_FORBIDDEN')
  await refused(post(lender, { ...completionsBody('Lender::local'), parties: ['Lender::local', 'Borrower::local'] }), 403, 'PARTY_FORBIDDEN')
  await refused(post(lender, completionsBody('Lender::local', 'veil-borrower')), 403, 'USER_FORBIDDEN')
  await refused(post(lender, { ...completionsBody('Lender::local'), extra: true }), 400, 'REQUEST_INVALID')
  await refused(post(lender, { ...completionsBody('Lender::local'), beginExclusive: -1 }), 400, 'REQUEST_INVALID')
  await refused(post(lender, { userId: 'veil-lender', parties: [], beginExclusive: 0 }), 400, 'REQUEST_INVALID')
  await refused(post(lender, completionsBody('Lender::local'), `${COMPLETIONS}?limit=100000`), 400, 'REQUEST_INVALID')
  await refused(post(jwt({ sub: 'veil-regulator' }), completionsBody('Regulator::local', 'veil-regulator')), 403, 'ROLE_FORBIDDEN')
  await refused(req(lender, 'GET', COMPLETIONS), 405, 'METHOD_NOT_ALLOWED')
  await refused(post(jwt({ sub: 'veil-operator' }), { userId: 'veil-operator', parties: ['Regulator::local'], beginExclusive: 0 }), 403, 'PARTY_FORBIDDEN')

  const ok = response()
  await proxyLedgerRequest(post(lender, completionsBody('Lender::local')), ok, COMPLETIONS, { target: 'http://ledger.test' })
  assert.equal(ok.statusCode, 200)
  assert.equal(forwarded.url, 'http://ledger.test/v2/commands/completions?limit=200&stream_idle_timeout_ms=1000')
  assert.deepEqual(JSON.parse(forwarded.init.body), completionsBody('Lender::local'))
  assert.deepEqual(body(ok), { completions: [], lastOffset: null })

  const operator = response()
  await proxyLedgerRequest(post(jwt({ sub: 'veil-operator' }), { userId: 'veil-operator', parties: ['Issuer::local', 'Lender::local'], beginExclusive: 0 }), operator, COMPLETIONS, { target: 'http://ledger.test' })
  assert.equal(operator.statusCode, 200)
})

test('completions route: shared node pins the ledger user; the response is reduced to id, offset and outcome', async () => {
  Object.assign(process.env, sharedNodeEnv)
  let forwarded
  const upstream = [
    { completionResponse: { OffsetCheckpoint: { value: { offset: 52, synchronizerTimes: [{ synchronizerId: 'sync::1220', recordTime: '2026-09-28T10:13:19Z' }] } } } },
    { completionResponse: { Completion: { value: {
      commandId: 'veil-repay-ok', status: { code: 0, message: '', details: [] }, updateId: '1220aa', userId: 'team-ledger-user',
      actAs: ['Lender::local'], submissionId: 's1', deduplicationPeriod: { DeduplicationOffset: { value: 0 } },
      traceContext: { traceparent: '00-abc-def-03' }, offset: 53, synchronizerTime: { synchronizerId: 'sync::1220', recordTime: 't' },
    } } } },
    { completionResponse: { Completion: { value: {
      commandId: 'veil-repay-bad',
      status: { code: 9, message: 'DAML_FAILURE(9,4d4e8858): Interpretation error: Error: User failure: UNHANDLED_EXCEPTION/DA.Exception.AssertionFailed:AssertionFailed (error category 9): valuation is stale', details: [{ typeUrl: 'type.googleapis.com/google.rpc.ErrorInfo', value: 'internal' }] },
      userId: 'team-ledger-user', actAs: ['Lender::local'], submissionId: 's2', offset: 54, synchronizerTime: { synchronizerId: 'sync::1220', recordTime: 't' },
    } } } },
  ]
  globalThis.fetch = async (url, init) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return nodeToken()
    forwarded = { url, init }
    return new Response(JSON.stringify(upstream), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const res = response()
  await proxyLedgerRequest(req(jwt(), 'POST', COMPLETIONS, completionsBody('Lender::local')), res, COMPLETIONS, { target: 'http://ledger.test' })
  assert.equal(res.statusCode, 200)
  assert.equal(forwarded.init.headers.Authorization, 'Bearer node-access')
  assert.deepEqual(JSON.parse(forwarded.init.body), { userId: 'team-ledger-user', parties: ['Lender::local'], beginExclusive: 10 })
  assert.deepEqual(body(res), {
    completions: [
      { commandId: 'veil-repay-ok', offset: 53, succeeded: true, updateId: '1220aa' },
      { commandId: 'veil-repay-bad', offset: 54, succeeded: false, error: { code: 'DAML_FAILURE', message: 'valuation is stale', errorId: 'UNHANDLED_EXCEPTION/DA.Exception.AssertionFailed:AssertionFailed', category: 9 } },
    ],
    lastOffset: 54,
  })
  for (const leaked of ['team-ledger-user', 'traceparent', 'submissionId', 'sync::1220', '4d4e8858', 'internal']) {
    assert.ok(!res.body.includes(leaked), `forwarded ${leaked}`)
  }
  assert.deepEqual(sanitizeCompletionStatus({ code: 13, message: 'something odd' }), { code: 'LEDGER_REJECTED', message: 'The ledger rejected the command (LEDGER_REJECTED).' })
})
