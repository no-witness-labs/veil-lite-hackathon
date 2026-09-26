#!/usr/bin/env node
// Veil lender keeper: watches the lender's open loans on the Canton JSON Ledger
// API v2 and issues margin calls and liquidations the way the lender's desk
// would. Dry-run by default; pass --execute to submit. See docs/KEEPER.md.
//
// Decisions come from the pure decide() in keeper-lib.mjs; this file only reads
// ledger state, fetches registry context for Canton Coin, and submits.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_OPTIONS, EXECUTABLE, decide, parseDecimal } from './keeper-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEVNET_TOKENS_FILE = join(ROOT, '.local', 'devnet', 'tokens.json')
const TOKEN_REFRESH_MARGIN_S = 60
const META = { values: {} }
const EMPTY_EXTRA = { context: { values: {} }, meta: META }
const COIN_INSTRUMENT = 'Amulet'
const ALLOCATION_INTERFACE = '#splice-api-token-allocation-v2:Splice.Api.Token.AllocationV2:Allocation'
// The state already moved on (another keeper, the borrower, or a retried
// command that did land). Re-read next tick instead of failing.
const BENIGN_ERROR = /CONTRACT_NOT_FOUND|CONTRACT_NOT_ACTIVE|DUPLICATE_COMMAND|LOCKED_CONTRACTS|ALREADY_EXISTS/

const USAGE = `Usage: node scripts/keeper.mjs [--once] [--execute] [--interval SECONDS] [options]

  --execute              submit decided actions (default: dry-run, print only)
  --once                 run a single tick and exit (non-zero on errors)
  --interval SECONDS     seconds between ticks when looping (default 30)
  --skew-seconds N       clock-skew margin against ledger time (default 5)
  --warn-hours N         warn when a CoinLoan settlement deadline is this close (default 6)
  --ledger-url URL       JSON Ledger API base              [VEIL_LEDGER_TARGET]
  --registry-url URL     token registry base (CoinLoan)    [VEIL_REGISTRY_URL]
  --lender PARTY         lender party to act as            [VEIL_PARTY_LENDER]
  --valuer PARTY         only trust marks from this valuer [VEIL_PARTY_VALUER]
  --issuer PARTY         only handle loans of this issuer  [VEIL_PARTY_ISSUER]
  --user-id ID           ledger user id (default: token sub) [VEIL_LEDGER_USER_ID]
  --package-ref REF      Daml package reference (default #veil-lite) [VEIL_PACKAGE_REF]

Auth (first match wins):
  VEIL_KEEPER_BEARER       static bearer token
  VEIL_KEEPER_BEARER_FILE  file holding a token or an "Authorization: Bearer" line, re-read every tick
  VEIL_UPSTREAM_REFRESH_TOKEN (or .local/devnet/tokens.json) with VEIL_OIDC_TOKEN_URL and VEIL_OIDC_CLIENT_ID`

const FLAGS = {
  '--ledger-url': 'ledgerUrl',
  '--registry-url': 'registryUrl',
  '--lender': 'lender',
  '--valuer': 'valuer',
  '--issuer': 'issuer',
  '--user-id': 'userId',
  '--package-ref': 'packageRef',
  '--interval': 'interval',
  '--skew-seconds': 'skewSeconds',
  '--warn-hours': 'warnHours',
}

export class ConfigError extends Error {}

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '')
const stripSlash = (url) => url.replace(/\/+$/, '')

