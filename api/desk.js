const crypto = require('node:crypto')
const { authConfig, authenticate, AuthError, DEFAULT_ISSUER, knownParties, packageRef, privateKeyFromEnv, respondError, ROLE_SUBJECTS } = require('./_auth')
const { ledgerTarget, parseJsonBody, requestBody } = require('./_ledger')
const { upstreamConfig, upstreamToken } = require('./_upstream')
const { registryTarget } = require('./_registry')
const { mintRoleToken } = require('./demo-login')
const { beginRequest, isTimeout, noteRole, readCapped, ResponseTooLargeError, sanitizeLedgerError, sendError, sendJson, upstreamFetch } = require('./_http')

// Visitor desks. The hosted demo is open and every visitor signs in as the same
// shared parties, so the app gives each browser its own "desk": one
// ValuationStream per valued asset, created here with the server's ledger
// credential. Every offer, loan, closed record and mark names its stream, so
// the set of stream ids is the desk: the browser shows and acts on only the
// contracts on its streams. Desks separate visitors in the app, not on the
// ledger; every desk is a contract between the same demo parties.
//
// PublishInitial consumes the stream, so a stream is "active" while a
// CollateralValuation names it. Every stream is a desk stream (the operator's
// browser gets a desk like any other, and reset no longer seeds streams), so
// the janitor rule is uniform: a stream whose current mark is older than
// IDLE_MS has been left alone and its contracts are closed. The janitor runs
// after the create response (Vercel waitUntil), except when the desk cap is
// hit, where it runs inline before the count is re-checked. A desk whose
// stream was janitored is repaired on its next create (same deskId, a new
// stream for that asset).

/** Mirrors VALUED_ASSETS and SEED_PRICE in frontend/src/ledger.ts. */
const VALUED_ASSETS = Object.freeze(['Tokenized T-Bill', 'Tokenized MMF', 'Canton Coin'])
const SEED_PRICE = Object.freeze({ 'Canton Coin': '0.15' })
const DESK_TTL_SECONDS = 24 * 60 * 60
const DESK_AUDIENCE = 'veil-desk'
const DESK_TYPE = 'veil-desk'
const IDLE_MS = 30 * 60 * 1000
const MAX_DESKS = 25
/** Idle streams closed per create, so one visitor's sign-in stays bounded. */
const JANITOR_MAX_STREAMS = 6
const MAX_DESK_TOKEN_LENGTH = 8192
const MAX_ACS_BYTES = 16 * 1_048_576
const REGISTRY_TIMEOUT_MS = 10_000
const ACTIONS = new Set(['create', 'close'])
const DESK_SCOPED = new Set(['LoanOffer', 'CoinLoanOffer', 'Loan', 'CoinLoan', 'LoanClosed', 'SubstitutionRequest', 'CollateralValuation', 'ValuationStream'])
const ISSUER_SCOPED = new Set(['LoanOffer', 'CoinLoanOffer', 'Loan', 'CoinLoan', 'LoanClosed', 'SubstitutionRequest'])
const META = { values: {} }

class LedgerCallError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.name = 'LedgerCallError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}

/* ------------------------------------------------------------ desk token -- */

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function signDeskToken({ deskId, streams, ledger }, privateKeyPem, now = Math.floor(Date.now() / 1000)) {
  const claims = { iss: DEFAULT_ISSUER, aud: DESK_AUDIENCE, deskId, ledger, streams, iat: now, exp: now + DESK_TTL_SECONDS }
  // A distinct typ and audience, no subject and a 24 h lifetime: authenticate()
  // rejects a desk token on all four counts, so it can never act as a role token.
  const input = `${encode({ alg: 'RS256', typ: DESK_TYPE })}.${encode(claims)}`
  let signature
  try {
    signature = crypto.sign('RSA-SHA256', Buffer.from(input), crypto.createPrivateKey(privateKeyPem))
  } catch {
    throw new AuthError(503, 'DESK_UNAVAILABLE')
  }
  return { token: `${input}.${signature.toString('base64url')}`, claims }
}

function decodeSegment(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new AuthError(401, 'DESK_INVALID')
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('object expected')
    return decoded
  } catch {
    throw new AuthError(401, 'DESK_INVALID')
  }
}

