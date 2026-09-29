import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { generateKeyPairSync, sign } from 'node:crypto'

const require = createRequire(import.meta.url)
const deskHandler = require('../api/desk.js')
const { authenticate, AuthError } = require('../api/_auth.js')
const { resetUpstreamCache } = require('../api/_upstream.js')
const { deskCount, idleStreams, signDeskToken, verifyDeskToken, IDLE_MS, MAX_DESKS, DESK_TTL_SECONDS } = deskHandler.internals

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const originalLog = console.log
let logLines = []

const P = {
  issuer: 'Issuer::1', lender: 'Lender::1', borrower: 'Borrower::1', regulator: 'Regulator::1', valuer: 'Valuer::1', outsider: 'Outsider::1',
}
const LEDGER = 'http://ledger.test'
const REGISTRY_URL = 'https://validator-api-http.validator.hackcanton-01.devnet.naas.noders.services/api/validator/v0/scan-proxy'
const baseEnv = {
  VEIL_PARTY_ISSUER: P.issuer,
  VEIL_PARTY_LENDER: P.lender,
  VEIL_PARTY_BORROWER: P.borrower,
  VEIL_PARTY_REGULATOR: P.regulator,
  VEIL_PARTY_VALUER: P.valuer,
  VEIL_PARTY_OUTSIDER: P.outsider,
  VEIL_PACKAGE_REF: '#veil-lite',
  VEIL_AUTH_PUBLIC_KEY: publicPem,
  VEIL_AUTH_PRIVATE_KEY: privatePem,
  VEIL_AUTH_AUDIENCE: 'veil-local',
  VEIL_LEDGER_TARGET: LEDGER,
}
const sharedEnv = {
  VEIL_UPSTREAM_REFRESH_TOKEN: 'offline-refresh',
  VEIL_OIDC_TOKEN_URL: 'http://idp.test/token',
  VEIL_OIDC_CLIENT_ID: 'web-app',
  VEIL_LEDGER_USER_ID: 'team-ledger-user',
  VEIL_REGISTRY_URL: REGISTRY_URL,
}

beforeEach(() => {
  logLines = []
  console.log = (line) => { logLines.push(String(line)) }
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv, baseEnv, sharedEnv)
})

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')

/** Stand in for Vercel's request context; returns the promises passed to waitUntil. */
function vercelContext() {
  const pending = []
  globalThis[REQUEST_CONTEXT] = { get: () => ({ waitUntil: (promise) => { pending.push(promise) } }) }
  return pending
}

afterEach(() => {
  delete globalThis[REQUEST_CONTEXT]
  console.log = originalLog
  resetUpstreamCache()
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  globalThis.fetch = originalFetch
})

