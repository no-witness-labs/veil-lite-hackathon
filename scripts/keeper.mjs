#!/usr/bin/env node
// Veil lender keeper: watches the lender's open loans on the Canton JSON Ledger
// API v2 and issues margin calls and liquidations the way the lender's desk
// would. Dry-run by default; pass --execute to submit. See docs/KEEPER.md.
//
// Decisions come from the pure decide() in keeper-lib.mjs; this file only reads
// ledger state, fetches registry context for Canton Coin, and submits.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_OPTIONS, EXECUTABLE, decide, parseDecimal } from './keeper-lib.mjs'
import { BlockedError, JournalError, openJournal, operationKey, startable } from './keeper/journal.mjs'

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
const LIQUIDATIONS = new Set(['liquidate', 'liquidateOverdue'])
const DEFAULT_STATE_DIR = join(ROOT, '.local', 'keeper')

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
  --state-dir DIR        command journal + audit log (default .local/keeper) [VEIL_KEEPER_STATE_DIR]
  --keeper-id NAME       this keeper's identity as proposer (default keeper) [VEIL_KEEPER_ID]
  --require-approval N   liquidations need N approvals before submission (default 0 = off)
  --submit-timeout-seconds N  give up waiting for a submission after N s; outcome unknown (default 60)

Operator commands (journal only; no ledger access, no credentials):
  --approve ID --by NAME [--remarks TEXT]   approve a liquidation proposal
  --reject ID --by NAME --remarks TEXT      reject a liquidation proposal
  --retry OPERATION_KEY [--by NAME]         allow one more attempt of a rejected, unknown or declined operation

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
  '--state-dir': 'stateDir',
  '--keeper-id': 'keeperId',
  '--require-approval': 'requireApproval',
  '--submit-timeout-seconds': 'submitTimeout',
  '--approve': 'approve',
  '--reject': 'reject',
  '--retry': 'retry',
  '--by': 'by',
  '--remarks': 'remarks',
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
    stateDir: resolve(trimmed(cli.stateDir ?? env.VEIL_KEEPER_STATE_DIR) || DEFAULT_STATE_DIR),
    keeperId: trimmed(cli.keeperId ?? env.VEIL_KEEPER_ID) || 'keeper',
    requireApproval: number(cli.requireApproval ?? env.VEIL_KEEPER_REQUIRE_APPROVAL, 0, '--require-approval'),
    submitTimeoutMs: number(cli.submitTimeout, 60, '--submit-timeout-seconds') * 1000,
    reconcile: { pageSize: 200, maxPages: 10, maxBytes: 4_000_000, idleMs: 500 },
    operator: null,
    auth: {
      bearer: trimmed(env.VEIL_KEEPER_BEARER),
      bearerFile: trimmed(env.VEIL_KEEPER_BEARER_FILE),
      refreshToken: trimmed(env.VEIL_UPSTREAM_REFRESH_TOKEN),
      tokenUrl: trimmed(env.VEIL_OIDC_TOKEN_URL),
      clientId: trimmed(env.VEIL_OIDC_CLIENT_ID),
    },
  }
  if (!Number.isInteger(config.requireApproval)) throw new ConfigError('--require-approval must be a whole number')
  const ops = ['approve', 'reject', 'retry'].filter((op) => cli[op] !== undefined)
  if (ops.length > 1) throw new ConfigError('use one of --approve, --reject, --retry at a time')
  if (ops.length === 0 && (cli.by !== undefined || cli.remarks !== undefined)) throw new ConfigError('--by and --remarks go with --approve, --reject or --retry')
  if (ops.length === 1) {
    const op = ops[0]
    const by = trimmed(cli.by) || (op === 'retry' ? userInfo().username : '')
    if (!by) throw new ConfigError(`--${op} needs --by NAME`)
    if (op === 'reject' && !trimmed(cli.remarks)) throw new ConfigError('--reject needs --remarks TEXT')
    config.operator = { op, target: trimmed(cli[op]), by, remarks: trimmed(cli.remarks) }
    return config
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

async function requestText(token, url, method, body, timeoutMs) {
  const headers = { Authorization: `Bearer ${await token()}`, Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await globalThis.fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  })
  const text = await res.text()
  const where = `${method} ${new URL(url).pathname}`
  if (!res.ok) throw new HttpError(where, res.status, text)
  return text
}