/** Verify a desk token for this ledger and return {deskId, streams, exp}. */
function verifyDeskToken(token, env, ledger, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || !token || token.length > MAX_DESK_TOKEN_LENGTH) throw new AuthError(401, 'DESK_INVALID')
  const segments = token.split('.')
  if (segments.length !== 3) throw new AuthError(401, 'DESK_INVALID')
  const header = decodeSegment(segments[0])
  const claims = decodeSegment(segments[1])
  if (header.alg !== 'RS256' || header.typ !== DESK_TYPE) throw new AuthError(401, 'DESK_INVALID')
  if (!/^[A-Za-z0-9_-]+$/.test(segments[2])) throw new AuthError(401, 'DESK_INVALID')
  let valid
  try {
    valid = crypto.verify('RSA-SHA256', Buffer.from(`${segments[0]}.${segments[1]}`), authConfig(env).publicKey, Buffer.from(segments[2], 'base64url'))
  } catch {
    throw new AuthError(503, 'DESK_UNAVAILABLE')
  }
  if (!valid) throw new AuthError(401, 'DESK_INVALID')
  if (claims.iss !== DEFAULT_ISSUER || claims.aud !== DESK_AUDIENCE || claims.ledger !== ledger) throw new AuthError(401, 'DESK_INVALID')
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > now + 60 || claims.exp - claims.iat > DESK_TTL_SECONDS) {
    throw new AuthError(401, 'DESK_INVALID')
  }
  if (claims.exp <= now) throw new AuthError(401, 'DESK_EXPIRED')
  if (typeof claims.deskId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(claims.deskId)) throw new AuthError(401, 'DESK_INVALID')
  const streams = claims.streams
  if (!streams || typeof streams !== 'object' || Array.isArray(streams)) throw new AuthError(401, 'DESK_INVALID')
  const assets = Object.keys(streams)
  if (assets.length === 0 || assets.some((asset) => !VALUED_ASSETS.includes(asset) || typeof streams[asset] !== 'string' || !streams[asset])) {
    throw new AuthError(401, 'DESK_INVALID')
  }
  return { deskId: claims.deskId, streams: { ...streams }, exp: claims.exp }
}

/* ------------------------------------------------------ pure desk logic -- */

function templateName(templateId) {
  const parts = String(templateId).split(':')
  return parts.length >= 3 && parts[parts.length - 2] === 'Veil' ? parts[parts.length - 1] : null
}

/** Normalize ACS entries to {contractId, template, offset, args}; Veil templates only. */
function normalizeActive(entries) {
  const out = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const ce = entry?.contractEntry?.JsActiveContract?.createdEvent
    if (!ce || typeof ce.contractId !== 'string') continue
    const template = templateName(ce.templateId)
    if (!template) continue
    out.push({ contractId: ce.contractId, template, offset: ce.offset ?? 0, args: ce.createArgument ?? {} })
  }
  return out
}

/** Current marks between the configured demo parties, one per active stream. */
function demoMarks(contracts, config) {
  const { parties } = config
  return contracts.filter((c) => c.template === 'CollateralValuation'
    && c.args.valuationAgent === parties.valuer
    && c.args.lender === parties.lender
    && c.args.borrower === parties.borrower
    && c.args.regulator === parties.regulator
    && typeof c.args.streamId === 'string'
    && VALUED_ASSETS.includes(c.args.collateralAsset))
}

/** The stream a contract belongs to, or null for contracts outside any desk. */
function streamOf(contract) {
  switch (contract.template) {
    case 'CollateralValuation':
      return contract.args.streamId ?? null
    case 'ValuationStream':
      return contract.contractId
    case 'SubstitutionRequest':
      // The request names the replacement asset's stream, which the borrower
      // took from its own desk.
      return contract.args.newValuationStreamId ?? null
    default:
      return DESK_SCOPED.has(contract.template) ? contract.args.valuationStreamId ?? null : null
  }
}