function roleToken(sub = 'veil-lender') {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: 'veil-local', aud: 'veil-local', sub, iat: now - 10, exp: now + 300 })}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`
}

function request(body, token = roleToken()) {
  return { method: 'POST', url: '/api/desk', headers: token ? { authorization: `Bearer ${token}` } : {}, body }
}

function response() {
  const headers = new Map()
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), value) },
    getHeader(name) { return headers.get(name.toLowerCase()) },
    end(value = '') { this.body = Buffer.isBuffer(value) ? value.toString('utf8') : String(value) },
    json() { return JSON.parse(this.body) },
  }
}

/* ------------------------------------------------------------ fake ledger -- */

const STAKEHOLDERS = {
  CollateralValuation: (a) => [a.valuationAgent, a.lender, a.borrower, a.regulator],
  LoanOffer: (a) => [a.issuer, a.lender, a.borrower, a.regulator],
  CoinLoanOffer: (a) => [a.issuer, a.lender, a.borrower, a.regulator],
  Loan: (a) => [a.issuer, a.lender, a.borrower, a.regulator],
  CoinLoan: (a) => [a.issuer, a.lender, a.borrower, a.regulator],
  LoanClosed: (a) => [a.issuer, a.lender, a.borrower, a.regulator],
  SubstitutionRequest: (a) => [a.issuer, a.lender, a.borrower, a.regulator],
  CashHolding: (a) => [a.issuer, a.owner],
  CollateralHolding: (a) => [a.issuer, a.owner],
}

/** An in-memory ACS that applies the commands the desk endpoint sends. */
function fakeLedger() {
  const state = { contracts: [], offset: 10, next: 1, submissions: [], registryCalls: [], tokenRequests: 0, acsReads: 0, eventArguments: true }
  const add = (template, args) => {
    const contract = { contractId: `${template}-${state.next++}`, template, offset: ++state.offset, args }
    state.contracts.push(contract)
    return contract
  }
  const mark = (asset, observedAt, streamId = `stream-${state.next++}`, price = '1') => add('CollateralValuation', {
    valuationAgent: P.valuer, lender: P.lender, borrower: P.borrower, regulator: P.regulator, collateralAsset: asset, streamId, unitPrice: price, observedAt,
  })
  const deal = (template, streamId, extra = {}) => add(template, {
    issuer: P.issuer, lender: P.lender, borrower: P.borrower, regulator: P.regulator, valuationAgent: P.valuer, valuationStreamId: streamId,
    principal: '100', interest: '5', collateralAsset: 'Tokenized T-Bill', collateralQuantity: '150', ...extra,
  })
  const remove = (cid) => {
    const index = state.contracts.findIndex((c) => c.contractId === cid)
    if (index < 0) {
      const error = new Error('not found')
      error.status = 404
      throw error
    }
    return state.contracts.splice(index, 1)[0]
  }

  function apply(command) {
    if (command.CreateAndExerciseCommand) {
      const { templateId, createArguments, choice, choiceArgument } = command.CreateAndExerciseCommand
      assert.equal(templateId, '#veil-lite:Veil:ValuationStream')
      assert.equal(choice, 'PublishInitial')
      const streamId = `stream-${state.next++}`
      return mark(createArguments.collateralAsset, new Date().toISOString(), streamId, choiceArgument.unitPrice)
    }
    const { templateId, contractId, choice } = command.ExerciseCommand
    const contract = remove(contractId)
    assert.equal(templateId, `#veil-lite:Veil:${contract.template}`)
    if (choice === 'Withdraw' || choice === 'WithdrawCoinOffer') add('CashHolding', { issuer: P.issuer, owner: P.lender, amount: contract.args.principal })
    if (choice === 'CancelSubstitution') add('CollateralHolding', { issuer: P.issuer, owner: P.borrower, asset: contract.args.newAsset, quantity: contract.args.newQuantity })
    if (choice === 'WriteOffCoin') add('LoanClosed', { ...contract.args, collateralAsset: 'Canton Coin', reason: 'WrittenOff' })
    return null
  }

  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

  async function fetchImpl(url, init = {}) {
    if (url === sharedEnv.VEIL_OIDC_TOKEN_URL) {
      state.tokenRequests += 1
      return json({ access_token: 'node-access', expires_in: 10800 })
    }
    if (url.startsWith(REGISTRY_URL)) {
      state.registryCalls.push({ url, init })
      return json({ choiceContextData: { values: { ctx: 'cancel' } }, disclosedContracts: [{ templateId: 'Splice:X', contractId: 'disclosed-1', createdEventBlob: 'blob', synchronizerId: 'sync', debug: 'dropped' }] })
    }
    assert.ok(url.startsWith(LEDGER), url)
    state.lastAuthorization = init.headers?.Authorization
    const path = url.slice(LEDGER.length)
    if (path === '/v2/state/ledger-end') return json({ offset: state.offset })
    if (path === '/v2/state/active-contracts') {
      state.acsReads += 1
      const body = JSON.parse(init.body)
      const party = Object.keys(body.filter.filtersByParty)[0]
      return json(state.contracts
        .filter((c) => (STAKEHOLDERS[c.template]?.(c.args) ?? []).includes(party))
        .map((c) => ({ contractEntry: { JsActiveContract: { createdEvent: { contractId: c.contractId, templateId: `pkg123:Veil:${c.template}`, offset: c.offset, createArgument: c.args } } } })))
    }
    if (path === '/v2/commands/submit-and-wait-for-transaction') {
      const body = JSON.parse(init.body)
      state.submissions.push(body.commands)
      const before = state.contracts.slice()
      try {
        const created = body.commands.commands.map(apply).filter(Boolean)
        state.offset += 1
        return json({ transaction: { updateId: `u-${state.offset}`, offset: state.offset, events: created.map((c) => ({ CreatedEvent: { contractId: c.contractId, templateId: `pkg123:Veil:${c.template}`, ...(state.eventArguments ? { createArgument: c.args } : {}) } })) } })
      } catch (error) {
        state.contracts = before
        if (error.status === 404) return json({ code: 'CONTRACT_NOT_FOUND', cause: 'gone', errorCategory: 11 }, 404)
        throw error
      }
    }
    throw new Error(`unexpected ledger path ${path}`)
  }
  return { state, add, mark, deal, fetchImpl }
}

