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
  Object.assign(process.env, sharedNodeEnv, { VEIL_REGISTRY_URL: 'http://registry.test/scan-proxy' })
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
  assert.equal(captured.url, 'http://registry.test/scan-proxy/registry/allocation-instruction/v2/allocation-factory')
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
  Object.assign(process.env, sharedNodeEnv, { VEIL_REGISTRY_URL: 'http://registry.test/scan-proxy' })
  const registryHandler = require('../api/registry/[...path].js')
  let calledUrl
  globalThis.fetch = async (url) => {
    if (url === sharedNodeEnv.VEIL_OIDC_TOKEN_URL) return new Response(JSON.stringify({ access_token: 'node-access', expires_in: 10800 }), { status: 200 })
    calledUrl = url
    return new Response('{"adminId":"DSO::1"}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const res = response()
  await registryHandler({ method: 'GET', url: '/api/registry/registry/metadata/v1/info', headers: { authorization: `Bearer ${jwt({ sub: 'veil-lender' })}` } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(calledUrl, 'http://registry.test/scan-proxy/registry/metadata/v1/info')
})