async function request(token, url, method, body, timeoutMs) {
  const text = await requestText(token, url, method, body, timeoutMs)
  return text ? JSON.parse(text) : {}
}

// ------------------------------------------------------ Submission outcome --
//
// A submission ends completed, rejected or unknown. Only a rejection that
// definitely did not commit may be retried automatically: the connection never
// opened, a gateway refused it (429/503 without a ledger error body), or the
// ledger answered synchronously with a transient Canton error category. Anything
// that may have reached the ledger without a definite answer is unknown.

// Connection-level failures where no request bytes reached the server.
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])
// gRPC UNAVAILABLE, ABORTED, RESOURCE_EXHAUSTED; Canton ErrorCategory
// TransientServerFailure (1) and ContentionOnSharedResources (2).
const TRANSIENT_GRPC = new Set([14, 10, 8])
const TRANSIENT_CATEGORY = new Set([1, 2])
// gRPC DEADLINE_EXCEEDED; Canton DeadlineExceededRequestStateUnknown (3).
const UNKNOWN_GRPC = 4
const UNKNOWN_CATEGORY = 3

function cantonError(body) {
  try {
    const parsed = JSON.parse(body)
    return typeof parsed?.code === 'string' && typeof parsed?.cause === 'string' ? parsed : null
  } catch {
    return null
  }
}

function causeCodes(error) {
  const cause = error?.cause
  return [cause?.code, ...(cause?.errors ?? []).map((e) => e?.code)].filter(Boolean)
}

/** Classify a failed submit into { status: 'rejected', rejection } or { status: 'unknown', unknownReason }. */
export function classifySubmitError(error) {
  if (error instanceof HttpError) {
    const canton = cantonError(error.body)
    const code = canton?.code ?? `HTTP_${error.status}`
    const detail = (canton?.cause ?? error.body).slice(0, 300)
    const rejected = (cls) => ({ status: 'rejected', rejection: { class: cls, dispatched: cls === 'transient' ? false : null, code, message: detail, httpStatus: error.status } })
    if (canton?.grpcCodeValue === UNKNOWN_GRPC || canton?.errorCategory === UNKNOWN_CATEGORY || canton?.definiteAnswer === false) {
      return { status: 'unknown', unknownReason: `ledger could not confirm the outcome (${code})` }
    }
    if (canton && (TRANSIENT_GRPC.has(canton.grpcCodeValue) || TRANSIENT_CATEGORY.has(canton.errorCategory))) return rejected('transient')
    if (!canton && (error.status === 429 || error.status === 503)) return rejected('transient')
    if (error.status >= 500) return { status: 'unknown', unknownReason: `HTTP ${error.status} after the request was sent (${code})` }
    return rejected('definitive')
  }
  const codes = causeCodes(error)
  if (codes.length > 0 && codes.every((c) => NOT_SENT.has(c))) {
    return { status: 'rejected', rejection: { class: 'transient', dispatched: false, code: codes[0], message: message(error) } }
  }
  return { status: 'unknown', unknownReason: error?.name === 'TimeoutError' ? 'timed out waiting for the ledger' : message(error) }
}

/** Classify a failed completion (grpc status code) found by reconciliation: it reached the ledger. */
function completionRejection(status) {
  return { status: 'rejected', rejection: { class: TRANSIENT_GRPC.has(status.code) ? 'transient' : 'definitive', dispatched: true, code: `GRPC_${status.code}`, message: String(status.message ?? '').slice(0, 300) } }
}

export class SubmitError extends Error {
  constructor(outcome, cause) {
    super(message(cause))
    this.outcome = outcome
    this.cause = cause
  }
}

const templateSuffix = (templateId) => String(templateId).split(':').slice(-2).join(':')

// ----------------------------------------------------------------- Keeper --