const ASSETS = ['Tokenized T-Bill', 'Tokenized MMF', 'Canton Coin']
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()

function deskOf(ledger, observedAt = minutesAgo(1)) {
  const streams = {}
  for (const asset of ASSETS) streams[asset] = ledger.mark(asset, observedAt).args.streamId
  return streams
}

async function call(body, token) {
  const res = response()
  await deskHandler(request(body, token), res)
  return res
}

/* ------------------------------------------------------------------ tests -- */

test('create requires a valid Veil session and POST', async () => {
  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  const anonymous = await call({ action: 'create' }, null)
  assert.equal(anonymous.statusCode, 401)
  assert.equal(anonymous.json().code, 'AUTH_REQUIRED')
  assert.ok(anonymous.json().requestId)

  const now = Math.floor(Date.now() / 1000)
  const { token: deskToken } = signDeskToken({ deskId: 'desk-0001', streams: { 'Canton Coin': 's' }, ledger: P.issuer }, privatePem, now)
  const deskAsSession = await call({ action: 'create' }, deskToken)
  assert.equal(deskAsSession.statusCode, 401, 'a desk token is not a session')

  const get = response()
  await deskHandler({ method: 'GET', url: '/api/desk', headers: {} }, get)
  assert.equal(get.statusCode, 405)
  assert.equal(ledger.state.submissions.length, 0)

  const bad = await call({ action: 'create', extra: 1 })
  assert.equal(bad.statusCode, 400)
  assert.equal((await call({ action: 'close' })).statusCode, 400, 'close needs a desk token')
})

test('create opens one stream per valued asset in one transaction and returns a signed 24 h desk token', async () => {
  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  const res = await call({ action: 'create' }, roleToken('veil-outsider'))
  assert.equal(res.statusCode, 200, res.body)
  const desk = res.json()
  assert.deepEqual(Object.keys(desk.streams).sort(), [...ASSETS].sort())
  assert.equal(desk.reused, false)
  // One read of the valuer's prices, one submission with a command per asset;
  // the new marks come from that transaction, not from a second read.
  assert.equal(ledger.state.acsReads, 1)
  assert.equal(ledger.state.submissions.length, 1)
  const submission = ledger.state.submissions[0]
  assert.equal(submission.commands.length, 3)
  assert.deepEqual(submission.actAs, [P.lender, P.borrower, P.valuer])
  assert.equal(submission.userId, 'team-ledger-user')
  assert.equal(ledger.state.lastAuthorization, 'Bearer node-access')
  const coin = submission.commands.find((c) => c.CreateAndExerciseCommand.createArguments.collateralAsset === 'Canton Coin')
  assert.equal(coin.CreateAndExerciseCommand.choiceArgument.unitPrice, '0.15')
  assert.equal(submission.commands[0].CreateAndExerciseCommand.createArguments.regulator, P.regulator)

  const verified = verifyDeskToken(desk.token, process.env, P.issuer)
  assert.deepEqual(verified.streams, desk.streams)
  assert.equal(verified.deskId, desk.deskId)
  const claims = JSON.parse(Buffer.from(desk.token.split('.')[1], 'base64url').toString('utf8'))
  assert.equal(claims.exp - claims.iat, DESK_TTL_SECONDS)
  assert.equal(desk.expiresAt, claims.exp)
  // Never usable as a role session.
  assert.throws(() => authenticate({ headers: { authorization: `Bearer ${desk.token}` } }), (e) => e instanceof AuthError && e.status === 401)
})

test('create reads the new marks back only when the transaction carries no create arguments', async () => {
  const ledger = fakeLedger()
  ledger.state.eventArguments = false
  globalThis.fetch = ledger.fetchImpl
  const res = await call({ action: 'create' })
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(Object.keys(res.json().streams).length, 3)
  assert.equal(ledger.state.submissions.length, 1)
  assert.equal(ledger.state.acsReads, 2)
})