/** Contracts on the given streams, grouped by what closing them takes. */
function deskContracts(contracts, streamIds, issuer) {
  const ids = new Set(streamIds)
  const out = { offers: [], coinLoans: [], loans: [], closed: [], substitutions: [], marks: [], streams: [] }
  for (const c of contracts) {
    const stream = streamOf(c)
    if (!stream || !ids.has(stream)) continue
    if (ISSUER_SCOPED.has(c.template) && c.args.issuer !== issuer) continue
    if (c.template === 'LoanOffer' || c.template === 'CoinLoanOffer') out.offers.push(c)
    else if (c.template === 'CoinLoan') out.coinLoans.push(c)
    else if (c.template === 'Loan') out.loans.push(c)
    else if (c.template === 'LoanClosed') out.closed.push(c)
    else if (c.template === 'SubstitutionRequest') out.substitutions.push(c)
    else if (c.template === 'CollateralValuation') out.marks.push(c)
    else if (c.template === 'ValuationStream') out.streams.push(c)
  }
  return out
}

/** Streams whose newest mark is older than idleMs (or unreadable), oldest
 * first, never one of `keep`. */
function idleStreams(marks, nowMs, keep = [], idleMs = IDLE_MS) {
  const kept = new Set(keep)
  const latest = new Map()
  for (const mark of marks) {
    const stream = mark.args.streamId
    if (kept.has(stream)) continue
    const observed = Date.parse(mark.args.observedAt)
    const value = Number.isFinite(observed) ? observed : Number.NEGATIVE_INFINITY
    latest.set(stream, Math.max(latest.get(stream) ?? Number.NEGATIVE_INFINITY, value))
  }
  return [...latest.entries()]
    .filter(([, observed]) => nowMs - observed > idleMs)
    .sort((a, b) => a[1] - b[1])
    .map(([stream]) => stream)
}

/** Open desks, counting a partial desk as one. */
const deskCount = (streamCount) => Math.ceil(streamCount / VALUED_ASSETS.length)

/* ------------------------------------------------------- ledger access -- */

async function ledgerAccess(env) {
  const shared = upstreamConfig(env)
  if (shared) return { bearer: await upstreamToken(shared), userId: shared.ledgerUserId, shared }
  // Local sandbox: the proxy forwards each caller's own role token, but a desk
  // needs lender, borrower and valuer authority together, which only the
  // operator user holds. Mint a short-lived operator token for this request.
  const privateKeyPem = privateKeyFromEnv(env)
  if (!privateKeyPem) throw new AuthError(503, 'DESK_UNAVAILABLE')
  return { bearer: mintRoleToken('operator', privateKeyPem, env), userId: ROLE_SUBJECTS.operator, shared: null }
}

function ledgerClient(env, access, ctx) {
  const target = ledgerTarget(env)
  const pkg = packageRef(env)
  const template = (name) => `${pkg}:Veil:${name}`

  async function call(method, path, body) {
    let response
    let raw
    try {
      response = await upstreamFetch(`${target}${path}`, {
        method,
        headers: { Authorization: `Bearer ${access.bearer}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      raw = await readCapped(response, MAX_ACS_BYTES)
    } catch (error) {
      if (error instanceof ResponseTooLargeError) throw new LedgerCallError(502, 'PROXY_ERROR', 'The ledger returned an oversized response.')
      if (isTimeout(error)) throw new LedgerCallError(504, 'LEDGER_TIMEOUT')
      throw new LedgerCallError(502, 'PROXY_ERROR')
    }
    if (!response.ok) {
      const { code, message, errorId, category } = sanitizeLedgerError(response.status, raw)
      ctx.ledgerCode = code
      throw new LedgerCallError(response.status, code, message, { ...(errorId ? { errorId } : {}), ...(category !== undefined ? { category } : {}) })
    }
    try {
      return JSON.parse(raw.toString('utf8') || '{}')
    } catch {
      throw new LedgerCallError(502, 'PROXY_ERROR')
    }
  }

  async function active(party) {
    const end = await call('GET', '/v2/state/ledger-end')
    const entries = await call('POST', '/v2/state/active-contracts', {
      filter: { filtersByParty: { [party]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } },
      verbose: false,
      activeAtOffset: end.offset,
    })
    return normalizeActive(entries)
  }

  async function submit(actAs, commands, prefix, disclosedContracts) {
    const result = await call('POST', '/v2/commands/submit-and-wait-for-transaction', {
      commands: {
        commands,
        commandId: `desk-${prefix}-${crypto.randomUUID()}`,
        actAs,
        userId: access.userId,
        ...(disclosedContracts && disclosedContracts.length > 0
          ? { disclosedContracts: disclosedContracts.map(({ templateId, contractId, createdEventBlob, synchronizerId }) => ({ templateId, contractId, createdEventBlob, synchronizerId })) }
          : {}),
      },
    })
    return result?.transaction ?? {}
  }

  async function cancelContext(allocationCid) {
    const base = registryTarget(env)
    if (!base || !access.shared) throw new LedgerCallError(503, 'REGISTRY_UNAVAILABLE', 'A Canton Coin loan needs the token registry to be released, which is not configured here.')
    let response
    let raw
    try {
      response = await upstreamFetch(`${base}/registry/allocations/v2/${encodeURIComponent(allocationCid)}/choice-contexts/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access.bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ excludeDebugFields: true }),
      }, REGISTRY_TIMEOUT_MS)
      raw = await readCapped(response, 1_048_576)
    } catch (error) {
      if (isTimeout(error)) throw new LedgerCallError(504, 'REGISTRY_TIMEOUT')
      throw new LedgerCallError(502, 'REGISTRY_PROXY_ERROR')
    }
    if (!response.ok) throw new LedgerCallError(502, 'REGISTRY_PROXY_ERROR', `The token registry returned HTTP ${response.status}.`)
    try {
      return JSON.parse(raw.toString('utf8'))
    } catch {
      throw new LedgerCallError(502, 'REGISTRY_PROXY_ERROR')
    }
  }

  const exercise = (name, contractId, choice, choiceArgument = {}) => ({ ExerciseCommand: { templateId: template(name), contractId, choice, choiceArgument } })
  const createAndExercise = (name, createArguments, choice, choiceArgument) => ({ CreateAndExerciseCommand: { templateId: template(name), createArguments, choice, choiceArgument } })

  return { active, submit, cancelContext, exercise, createAndExercise }
}