export function createKeeper(config, { now = () => Date.now(), emit = defaultEmit, token = createAuth(config.auth), journal = openJournal(config.stateDir, { now }) } = {}) {
  const tpl = (name) => `${config.packageRef}:Veil:${name}`
  const ledger = (method, path, body, timeoutMs) => request(token, `${config.ledgerUrl}${path}`, method, body, timeoutMs)
  const registry = (path, body) => {
    if (!config.registryUrl) throw new Error('Canton Coin liquidation needs the token registry: set VEIL_REGISTRY_URL')
    return request(token, `${config.registryUrl}${path}`, 'POST', body)
  }
  let userId = config.userId

  async function activeContracts(cumulative) {
    const end = await ledger('GET', '/v2/state/ledger-end')
    const entries = await ledger('POST', '/v2/state/active-contracts', {
      eventFormat: { filtersByParty: { [config.lender]: { cumulative } }, verbose: false },
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

  async function ledgerUser() {
    if (!userId) userId = tokenSubject(await token())
    if (!userId) throw new Error('ledger user id unknown: set VEIL_LEDGER_USER_ID')
    return userId
  }

  /** What the transaction must show, checked when reconciliation fetches it. */
  function expectedEffect(kind, template, loanCid) {
    if (kind === 'receipt') return { archive: null, createTemplate: 'Allocation' }
    return { archive: loanCid, createTemplate: kind === 'issueMarginCall' ? `^Veil:${template}$` : '^Veil:LoanClosed$' }
  }

  /**
   * Journaled submission. The journal entry (status pending, with the ledger
   * end captured just before) is durable before the command is sent; the
   * outcome is recorded after. Throws BlockedError when the journal forbids a
   * new attempt, SubmitError when it was rejected or its outcome is unknown.
   */
  async function submit(op, command, disclosedContracts = []) {
    const user = await ledgerUser()
    await token() // fail on credentials before anything is journaled
    const opKey = operationKey(op.kind, op.loanCid)
    const end = await ledger('GET', '/v2/state/ledger-end')
    const entry = journal.claim({
      opKey, kind: op.kind, loanCid: op.loanCid, template: op.template,
      commandId: commandId(op.kind, op.loanCid), submissionId: randomUUID(),
      offset: end.offset, actAs: [config.lender], expect: expectedEffect(op.kind, op.template, op.loanCid), approved: Boolean(op.approved),
    })
    let res
    try {
      res = await ledger('POST', '/v2/commands/submit-and-wait-for-transaction', {
        commands: {
          commands: [command],
          commandId: entry.commandId,
          submissionId: entry.submissionId,
          actAs: entry.actAs,
          userId: user,
          ...(disclosedContracts.length > 0
            ? { disclosedContracts: disclosedContracts.map(({ templateId, contractId, createdEventBlob, synchronizerId }) => ({ templateId, contractId, createdEventBlob, synchronizerId })) }
            : {}),
        },
      }, config.submitTimeoutMs)
    } catch (error) {
      const outcome = classifySubmitError(error)
      journal.record(opKey, entry.submissionId, outcome)
      throw new SubmitError(outcome, error)
    }
    const tx = res.transaction ?? {}
    const created = (tx.events ?? []).filter((e) => e.CreatedEvent).map((e) => ({ templateId: e.CreatedEvent.templateId, contractId: e.CreatedEvent.contractId }))
    journal.record(opKey, entry.submissionId, { status: 'completed', updateId: tx.updateId ?? '' })
    return { updateId: tx.updateId ?? '', created }
  }

  // --------------------------------------------------------- Reconciliation --

  /** Scan completions after the entry's saved offset for its commandId, within page and byte budgets. */
  async function findCompletion(entry) {
    const { pageSize, maxPages, maxBytes, idleMs } = config.reconcile
    const user = await ledgerUser()
    let begin = entry.offset
    let bytes = 0
    for (let page = 0; page < maxPages; page += 1) {
      const text = await requestText(token, `${config.ledgerUrl}/v2/commands/completions?limit=${pageSize}&stream_idle_timeout_ms=${idleMs}`, 'POST', {
        userId: user,
        parties: entry.actAs,
        beginExclusive: begin,
      })
      bytes += text.length
      const items = text ? JSON.parse(text) : []
      if (!Array.isArray(items)) throw new Error('completions response is not a list')
      let last = begin
      for (const item of items) {
        const response = item?.completionResponse ?? {}
        const completion = response.Completion?.value
        const offset = completion?.offset ?? response.OffsetCheckpoint?.value?.offset
        if (Number.isFinite(offset) && offset > last) last = offset
        if (completion?.commandId === entry.commandId && completion.userId === user
          && (!completion.submissionId || completion.submissionId === entry.submissionId)) return { completion }
      }
      if (items.length < pageSize) return { reason: `no completion after offset ${entry.offset} (scanned to ${last})` }
      if (bytes > maxBytes) return { reason: `scan byte budget exhausted at offset ${last}` }
      if (last === begin) return { reason: `scan made no progress at offset ${last}` }
      begin = last
    }
    return { reason: `scan page budget exhausted at offset ${begin}` }
  }

  /** Check the committed transaction shows the expected archive and create. */
  async function verifyEffect(entry, updateId) {
    const res = await ledger('POST', '/v2/updates/update-by-id', {
      updateId,
      updateFormat: {
        includeTransactions: {
          eventFormat: { filtersByParty: { [config.lender]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } }, verbose: false },
          transactionShape: 'TRANSACTION_SHAPE_ACS_DELTA',
        },
      },
    })
    const events = res?.update?.Transaction?.value?.events ?? []
    const archived = events.filter((e) => e.ArchivedEvent).map((e) => e.ArchivedEvent.contractId)
    const created = events.filter((e) => e.CreatedEvent).map((e) => templateSuffix(e.CreatedEvent.templateId))
    const { archive, createTemplate } = entry.expect ?? {}
    const archivedOk = !archive || archived.includes(archive)
    const createdOk = !createTemplate || created.some((t) => new RegExp(createTemplate).test(t))
    return archivedOk && createdOk
  }

  async function reconcile(at) {
    const nowMs = now()
    const open = journal.list().filter((e) => e.status === 'unknown'
      // a younger pending entry may still be in flight in this or another process
      || (e.status === 'pending' && Date.parse(e.submittedAt) + config.submitTimeoutMs < nowMs))
    for (const entry of open) {
      try {
        const found = await findCompletion(entry)
        if (!found.completion) {
          journal.markUnknown(entry.opKey, entry.submissionId, found.reason)
          emit({ event: 'indeterminate', at, level: 'warn', id: entry.id, opKey: entry.opKey, commandId: entry.commandId, reason: found.reason })
          continue
        }
        const c = found.completion
        if (c.status && c.status.code !== 0) {
          const outcome = completionRejection(c.status)
          journal.record(entry.opKey, entry.submissionId, { ...outcome, completionOffset: c.offset })
          emit({ event: 'reconciled', at, id: entry.id, opKey: entry.opKey, status: 'rejected', ...outcome.rejection })
          continue
        }
        let verified = null
        try {
          verified = await verifyEffect(entry, c.updateId)
        } catch (error) {
          emit({ event: 'verifyFailed', at, level: 'warn', id: entry.id, opKey: entry.opKey, error: message(error) })
        }
        journal.record(entry.opKey, entry.submissionId, { status: 'completed', updateId: c.updateId, completionOffset: c.offset, verified })
        emit({ event: 'reconciled', at, id: entry.id, opKey: entry.opKey, status: 'completed', updateId: c.updateId, verified, ...(verified === false ? { level: 'warn' } : {}) })
      } catch (error) {
        emit({ event: 'reconcileFailed', at, level: 'warn', id: entry.id, opKey: entry.opKey, error: message(error) })
      }
    }
  }

  const exercise = (template, contractId, choice, choiceArgument = {}) => ({ ExerciseCommand: { templateId: tpl(template), contractId, choice, choiceArgument } })

  // ---------------------------------------------------- Canton Coin (V2) --

  const coinAccount = (party) => ({ owner: party, provider: null, id: '' })
  const coinSettlement = (executors, id) => ({ executors, id, cid: null, meta: META })
  // Recorded on loans opened since 0.10.0 (lender and borrower jointly);
  // a 0.9.0 loan records none and its lock is executed by the lender alone.
  const coinExecutors = (a) => (Array.isArray(a.settlementExecutors) && a.settlementExecutors.length > 0 ? a.settlementExecutors : [a.lender])
  const sameParties = (x, y) => Array.isArray(x) && x.length === y.length && x.every((p, i) => p === y[i])

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
          && sameParties(v?.settlement?.executors, coinExecutors(a))
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
    const settlement = coinSettlement(coinExecutors(a), a.settlementRef)
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
      { kind: 'receipt', loanCid: loan.contractId, template: loan.template },
      exercise('CoinLoan', loan.contractId, 'PrepareCoinReceipt', {
        allocationFactoryCid: factory.factoryId,
        extraArgs: { context: factory.choiceContext.choiceContextData, meta: META },
      }),
      factory.choiceContext.disclosedContracts ?? [],
    )
    const receipt = prepared.created.find((c) => /Allocation/.test(templateSuffix(c.templateId)))
    if (!receipt) throw new Error('PrepareCoinReceipt created no allocation')
    emit({ event: 'receipt', loanCid: loan.contractId, receiptAllocationCid: receipt.contractId, reused: false, updateId: prepared.updateId })
    return receipt.contractId
  }

  async function liquidateCoin(loan, action, approved) {
    const a = loan.args
    for (const field of ['coinAdmin', 'borrower', 'settlementRef', 'collateralQuantity', 'maturity', 'allocationCid']) {
      if (!a[field]) throw new Error(`CoinLoan is missing ${field}`)
    }
    if (!config.registryUrl) throw new Error('Canton Coin liquidation needs the token registry: set VEIL_REGISTRY_URL')
    const receiptAllocationCid = await prepareReceipt(loan)
    const executors = coinExecutors(a)
    const settlement = coinSettlement(executors, a.settlementRef)
    const transferLegs = [{ transferLegId: 'collateral', sender: coinAccount(a.borrower), receiver: coinAccount(a.lender), amount: a.collateralQuantity, instrumentId: COIN_INSTRUMENT, meta: META }]
    const allocations = [a.allocationCid, receiptAllocationCid].map((allocationCid) => ({ allocationCid, extraTransferLegSides: [], nextIterationFunding: null }))
    const settle = await registry('/registry/allocation/v2/settlement-factory', {
      choiceArguments: { settlement, transferLegs, allocations, actors: executors, extraArgs: EMPTY_EXTRA },
      excludeDebugFields: true,
    })
    const extraArgs = { context: settle.choiceContext.choiceContextData, meta: META }
    const choiceArgument = action.kind === 'liquidate'
      ? { valuationCid: action.valuationCid, settlementFactoryCid: settle.factoryId, receiptAllocationCid, extraArgs }
      : { settlementFactoryCid: settle.factoryId, receiptAllocationCid, extraArgs }
    return submit(
      { kind: action.kind, loanCid: loan.contractId, template: loan.template, approved },
      exercise('CoinLoan', loan.contractId, action.choice, choiceArgument),
      settle.choiceContext.disclosedContracts ?? [],
    )
  }

  async function perform(loan, action, approved = false) {
    if (action.kind === 'closeLapsed') {
      // No registry call: the lapsed allocation is left for the borrower.
      return submit({ kind: action.kind, loanCid: loan.contractId, template: loan.template, approved }, exercise('CoinLoan', loan.contractId, action.choice))
    }
    if (loan.template === 'CoinLoan' && action.kind !== 'issueMarginCall') return liquidateCoin(loan, action, approved)
    // T-Bill LiquidateOverdue takes an Optional mark (0.9.0), the others a plain one.
    const choiceArgument = action.kind === 'liquidateOverdue' ? { valuationCid: action.valuationCid ?? null } : { valuationCid: action.valuationCid }
    return submit({ kind: action.kind, loanCid: loan.contractId, template: loan.template, approved }, exercise(loan.template, loan.contractId, action.choice, choiceArgument))
  }

  async function tick() {
    const mode = config.execute ? 'execute' : 'dry-run'
    const at = new Date(now()).toISOString()
    const summary = { decisions: 0, submitted: 0, benign: 0, errors: 0, proposed: 0, blocked: 0, unknown: 0 }
    // Settle earlier submissions before deciding anything new.
    if (config.execute) await reconcile(at)
    const { loans, marks, skipped } = await readState()
    for (const { loan, reason } of skipped) emit({ event: 'skip', at, template: loan.template, loanCid: loan.contractId, reason })
    if (config.execute) {
      for (const e of journal.voidProposals(new Set(loans.map((loan) => loan.contractId)))) {
        emit({ event: 'proposalVoided', at, level: 'warn', id: e.id, opKey: e.opKey, reason: 'loan contract no longer active' })
      }
    }
    const actions = decide(loans, marks, now(), { skewMs: config.skewMs, settlementWarnHours: config.settlementWarnHours })
    const byCid = new Map(loans.map((loan) => [loan.contractId, loan]))
    const decidedOps = new Set()
    for (const action of actions) {
      const executable = EXECUTABLE.has(action.kind)
      summary.decisions += executable ? 1 : 0
      const level = action.kind === 'warnSettlementDeadline' || action.kind === 'invalid' ? 'warn' : 'info'
      emit({ event: 'decision', at, mode, level, ...action })
      if (level === 'warn') process.stderr.write(`KEEPER WARNING ${action.template} ${action.loanCid}: ${action.reason}\n`)
      if (!executable || !config.execute) continue
      const opKey = operationKey(action.kind, action.loanCid)
      decidedOps.add(opKey)
      const entry = journal.get(opKey)
      let approved = false
      if (config.requireApproval > 0 && LIQUIDATIONS.has(action.kind)) {
        if (!entry || entry.status === 'retry') {
          const { entry: p } = journal.propose({ opKey, action, proposer: config.keeperId, required: config.requireApproval })
          summary.proposed += 1
          emit({ event: 'proposal', at, id: p.id, opKey, kind: action.kind, loanCid: action.loanCid, required: p.proposal.required })
          continue
        }
        if (entry.status === 'proposed') {
          const approvals = entry.proposal.decisions.filter((d) => d.decision === 'approve').length
          if (approvals < entry.proposal.required) {
            emit({ event: 'awaitingApproval', at, id: entry.id, opKey, approvals, required: entry.proposal.required })
            continue
          }
          // decide() just re-derived this liquidation from the live ACS: the preconditions hold now.
          approved = true
        }
      }
      if (!approved) {
        const gate = startable(entry, now())
        if (!gate.ok) {
          summary.blocked += 1
          emit({ event: 'blocked', at, level: entry.status === 'unknown' ? 'warn' : 'info', id: entry.id, opKey, status: entry.status, reason: gate.reason })
          continue
        }
      }
      try {
        const result = await perform(byCid.get(action.loanCid), action, approved)
        summary.submitted += 1
        emit({ event: 'submitted', at, kind: action.kind, loanCid: action.loanCid, updateId: result.updateId })
      } catch (error) {
        const cause = error instanceof SubmitError ? error.cause : error
        const outcome = error instanceof SubmitError ? error.outcome : null
        if (error instanceof BlockedError) {
          summary.blocked += 1
          emit({ event: 'blocked', at, kind: action.kind, loanCid: action.loanCid, reason: error.message })
        } else if (outcome?.status === 'unknown') {
          emit({ event: 'unknown', at, level: 'warn', kind: action.kind, loanCid: action.loanCid, reason: outcome.unknownReason })
        } else if (isBenign(cause)) {
          summary.benign += 1
          emit({ event: 'superseded', at, kind: action.kind, loanCid: action.loanCid, detail: message(cause) })
        } else {
          summary.errors += 1
          emit({ event: 'error', at, level: 'error', kind: action.kind, loanCid: action.loanCid, error: message(cause), ...(outcome ? { rejection: outcome.rejection } : {}) })
        }
      }
    }
    if (config.execute) {
      for (const e of journal.list()) {
        if (e.status === 'unknown' || e.status === 'pending') summary.unknown += 1
        // Quorum reached but the live ledger no longer supports this liquidation.
        if (e.status === 'proposed' && !decidedOps.has(e.opKey)
          && e.proposal.decisions.filter((d) => d.decision === 'approve').length >= e.proposal.required) {
          summary.blocked += 1
          emit({ event: 'executionRefused', at, level: 'warn', id: e.id, opKey: e.opKey, reason: 'approved, but the live ledger no longer supports this liquidation' })
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

/** --approve / --reject / --retry: journal-only operator commands. Throws JournalError when refused. */
export function runOperator(operator, journal) {
  const { op, target, by, remarks } = operator
  if (op === 'retry') {
    const entry = journal.retry(target, { by })
    return { event: 'retry', id: entry.id, opKey: entry.opKey, by }
  }
  const { entry, approvals } = journal.decide(target, { decision: op, by, remarks })
  return { event: 'decision', decision: op, id: entry.id, opKey: entry.opKey, by, approvals, required: entry.proposal.required, status: entry.status }
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
  if (config.operator) {
    try {
      defaultEmit(runOperator(config.operator, openJournal(config.stateDir)))
      return
    } catch (error) {
      if (!(error instanceof JournalError)) throw error
      process.stderr.write(`keeper: ${error.message}\n`)
      process.exit(1)
    }
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
      failed = summary.errors > 0 || summary.unknown > 0
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