test('desk tokens: signature, expiry, ledger binding and type are all checked', () => {
  const now = Math.floor(Date.now() / 1000)
  const streams = { 'Tokenized T-Bill': 's1' }
  const good = signDeskToken({ deskId: 'desk-0001', streams, ledger: P.issuer }, privatePem, now).token
  assert.equal(verifyDeskToken(good, process.env, P.issuer).deskId, 'desk-0001')

  const expect = (token, code, ledgerId = P.issuer) => assert.throws(() => verifyDeskToken(token, process.env, ledgerId), (e) => e instanceof AuthError && e.code === code)
  expect(signDeskToken({ deskId: 'desk-0001', streams, ledger: P.issuer }, privatePem, now - DESK_TTL_SECONDS - 1).token, 'DESK_EXPIRED')
  expect(good, 'DESK_INVALID', 'OtherIssuer::1')
  const [h, c, s] = good.split('.')
  const forgedClaims = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(c, 'base64url')), streams: { 'Tokenized T-Bill': 'someone-else' } })).toString('base64url')
  expect(`${h}.${forgedClaims}.${s}`, 'DESK_INVALID')
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
  expect(signDeskToken({ deskId: 'desk-0001', streams, ledger: P.issuer }, other, now).token, 'DESK_INVALID')
  expect(roleToken(), 'DESK_INVALID')
  expect('not.a.token', 'DESK_INVALID')
  expect(signDeskToken({ deskId: 'desk-0001', streams: { Gold: 's' }, ledger: P.issuer }, privatePem, now).token, 'DESK_INVALID')
})

test('create reuses a live desk without touching the ledger, and repairs a janitored stream', async () => {
  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  const first = (await call({ action: 'create' })).json()
  const again = (await call({ action: 'create', deskToken: first.token })).json()
  assert.equal(again.reused, true)
  assert.equal(again.token, first.token)
  assert.equal(ledger.state.submissions.length, 1)

  // The MMF stream is gone (janitor or reset): only it is reopened, same desk.
  ledger.state.contracts = ledger.state.contracts.filter((c) => c.args.streamId !== first.streams['Tokenized MMF'])
  const repaired = (await call({ action: 'create', deskToken: first.token })).json()
  assert.equal(repaired.reused, false)
  assert.equal(repaired.deskId, first.deskId)
  assert.equal(repaired.streams['Tokenized T-Bill'], first.streams['Tokenized T-Bill'])
  assert.notEqual(repaired.streams['Tokenized MMF'], first.streams['Tokenized MMF'])
  assert.equal(ledger.state.submissions.at(-1).commands.length, 1)

  // An unusable token (tampered) just means a new desk.
  const fresh = (await call({ action: 'create', deskToken: `${first.token}x` })).json()
  assert.notEqual(fresh.deskId, first.deskId)
})