export function parseConfig(argv, env = process.env) {
  const cli = { execute: false, once: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--execute') cli.execute = true
    else if (arg === '--once') cli.once = true
    else if (arg === '--help' || arg === '-h') cli.help = true
    else if (FLAGS[arg]) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new ConfigError(`${arg} needs a value`)
      cli[FLAGS[arg]] = value
      i += 1
    } else throw new ConfigError(`unknown argument ${arg}`)
  }
  const number = (raw, fallback, name) => {
    if (raw === undefined || raw === '') return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) throw new ConfigError(`${name} must be a non-negative number`)
    return value
  }
  const config = {
    execute: cli.execute,
    once: cli.once,
    help: cli.help,
    ledgerUrl: stripSlash(trimmed(cli.ledgerUrl ?? env.VEIL_LEDGER_TARGET)),
    registryUrl: stripSlash(trimmed(cli.registryUrl ?? env.VEIL_REGISTRY_URL)),
    lender: trimmed(cli.lender ?? env.VEIL_PARTY_LENDER),
    valuer: trimmed(cli.valuer ?? env.VEIL_PARTY_VALUER),
    issuer: trimmed(cli.issuer ?? env.VEIL_PARTY_ISSUER),
    userId: trimmed(cli.userId ?? env.VEIL_LEDGER_USER_ID),
    packageRef: trimmed(cli.packageRef ?? env.VEIL_PACKAGE_REF) || '#veil-lite',
    intervalMs: number(cli.interval, 30, '--interval') * 1000,
    skewMs: number(cli.skewSeconds, DEFAULT_OPTIONS.skewMs / 1000, '--skew-seconds') * 1000,
    settlementWarnHours: number(cli.warnHours, DEFAULT_OPTIONS.settlementWarnHours, '--warn-hours'),
    auth: {
      bearer: trimmed(env.VEIL_KEEPER_BEARER),
      bearerFile: trimmed(env.VEIL_KEEPER_BEARER_FILE),
      refreshToken: trimmed(env.VEIL_UPSTREAM_REFRESH_TOKEN),
      tokenUrl: trimmed(env.VEIL_OIDC_TOKEN_URL),
      clientId: trimmed(env.VEIL_OIDC_CLIENT_ID),
    },
  }
  if (config.help) return config
  if (!config.ledgerUrl) throw new ConfigError('set VEIL_LEDGER_TARGET or --ledger-url')
  if (!config.lender) throw new ConfigError('set VEIL_PARTY_LENDER or --lender')
  if (config.intervalMs < 1000) throw new ConfigError('--interval must be at least 1 second')
  const { bearer, bearerFile, tokenUrl, clientId } = config.auth
  if (!bearer && !bearerFile && (!tokenUrl || !clientId)) {
    throw new ConfigError('no credentials: set VEIL_KEEPER_BEARER, VEIL_KEEPER_BEARER_FILE, or VEIL_OIDC_TOKEN_URL + VEIL_OIDC_CLIENT_ID with a refresh token')
  }
  return config
}

// ------------------------------------------------------------------ Auth --

function tokenSubject(token) {
  try {
    const segment = token.split('.')[1]
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')).sub ?? ''
  } catch {
    return ''
  }
}

/** Access-token source. Tokens are never logged. */
export function createAuth(auth, { readFile = readFileSync } = {}) {
  let cached = null
  return async function token() {
    if (auth.bearer) return auth.bearer
    if (auth.bearerFile) {
      const text = readFile(auth.bearerFile, 'utf8').trim().replace(/^Authorization:\s*Bearer\s+/i, '')
      if (!text) throw new Error(`bearer file ${auth.bearerFile} is empty`)
      return text
    }
    const nowS = Math.floor(Date.now() / 1000)
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_S > nowS) return cached.token
    let refreshToken = auth.refreshToken
    if (!refreshToken) {
      try {
        refreshToken = trimmed(JSON.parse(readFile(DEVNET_TOKENS_FILE, 'utf8')).refresh_token)
      } catch {
        refreshToken = ''
      }
    }
    if (!refreshToken) throw new Error(`no refresh token: set VEIL_UPSTREAM_REFRESH_TOKEN or create ${DEVNET_TOKENS_FILE} (docs/DEVNET.md)`)
    const res = await globalThis.fetch(auth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: auth.clientId, refresh_token: refreshToken }),
    })
    if (!res.ok) throw new Error(`token refresh failed (HTTP ${res.status})`)
    const payload = await res.json().catch(() => null)
    if (typeof payload?.access_token !== 'string' || !Number.isFinite(payload?.expires_in)) {
      throw new Error('token refresh returned no access_token/expires_in')
    }
    cached = { token: payload.access_token, expiresAt: nowS + payload.expires_in }
    return cached.token
  }
}

// ------------------------------------------------------------------- HTTP --