/* ------------------------------------------------------- desk operations -- */

/** Open one stream per asset in one transaction; returns {asset: streamId}. */
async function openStreams(ledger, config, assets) {
  const { parties } = config
  const commands = assets.map((asset) => ledger.createAndExercise(
    'ValuationStream',
    { valuationAgent: parties.valuer, lender: parties.lender, borrower: parties.borrower, regulator: parties.regulator, collateralAsset: asset },
    'PublishInitial',
    { unitPrice: SEED_PRICE[asset] ?? '1' },
  ))
  // One transaction for every missing asset: a desk costs one ledger round trip.
  const tx = await ledger.submit([parties.lender, parties.borrower, parties.valuer], commands, 'open')
  const created = (tx.events ?? [])
    .map((event) => event?.CreatedEvent)
    .filter((event) => event && templateName(event.templateId) === 'CollateralValuation')
    .map((event) => ({ contractId: event.contractId, template: 'CollateralValuation', args: event.createArgument ?? {} }))
  let marks = demoMarks(created, config)
  if (marks.length < assets.length) {
    // The response carried no create arguments: read the new marks back.
    const ids = new Set(created.map((mark) => mark.contractId))
    marks = demoMarks(await ledger.active(parties.valuer), config).filter((mark) => ids.has(mark.contractId))
  }
  const streams = {}
  for (const mark of marks) streams[mark.args.collateralAsset] = mark.args.streamId
  if (assets.some((asset) => !streams[asset])) throw new LedgerCallError(502, 'DESK_ERROR', 'The desk streams were created but could not be read back.')
  return streams
}

function retryable(error) {
  return error instanceof LedgerCallError && /CONTRACT_NOT_FOUND|CONTRACT_NOT_ACTIVE|INACTIVE_CONTRACTS|INCONSISTENT|LOCKED_CONTRACTS/.test(error.code)
}

/** Close every contract on these streams, in resetDemo's order: release
 * Canton Coin first, then in one transaction withdraw offers, return escrowed
 * substitution collateral, archive loans, dismiss closed records and archive
 * the marks. Holdings are never burned or minted. */