test('close touches only its own desk\'s contracts, in reset order, and never burns holdings', async () => {
  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  const mine = (await call({ action: 'create' })).json()
  const theirs = deskOf(ledger)
  const tbill = mine.streams['Tokenized T-Bill']
  const mmf = mine.streams['Tokenized MMF']
  const coin = mine.streams['Canton Coin']
  const myOffer = ledger.deal('LoanOffer', tbill)
  const myLoan = ledger.deal('Loan', tbill)
  const myClosed = ledger.deal('LoanClosed', tbill, { reason: 'Repaid' })
  const mySub = ledger.add('SubstitutionRequest', { issuer: P.issuer, lender: P.lender, borrower: P.borrower, regulator: P.regulator, valuationAgent: P.valuer, releaseAsset: 'Tokenized T-Bill', releaseQuantity: '150', newAsset: 'Tokenized MMF', newQuantity: '160', newValuationStreamId: mmf })
  const myCoinLoan = ledger.deal('CoinLoan', coin, { collateralAsset: undefined, allocationCid: 'alloc-1', coinAdmin: 'DSO::1', settlementRef: 'veil-1' })
  const theirLoan = ledger.deal('Loan', theirs['Tokenized T-Bill'])
  const theirOffer = ledger.deal('CoinLoanOffer', theirs['Canton Coin'])
  const foreign = ledger.deal('Loan', tbill, { issuer: 'Other::9' })
  const holding = ledger.add('CashHolding', { issuer: P.issuer, owner: P.lender, amount: '500' })
  ledger.state.submissions = []

  const res = await call({ action: 'close', deskToken: mine.token }, roleToken('veil-borrower'))
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().closed, { offers: 1, loans: 1, coinLoans: 1, closed: 2, substitutions: 1, marks: 3 })

  // Canton Coin first: WriteOffCoin as the lender, with the registry's cancel
  // context and only the four disclosed-contract fields.
  const [writeOff, batch] = ledger.state.submissions
  assert.deepEqual(writeOff.actAs, [P.lender])
  assert.equal(writeOff.commands[0].ExerciseCommand.choice, 'WriteOffCoin')
  assert.equal(writeOff.commands[0].ExerciseCommand.contractId, myCoinLoan.contractId)
  assert.deepEqual(writeOff.commands[0].ExerciseCommand.choiceArgument.cancelExtraArgs.context, { values: { ctx: 'cancel' } })
  assert.deepEqual(writeOff.disclosedContracts, [{ templateId: 'Splice:X', contractId: 'disclosed-1', createdEventBlob: 'blob', synchronizerId: 'sync' }])
  assert.match(ledger.state.registryCalls[0].url, /\/registry\/allocations\/v2\/alloc-1\/choice-contexts\/cancel$/)

  const choices = batch.commands.map((c) => `${c.ExerciseCommand.choice}:${c.ExerciseCommand.contractId}`)
  assert.deepEqual(choices.slice(0, 4), [
    `Withdraw:${myOffer.contractId}`,
    `CancelSubstitution:${mySub.contractId}`,
    `Archive:${myLoan.contractId}`,
    `Dismiss:${myClosed.contractId}`,
  ])
  assert.ok(choices[4].startsWith('Dismiss:LoanClosed-'), 'the written-off coin loan record is dismissed too')
  assert.equal(choices.slice(5).filter((c) => c.startsWith('Archive:CollateralValuation')).length, 3)
  assert.deepEqual(batch.actAs, [P.issuer, P.lender, P.borrower, P.valuer])

  const left = new Set(ledger.state.contracts.map((c) => c.contractId))
  for (const c of [theirLoan, theirOffer, foreign, holding]) assert.ok(left.has(c.contractId), `${c.contractId} untouched`)
  for (const stream of Object.values(theirs)) assert.ok(ledger.state.contracts.some((c) => c.args.streamId === stream))
  assert.ok(!ledger.state.contracts.some((c) => Object.values(mine.streams).includes(c.args.streamId) || Object.values(mine.streams).includes(c.args.valuationStreamId) && c.args.issuer === P.issuer))
  // Escrow came back instead of being burned.
  assert.ok(ledger.state.contracts.some((c) => c.template === 'CashHolding' && c.args.amount === '100'))
  assert.ok(ledger.state.contracts.some((c) => c.template === 'CollateralHolding' && c.args.asset === 'Tokenized MMF'))

  const expired = signDeskToken({ deskId: mine.deskId, streams: mine.streams, ledger: P.issuer }, privatePem, Math.floor(Date.now() / 1000) - DESK_TTL_SECONDS - 5).token
  const refused = await call({ action: 'close', deskToken: expired })
  assert.equal(refused.statusCode, 401)
  assert.equal(refused.json().code, 'DESK_EXPIRED')
})

test('janitor: streams idle over 30 minutes are closed first, never the caller\'s own', async () => {
  const now = Date.now()
  const m = (streamId, minutes) => ({ args: { streamId, observedAt: new Date(now - minutes * 60_000).toISOString() } })
  assert.deepEqual(idleStreams([m('a', 5), m('b', 45), m('c', 31), m('d', 120), { args: { streamId: 'e', observedAt: 'garbage' } }], now, ['d']), ['e', 'b', 'c'])
  assert.deepEqual(idleStreams([m('a', 29)], now), [])
  assert.equal(IDLE_MS, 30 * 60_000)

  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  const idle = deskOf(ledger, minutesAgo(40))
  const idleLoan = ledger.deal('Loan', idle['Tokenized T-Bill'])
  const busy = deskOf(ledger, minutesAgo(2))
  const pending = vercelContext()
  const res = await call({ action: 'create' })
  assert.equal(res.statusCode, 200, res.body)
  // The desk is answered first; the janitor is handed to waitUntil, not awaited.
  assert.equal(pending.length, 1)
  assert.equal(ledger.state.submissions.length, 1, 'only the desk transaction ran before the response')
  assert.ok(ledger.state.contracts.some((c) => c.contractId === idleLoan.contractId))
  await Promise.all(pending)
  // Its closes are one batch transaction for all idle streams.
  assert.equal(ledger.state.submissions.length, 2)
  const ids = new Set(ledger.state.contracts.map((c) => c.contractId))
  assert.ok(!ids.has(idleLoan.contractId))
  assert.ok(!ledger.state.contracts.some((c) => Object.values(idle).includes(c.args.streamId)))
  assert.equal(ledger.state.contracts.filter((c) => Object.values(busy).includes(c.args.streamId)).length, 3)
  assert.ok(logLines.some((line) => /"msg":"desk janitor"/.test(line)))
})