export class HttpError extends Error {
  constructor(where, status, body) {
    super(`${where} failed (HTTP ${status}): ${body.slice(0, 600)}`)
    this.status = status
    this.body = body
  }
}

export const isBenign = (error) => error instanceof HttpError && BENIGN_ERROR.test(error.body)

async function request(token, url, method, body) {
  const headers = { Authorization: `Bearer ${await token()}`, Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await globalThis.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  const where = `${method} ${new URL(url).pathname}`
  if (!res.ok) throw new HttpError(where, res.status, text)
  return text ? JSON.parse(text) : {}
}

const templateSuffix = (templateId) => String(templateId).split(':').slice(-2).join(':')

// ----------------------------------------------------------------- Keeper --

export function createKeeper(config, { now = () => Date.now(), emit = defaultEmit, token = createAuth(config.auth) } = {}) {
  const tpl = (name) => `${config.packageRef}:Veil:${name}`
  const ledger = (method, path, body) => request(token, `${config.ledgerUrl}${path}`, method, body)
  const registry = (path, body) => {
    if (!config.registryUrl) throw new Error('Canton Coin liquidation needs the token registry: set VEIL_REGISTRY_URL')
    return request(token, `${config.registryUrl}${path}`, 'POST', body)
  }
  let userId = config.userId

  async function activeContracts(cumulative) {
    const end = await ledger('GET', '/v2/state/ledger-end')
    const entries = await ledger('POST', '/v2/state/active-contracts', {
      filter: { filtersByParty: { [config.lender]: { cumulative } } },
      verbose: false,
      activeAtOffset: end.offset,
    })
    return entries.map((e) => e?.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean)
  }

  async function readState() {
    const events = await activeContracts([
      { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
    ])
    const loans = []
    const marks = []
    const skipped = []
    for (const ce of events) {
      const kind = templateSuffix(ce.templateId)
      const args = ce.createArgument ?? {}
      if (kind === 'Veil:Loan' || kind === 'Veil:CoinLoan') {
        if (args.lender !== config.lender) continue
        const loan = { contractId: ce.contractId, template: kind.slice(5), args }
        if (config.issuer && args.issuer !== config.issuer) skipped.push({ loan, reason: 'issuer differs from VEIL_PARTY_ISSUER' })
        else if (config.valuer && args.valuationAgent !== config.valuer) skipped.push({ loan, reason: 'valuation agent differs from VEIL_PARTY_VALUER' })
        else loans.push(loan)
      } else if (kind === 'Veil:CollateralValuation') {
        if (config.valuer && args.valuationAgent !== config.valuer) continue
        marks.push({ contractId: ce.contractId, args })
      }
    }
    return { loans, marks, skipped }
  }

  function commandId(kind, loanCid) {
    // Deterministic per action and contract version, so a retried command that
    // already landed is deduplicated by the participant.
    return `veil-keeper-${kind}-${createHash('sha256').update(loanCid).digest('hex').slice(0, 32)}`
  }

  async function submit(command, id, disclosedContracts = []) {
    if (!userId) userId = tokenSubject(await token())
    if (!userId) throw new Error('ledger user id unknown: set VEIL_LEDGER_USER_ID')
    const res = await ledger('POST', '/v2/commands/submit-and-wait-for-transaction', {
      commands: {
        commands: [command],
        commandId: id,
        actAs: [config.lender],
        userId,
        ...(disclosedContracts.length > 0
          ? { disclosedContracts: disclosedContracts.map(({ templateId, contractId, createdEventBlob, synchronizerId }) => ({ templateId, contractId, createdEventBlob, synchronizerId })) }
          : {}),
      },
    })
    const tx = res.transaction ?? {}
    const created = (tx.events ?? []).filter((e) => e.CreatedEvent).map((e) => ({ templateId: e.CreatedEvent.templateId, contractId: e.CreatedEvent.contractId }))
    return { updateId: tx.updateId ?? '', created }
  }

  const exercise = (template, contractId, choice, choiceArgument = {}) => ({ ExerciseCommand: { templateId: tpl(template), contractId, choice, choiceArgument } })

  // ---------------------------------------------------- Canton Coin (V2) --

  const coinAccount = (party) => ({ owner: party, provider: null, id: '' })
  const coinSettlement = (lender, id) => ({ executors: [lender], id, cid: null, meta: META })

  /** A receiving allocation from an earlier, unfinished liquidation attempt. */
  async function existingReceipt(loan) {
    const a = loan.args
    const events = await activeContracts([
      { identifierFilter: { InterfaceFilter: { value: { interfaceId: ALLOCATION_INTERFACE, includeInterfaceView: true, includeCreatedEventBlob: false } } } },
    ])
    const quantity = parseDecimal(a.collateralQuantity)
    for (const ce of events) {
      if (ce.contractId === a.allocationCid) continue
      for (const iv of ce.interfaceViews ?? []) {
        const v = iv?.viewValue
        const legs = v?.allocation?.transferLegSides ?? []
        if (v?.settlement?.id === a.settlementRef
          && v?.allocation?.authorizer?.owner === config.lender
          && legs.length === 1
          && legs[0].side === 'ReceiverSide'
          && legs[0].otherside?.owner === a.borrower
          && legs[0].instrumentId === COIN_INSTRUMENT
          && parseDecimal(legs[0].amount) === quantity) return ce.contractId
      }
    }
    return null
  }

  async function prepareReceipt(loan) {
    try {
      const found = await existingReceipt(loan)
      if (found) {
        emit({ event: 'receipt', loanCid: loan.contractId, receiptAllocationCid: found, reused: true })
        return found
      }
    } catch (error) {
      // The lookup is an optimisation against orphan receipts; preparing a new
      // one is still correct. Surface the failure rather than hide it.
      emit({ event: 'receiptLookupFailed', level: 'warn', loanCid: loan.contractId, error: message(error) })
    }
    const a = loan.args
    const settlement = coinSettlement(a.lender, a.settlementRef)
    const spec = {
      admin: a.coinAdmin,
      authorizer: coinAccount(a.lender),
      transferLegSides: [{ transferLegId: 'collateral', side: 'ReceiverSide', otherside: coinAccount(a.borrower), amount: a.collateralQuantity, instrumentId: COIN_INSTRUMENT, meta: META }],
      settlementDeadline: new Date(Date.parse(a.maturity) + 86_400_000).toISOString(),
      nextIterationFunding: null,
      committed: false,
      meta: META,
    }
    const factory = await registry('/registry/allocation-instruction/v2/allocation-factory', {
      choiceArguments: { settlement, allocation: spec, requestedAt: new Date(now()).toISOString(), inputHoldingCids: [], extraArgs: EMPTY_EXTRA, actors: [a.lender] },
      excludeDebugFields: true,
    })
    const prepared = await submit(
      exercise('CoinLoan', loan.contractId, 'PrepareCoinReceipt', {
        allocationFactoryCid: factory.factoryId,
        extraArgs: { context: factory.choiceContext.choiceContextData, meta: META },
      }),
      commandId('receipt', loan.contractId),
      factory.choiceContext.disclosedContracts ?? [],
    )
    const receipt = prepared.created.find((c) => /Allocation/.test(templateSuffix(c.templateId)))
    if (!receipt) throw new Error('PrepareCoinReceipt created no allocation')
    emit({ event: 'receipt', loanCid: loan.contractId, receiptAllocationCid: receipt.contractId, reused: false, updateId: prepared.updateId })
    return receipt.contractId
  }

  async function liquidateCoin(loan, action) {
    const a = loan.args
    for (const field of ['coinAdmin', 'borrower', 'settlementRef', 'collateralQuantity', 'maturity', 'allocationCid']) {
      if (!a[field]) throw new Error(`CoinLoan is missing ${field}`)
    }
    if (!config.registryUrl) throw new Error('Canton Coin liquidation needs the token registry: set VEIL_REGISTRY_URL')
    const receiptAllocationCid = await prepareReceipt(loan)
    const settlement = coinSettlement(a.lender, a.settlementRef)
    const transferLegs = [{ transferLegId: 'collateral', sender: coinAccount(a.borrower), receiver: coinAccount(a.lender), amount: a.collateralQuantity, instrumentId: COIN_INSTRUMENT, meta: META }]
    const allocations = [a.allocationCid, receiptAllocationCid].map((allocationCid) => ({ allocationCid, extraTransferLegSides: [], nextIterationFunding: null }))
    const settle = await registry('/registry/allocation/v2/settlement-factory', {
      choiceArguments: { settlement, transferLegs, allocations, actors: [a.lender], extraArgs: EMPTY_EXTRA },
      excludeDebugFields: true,
    })
    const extraArgs = { context: settle.choiceContext.choiceContextData, meta: META }
    const choiceArgument = action.kind === 'liquidate'
      ? { valuationCid: action.valuationCid, settlementFactoryCid: settle.factoryId, receiptAllocationCid, extraArgs }
      : { settlementFactoryCid: settle.factoryId, receiptAllocationCid, extraArgs }
    return submit(
      exercise('CoinLoan', loan.contractId, action.choice, choiceArgument),
      commandId(action.kind, loan.contractId),
      settle.choiceContext.disclosedContracts ?? [],
    )
  }

  async function perform(loan, action) {
    if (loan.template === 'CoinLoan' && action.kind !== 'issueMarginCall') return liquidateCoin(loan, action)
    const choiceArgument = action.kind === 'liquidateOverdue' ? {} : { valuationCid: action.valuationCid }
    return submit(exercise(loan.template, loan.contractId, action.choice, choiceArgument), commandId(action.kind, loan.contractId))
  }

  async function tick() {
    const mode = config.execute ? 'execute' : 'dry-run'
    const at = new Date(now()).toISOString()
    const summary = { decisions: 0, submitted: 0, benign: 0, errors: 0 }
    const { loans, marks, skipped } = await readState()
    for (const { loan, reason } of skipped) emit({ event: 'skip', at, template: loan.template, loanCid: loan.contractId, reason })
    const actions = decide(loans, marks, now(), { skewMs: config.skewMs, settlementWarnHours: config.settlementWarnHours })
    const byCid = new Map(loans.map((loan) => [loan.contractId, loan]))
    for (const action of actions) {
      const executable = EXECUTABLE.has(action.kind)
      summary.decisions += executable ? 1 : 0
      const level = action.kind === 'warnSettlementDeadline' || action.kind === 'invalid' ? 'warn' : 'info'
      emit({ event: 'decision', at, mode, level, ...action })
      if (level === 'warn') process.stderr.write(`KEEPER WARNING ${action.template} ${action.loanCid}: ${action.reason}\n`)
      if (!executable || !config.execute) continue
      try {
        const result = await perform(byCid.get(action.loanCid), action)
        summary.submitted += 1
        emit({ event: 'submitted', at, kind: action.kind, loanCid: action.loanCid, updateId: result.updateId })
      } catch (error) {
        if (isBenign(error)) {
          summary.benign += 1
          emit({ event: 'superseded', at, kind: action.kind, loanCid: action.loanCid, detail: message(error) })
        } else {
          summary.errors += 1
          emit({ event: 'error', at, level: 'error', kind: action.kind, loanCid: action.loanCid, error: message(error) })
        }
      }
    }
    emit({ event: 'tick', at, mode, loans: loans.length, marks: marks.length, ...summary })
    return summary
  }

  return { tick, readState }
}

const message = (error) => (error instanceof Error ? error.message : String(error))

function defaultEmit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`)
}

// ------------------------------------------------------------------- Main --

async function main() {
  let config
  try {
    config = parseConfig(process.argv.slice(2))
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    process.stderr.write(`keeper: ${error.message}\n\n${USAGE}\n`)
    process.exit(2)
  }
  if (config.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const keeper = createKeeper(config)
  let stopping = false
  let wake = null
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopping = true
      wake?.()
    })
  }
  do {
    let failed = false
    try {
      const summary = await keeper.tick()
      failed = summary.errors > 0
    } catch (error) {
      failed = true
      defaultEmit({ event: 'error', at: new Date().toISOString(), level: 'error', error: message(error) })
    }
    if (config.once) process.exit(failed ? 1 : 0)
    if (stopping) break
    await new Promise((done) => {
      const timer = setTimeout(done, config.intervalMs)
      wake = () => {
        clearTimeout(timer)
        done()
      }
    })
  } while (!stopping)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}