async function closeStreams(ledger, config, streamIds) {
  if (streamIds.length === 0) return { offers: 0, loans: 0, coinLoans: 0, closed: 0, substitutions: 0, marks: 0 }
  const { issuer, parties } = config
  let scoped = deskContracts(await ledger.active(parties.lender), streamIds, issuer)
  const coinLoans = scoped.coinLoans.length
  for (const loan of scoped.coinLoans) {
    // Never strand borrower Canton Coin: the lender releases it (WriteOffCoin),
    // which cancels the allocation and leaves a LoanClosed to dismiss below.
    const ctx = await ledger.cancelContext(loan.args.allocationCid)
    await ledger.submit(
      [parties.lender],
      [ledger.exercise('CoinLoan', loan.contractId, 'WriteOffCoin', { cancelExtraArgs: { context: ctx.choiceContextData, meta: META } })],
      'write-off-coin',
      ctx.disclosedContracts,
    )
  }
  for (let attempt = 0; ; attempt += 1) {
    if (coinLoans > 0 || attempt > 0) scoped = deskContracts(await ledger.active(parties.lender), streamIds, issuer)
    const commands = [
      ...scoped.offers.map((c) => ledger.exercise(c.template, c.contractId, c.template === 'CoinLoanOffer' ? 'WithdrawCoinOffer' : 'Withdraw')),
      ...scoped.substitutions.map((c) => ledger.exercise('SubstitutionRequest', c.contractId, 'CancelSubstitution')),
      ...scoped.loans.map((c) => ledger.exercise('Loan', c.contractId, 'Archive')),
      ...scoped.closed.map((c) => ledger.exercise('LoanClosed', c.contractId, 'Dismiss')),
      ...scoped.marks.map((c) => ledger.exercise('CollateralValuation', c.contractId, 'Archive')),
      ...scoped.streams.map((c) => ledger.exercise('ValuationStream', c.contractId, 'Archive')),
    ]
    const counts = { offers: scoped.offers.length, loans: scoped.loans.length, coinLoans, closed: scoped.closed.length, substitutions: scoped.substitutions.length, marks: scoped.marks.length }
    if (commands.length === 0) return counts
    try {
      await ledger.submit([issuer, parties.lender, parties.borrower, parties.valuer], commands, 'close')
      return counts
    } catch (error) {
      // A visitor may have moved a contract meanwhile; re-read once.
      if (attempt > 0 || !retryable(error)) throw error
    }
  }
}

/** Close idle streams (not `keep`); failures are logged, never fatal. */
async function janitor(ledger, config, marks, keep, nowMs, ctx) {
  const idle = idleStreams(marks, nowMs, keep).slice(0, JANITOR_MAX_STREAMS)
  if (idle.length === 0) return 0
  try {
    await closeStreams(ledger, config, idle)
    console.log(JSON.stringify({ level: 'info', msg: 'desk janitor', requestId: ctx.id, streams: idle.length }))
    return idle.length
  } catch (error) {
    console.log(JSON.stringify({ level: 'warn', msg: 'desk janitor failed', requestId: ctx.id, streams: idle.length, code: error?.code || 'ERROR' }))
    return 0
  }
}

async function createDesk(env, config, access, ledger, currentToken, ctx) {
  const privateKeyPem = privateKeyFromEnv(env)
  if (!privateKeyPem) throw new AuthError(503, 'DESK_UNAVAILABLE')
  let current = null
  if (currentToken !== undefined) {
    try {
      current = verifyDeskToken(currentToken, env, config.issuer)
    } catch (error) {
      if (error instanceof AuthError && error.status === 503) throw error
      current = null // an unusable token just means a new desk
    }
  }
  let marks = demoMarks(await ledger.active(config.parties.valuer), config)
  const liveStreams = new Set(marks.map((mark) => mark.args.streamId))
  const keep = {}
  if (current) {
    for (const [asset, stream] of Object.entries(current.streams)) if (liveStreams.has(stream)) keep[asset] = stream
    if (VALUED_ASSETS.every((asset) => keep[asset])) {
      return { desk: { token: currentToken, deskId: current.deskId, streams: keep, expiresAt: current.exp, reused: true }, background: null }
    }
  }
  const keepIds = Object.values(keep)
  const otherDesks = (list) => deskCount(new Set(list.map((mark) => mark.args.streamId).filter((stream) => !keepIds.includes(stream))).size)
  // The cap is checked on the current count. Only when it is hit does the
  // janitor run inline (then the count is re-read); otherwise it runs after
  // the response, off the visitor's sign-in path.
  let janitorDone = false
  if (otherDesks(marks) >= MAX_DESKS) {
    janitorDone = true
    if (await janitor(ledger, config, marks, keepIds, Date.now(), ctx) > 0) {
      marks = demoMarks(await ledger.active(config.parties.valuer), config)
    }
    if (otherDesks(marks) >= MAX_DESKS) throw new AuthError(429, 'DESK_LIMIT')
  }
  const missing = VALUED_ASSETS.filter((asset) => !keep[asset])
  const streams = { ...keep, ...(await openStreams(ledger, config, missing)) }
  const deskId = Object.keys(keep).length > 0 && current ? current.deskId : crypto.randomUUID()
  const { token, claims } = signDeskToken({ deskId, streams, ledger: config.issuer }, privateKeyPem)
  const desk = { token, deskId, streams, expiresAt: claims.exp, reused: false }
  // The marks read above predate the new streams, so only older streams (never
  // this desk's kept ones) can be idle.
  const background = janitorDone ? null : () => janitor(ledger, config, marks, keepIds, Date.now(), ctx)
  return { desk, background }
}