test('cap: create is refused with 429 DESK_LIMIT when too many active desks remain', async () => {
  assert.equal(deskCount(0), 0)
  assert.equal(deskCount(4), 2)
  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  for (let i = 0; i < MAX_DESKS; i += 1) deskOf(ledger, minutesAgo(1))
  const res = await call({ action: 'create' })
  assert.equal(res.statusCode, 429)
  assert.equal(res.json().code, 'DESK_LIMIT')
  assert.match(res.json().message, /too many visitor desks/)
  assert.equal(ledger.state.submissions.length, 0)

  // Once one desk goes idle the janitor makes room: at the cap it runs inline,
  // before the response, and nothing is left for after it.
  const first = ledger.state.contracts.filter((c) => c.template === 'CollateralValuation').slice(0, 3)
  for (const c of first) c.args.observedAt = minutesAgo(31)
  const pending = vercelContext()
  assert.equal((await call({ action: 'create' })).statusCode, 200)
  assert.equal(pending.length, 0)
  assert.ok(!ledger.state.contracts.some((c) => first.some((f) => f.contractId === c.contractId)))
})

test('without a Vercel request context the janitor runs detached and logs its outcome', async () => {
  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  const idle = deskOf(ledger, minutesAgo(40))
  const res = await call({ action: 'create' })
  assert.equal(res.statusCode, 200, res.body)
  for (let i = 0; i < 50 && ledger.state.contracts.some((c) => Object.values(idle).includes(c.args.streamId)); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.ok(!ledger.state.contracts.some((c) => Object.values(idle).includes(c.args.streamId)))
  assert.ok(logLines.some((line) => /"msg":"desk janitor"/.test(line)))
})

test('close retries once when a contract moved meanwhile', async () => {
  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  const streams = deskOf(ledger)
  ledger.deal('LoanOffer', streams['Tokenized T-Bill'])
  const realFetch = ledger.fetchImpl
  let failed = false
  globalThis.fetch = async (url, init) => {
    if (!failed && String(url).endsWith('/submit-and-wait-for-transaction')) {
      failed = true
      return new Response(JSON.stringify({ code: 'CONTRACT_NOT_FOUND', cause: 'gone', errorCategory: 11 }), { status: 404 })
    }
    return realFetch(url, init)
  }
  const res = await call({ action: 'close', deskToken: signDeskToken({ deskId: 'desk-0002', streams, ledger: P.issuer }, privatePem).token })
  assert.equal(res.statusCode, 200, res.body)
  assert.ok(failed)
  assert.equal(ledger.state.contracts.filter((c) => Object.values(streams).includes(c.args.streamId)).length, 0)
})

test('local sandbox: the desk submits with a minted operator token; no signing key means no desks', async () => {
  for (const key of Object.keys(sharedEnv)) delete process.env[key]
  const ledger = fakeLedger()
  globalThis.fetch = ledger.fetchImpl
  const res = await call({ action: 'create' })
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(ledger.state.submissions[0].userId, 'veil-operator')
  const bearer = ledger.state.lastAuthorization.replace(/^Bearer /, '')
  assert.equal(authenticate({ headers: { authorization: `Bearer ${bearer}` } }).role, 'operator')

  delete process.env.VEIL_AUTH_PRIVATE_KEY
  process.env.VEIL_AUTH_PRIVATE_KEY_FILE = '/nonexistent/veil/private.pem'
  const unavailable = await call({ action: 'create' })
  assert.equal(unavailable.statusCode, 503)
  assert.equal(unavailable.json().code, 'DESK_UNAVAILABLE')
})