/** Run work after the response: Vercel's waitUntil keeps the function alive
 * for it (the request context @vercel/functions reads, without the package);
 * elsewhere (the Vite dev proxy) it simply runs detached. The task logs its
 * own failures; nothing here may throw into the finished request. */
function afterResponse(task, ctx) {
  const run = () => Promise.resolve().then(task).catch((error) => {
    console.log(JSON.stringify({ level: 'warn', msg: 'desk background task failed', requestId: ctx.id, code: error?.code || 'ERROR' }))
  })
  const waitUntil = globalThis[Symbol.for('@vercel/request-context')]?.get?.()?.waitUntil
  if (typeof waitUntil === 'function') {
    waitUntil(run())
    return 'waitUntil'
  }
  void run()
  return 'detached'
}

/* ----------------------------------------------------------------- handler -- */

function exactBody(body) {
  const keys = Object.keys(body)
  if (keys.some((key) => key !== 'action' && key !== 'deskToken')) throw new AuthError(400, 'REQUEST_INVALID')
  if (!ACTIONS.has(body.action)) throw new AuthError(400, 'REQUEST_INVALID')
  if (body.deskToken !== undefined && (typeof body.deskToken !== 'string' || body.deskToken.length > MAX_DESK_TOKEN_LENGTH)) throw new AuthError(400, 'REQUEST_INVALID')
  if (body.action === 'close' && typeof body.deskToken !== 'string') throw new AuthError(400, 'REQUEST_INVALID')
  return body
}

async function handler(req, res) {
  const ctx = beginRequest(req, res, '/api/desk')
  const env = req?.veilEnv || process.env
  const method = String(req.method || 'GET').toUpperCase()
  if (method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendError(res, 405, 'METHOD_NOT_ALLOWED')
    return
  }
  try {
    if (new URL(req.url || '/', 'https://veil.local').search) throw new AuthError(400, 'REQUEST_INVALID')
    // Any signed-in demo role may hold a desk; authenticate before the body.
    noteRole(res, authenticate(req, env).role)
    const body = exactBody(parseJsonBody(await requestBody(req)))
    const config = knownParties(env)
    if (body.action === 'close') {
      const desk = verifyDeskToken(body.deskToken, env, config.issuer)
      const access = await ledgerAccess(env)
      const closed = await closeStreams(ledgerClient(env, access, ctx), config, Object.values(desk.streams))
      sendJson(res, 200, { deskId: desk.deskId, closed })
      return
    }
    const access = await ledgerAccess(env)
    const { desk, background } = await createDesk(env, config, access, ledgerClient(env, access, ctx), body.deskToken, ctx)
    sendJson(res, 200, desk)
    if (background) afterResponse(background, ctx)
  } catch (error) {
    if (error instanceof LedgerCallError) {
      sendError(res, error.status, error.code, error.message === error.code ? undefined : error.message, error.extra)
      return
    }
    if (error instanceof AuthError) {
      respondError(res, error)
      return
    }
    sendError(res, 500, 'DESK_ERROR')
  }
}

module.exports = handler
module.exports.internals = {
  DESK_TTL_SECONDS,
  IDLE_MS,
  JANITOR_MAX_STREAMS,
  MAX_DESKS,
  VALUED_ASSETS,
  deskCount,
  idleStreams,
  signDeskToken,
  verifyDeskToken,
}
