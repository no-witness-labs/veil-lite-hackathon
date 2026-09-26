// Minimal client for the Canton JSON Ledger API v2.
//
// The npm @daml/ledger package targets the old v1 HTTP JSON API, so we talk to
// v2 directly with fetch. Every request carries the currently authenticated role
// token; the acting party is still named explicitly in each command.
//
// Runtime config (party ids plus the configured issuer) is fetched from
// /ledger-config.json, which
// scripts/bootstrap.sh writes into frontend/public. Keeping it out of the source
// import means `npm run build` succeeds on a clean checkout (CI / Vercel) before
// any sandbox has run; the app shows a clear "run start-sandbox" message instead.
import { assertSession, captureSession, clearSession, requireOperator, requireSession } from './auth'
import type { ActiveState, Contract, DealArgs, Draft, Holding, Role, TemplateName, TxResult } from './types'

interface LedgerConfig {
  jsonApiUrl: string
  packageRef: string
  issuer: string
  parties: Record<Role, string>
}

const DEFAULTS: LedgerConfig = {
  jsonApiUrl: 'http://127.0.0.1:6864',
  packageRef: '#veil-lite',
  issuer: '',
  parties: { lender: '', borrower: '', regulator: '', valuer: '', outsider: '' },
}

let cfg: LedgerConfig = DEFAULTS
let configIssue: string | null = null

const CONFIGURED_ROLES: Role[] = ['lender', 'borrower', 'regulator', 'valuer', 'outsider']
const ISSUER_SCOPED_TEMPLATES = new Set<TemplateName>([
  'LoanOffer',
  'Loan',
  'LoanClosed',
  'CashHolding',
  'CollateralHolding',
])

/** Load runtime config written by scripts/bootstrap.sh. Returns false when it
 * is missing, incomplete, or does not identify a distinct issuer. */
export async function loadConfig(): Promise<boolean> {
  try {
    const res = await fetch('/ledger-config.json', { cache: 'no-store' })
    if (!res.ok) {
      cfg = DEFAULTS
      const text = await res.text()
      let detail = ''
      try {
        const body = JSON.parse(text) as { cause?: unknown }
        if (typeof body.cause === 'string' && body.cause) detail = ` ${body.cause}`
      } catch {
        // Keep the status-only message when the endpoint did not return JSON.
      }
      configIssue = `Ledger configuration could not be loaded (HTTP ${res.status}).${detail}`
      return false
    }
    const loaded = await res.json()
    const parties = { ...DEFAULTS.parties, ...(loaded?.parties ?? {}) }
    for (const role of CONFIGURED_ROLES) {
      parties[role] = typeof parties[role] === 'string' ? parties[role].trim() : ''
    }
    const issuer = typeof loaded?.issuer === 'string' ? loaded.issuer.trim() : ''
    cfg = {
      ...DEFAULTS,
      ...loaded,
      issuer,
      parties,
    }
    const missing: string[] = CONFIGURED_ROLES.filter((role) => !cfg.parties[role])
    if (!cfg.issuer) missing.push('issuer')
    if (missing.length > 0) {
      configIssue = `Ledger configuration is incomplete. Missing ${missing.length === 1 ? 'party' : 'parties'}: ${missing.join(', ')}.`
      return false
    }
    const issuerCollision = CONFIGURED_ROLES.find((role) => cfg.parties[role] === cfg.issuer)
    if (issuerCollision) {
      configIssue = `Ledger configuration is invalid: issuer must be distinct from the ${issuerCollision} party.`
      return false
    }
    configIssue = null
    return true
  } catch (error) {
    cfg = DEFAULTS
    configIssue = `Ledger configuration could not be read: ${error instanceof Error ? error.message : String(error)}`
    return false
  }
}

export const getParties = (): Record<Role, string> => cfg.parties
export const getIssuer = (): string => cfg.issuer
export const getConfigIssue = (): string | null => configIssue

// The app always calls the same-origin Vercel/Vite /v2 proxy. The configured
// ledger URL is public metadata and is never used as a browser request target.
const base = () => ''
const template = (name: TemplateName) => `${cfg.packageRef}:Veil:${name}`

const KNOWN_TEMPLATES: TemplateName[] = [
  'LoanOffer',
  'Loan',
  'LoanClosed',
  'CashHolding',
  'CollateralHolding',
  'ValuationStream',
  'CollateralValuation',
  'SubstitutionRequest',
]

/** The asset offers are written against, and the eligible replacement the
 * borrower can substitute in while a loan is open. Each has its own jointly
 * authorized price stream. */
export const COLLATERAL_ASSET = 'Tokenized T-Bill'
export const SUBSTITUTE_ASSET = 'Tokenized MMF'
export const COLLATERAL_ASSETS = [COLLATERAL_ASSET, SUBSTITUTE_ASSET] as const

/** Canonical demo seed (kept in sync with scripts/bootstrap.sh). */
const SEED = { lenderCash: 100, borrowerCash: 105, borrowerCollateral: 150, borrowerReserve: 50, borrowerSubstitute: 160 }

let commandSeq = 0
function nextCommandId(prefix: string): string {
  commandSeq += 1
  return `veil-${prefix}-${Date.now()}-${commandSeq}`
}

class LedgerHttpError extends Error {
  readonly status: number

  constructor(path: string, status: number, detail: string) {
    super(`Ledger API ${path} failed (HTTP ${status}): ${detail}`)
    this.name = 'LedgerHttpError'
    this.status = status
  }
}

async function authorizedFetch(input: string, init: RequestInit = {}, snapshot = captureSession()): Promise<Response> {
  assertSession(snapshot)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${snapshot.token}`)
  let response: Response
  try {
    response = await fetch(input, { ...init, headers, signal: snapshot.signal })
  } catch (error) {
    assertSession(snapshot)
    throw error
  }
  return response
}

async function api<T>(path: string, body: unknown, snapshot = captureSession()): Promise<T> {
  const res = await authorizedFetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, snapshot)
  const text = await res.text()
  if (!res.ok) {
    if (res.status === 401) {
      assertSession(snapshot)
      clearSession()
      throw new LedgerHttpError(path, res.status, text)
    }
    assertSession(snapshot)
    // Surface the ledger error verbatim — no masking.
    throw new LedgerHttpError(path, res.status, text)
  }
  assertSession(snapshot)
  return (text ? JSON.parse(text) : {}) as T
}

async function ledgerEnd(snapshot = captureSession()): Promise<number> {
  const path = '/v2/state/ledger-end'
  const res = await authorizedFetch(`${base()}${path}`, {}, snapshot)
  const text = await res.text()
  if (!res.ok) {
    if (res.status === 401) {
      assertSession(snapshot)
      clearSession()
      throw new LedgerHttpError(path, res.status, text)
    }
    assertSession(snapshot)
    throw new LedgerHttpError(path, res.status, text)
  }
  assertSession(snapshot)
  return (JSON.parse(text) as { offset: number }).offset
}

function templateName(templateId: unknown): string {
  return String(templateId).split(':').pop() ?? '?'
}

/** Active contracts visible to `party`, normalized, plus the raw ledger JSON
 * (for the inspector). Outsider → empty. */
export async function listActive(party: string, snapshot = captureSession()): Promise<ActiveState> {
  assertSession(snapshot)
  const offset = await ledgerEnd(snapshot)
  const entries = await api<any[]>('/v2/state/active-contracts', {
    filter: {
      filtersByParty: {
        [party]: {
          cumulative: [
            { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
          ],
        },
      },
    },
    verbose: false,
    activeAtOffset: offset,
  }, snapshot)
  assertSession(snapshot)

  const contracts: Contract[] = []
  for (const entry of entries) {
    const ce = entry?.contractEntry?.JsActiveContract?.createdEvent
    if (!ce) continue
    const entity = templateName(ce.templateId) as TemplateName
    if (!KNOWN_TEMPLATES.includes(entity)) continue
    // Keep the raw ACS response intact for the inspector, but never surface
    // holdings or deal contracts issued by another configured issuer as
    // normalized application state.
    if (ISSUER_SCOPED_TEMPLATES.has(entity) && ce.createArgument?.issuer !== cfg.issuer) continue
    contracts.push({
      contractId: ce.contractId,
      template: entity,
      offset: ce.offset ?? 0,
      args: ce.createArgument as DealArgs,
    })
  }
  return { contracts, raw: entries, offset }
}

async function submit(actAs: string, command: unknown, prefix: string, snapshot = captureSession()): Promise<TxResult> {
  return submitAs([actAs], command, prefix, snapshot)
}

async function submitAs(actAs: string[], command: unknown, prefix: string, snapshot = captureSession()): Promise<TxResult> {
  const { userId } = requireSession(snapshot)
  const res = await api<any>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commands: [command],
      commandId: nextCommandId(prefix),
      actAs,
      userId,
    },
  }, snapshot)
  const tx = res.transaction ?? {}
  const created: TxResult['created'] = []
  const archived: TxResult['archived'] = []
  for (const ev of tx.events ?? []) {
    if (ev.CreatedEvent)
      created.push({ template: templateName(ev.CreatedEvent.templateId), contractId: ev.CreatedEvent.contractId })
    if (ev.ArchivedEvent)
      archived.push({ template: templateName(ev.ArchivedEvent.templateId), contractId: ev.ArchivedEvent.contractId })
  }
  return { updateId: tx.updateId ?? '', offset: tx.offset ?? 0, synchronizerId: tx.synchronizerId ?? '', created, archived }
}

function create(templateId: string, createArguments: Record<string, unknown>) {
  return { CreateCommand: { templateId, createArguments } }
}

function createAndExercise(
  templateId: string,
  createArguments: Record<string, unknown>,
  choice: string,
  choiceArgument: Record<string, unknown> = {},
) {
  return { CreateAndExerciseCommand: { templateId, createArguments, choice, choiceArgument } }
}

function exercise(templateId: string, contractId: string, choice: string, choiceArgument: Record<string, unknown> = {}) {
  return { ExerciseCommand: { templateId, contractId, choice, choiceArgument } }
}

/** LTV threshold (%) above which the on-ledger Liquidate choice is permitted. */
export const LIQUIDATION_THRESHOLD_LTV = 90

/** A party's own wallet holdings (cash + collateral), derived from contracts. */
export function parseHoldings(contracts: Contract[]): Holding[] {
  const out: Holding[] = []
  for (const c of contracts) {
    if (c.template === 'CashHolding' && c.args.issuer === cfg.issuer)
      out.push({ contractId: c.contractId, kind: 'cash', amount: Number(c.args.amount), issuer: c.args.issuer })
    else if (c.template === 'CollateralHolding' && c.args.issuer === cfg.issuer)
      out.push({ contractId: c.contractId, kind: 'collateral', amount: Number(c.args.quantity), asset: c.args.asset, issuer: c.args.issuer })
  }
  return out
}

async function findCash(party: string, minAmount: number, snapshot = captureSession()): Promise<string> {
  const { contracts } = await listActive(party, snapshot)
  const h = parseHoldings(contracts)
    .filter((x) => x.kind === 'cash' && x.amount >= minAmount)
    .sort((a, b) => a.amount - b.amount)[0]
  if (!h) throw new Error(`No cash holding ≥ ${minAmount} available — ask the demo operator to reset holdings.`)
  if (h.amount > minAmount) {
    await submit(
      party,
      exercise(template('CashHolding'), h.contractId, 'Split', { splitAmount: String(minAmount) }),
      'split-cash',
      snapshot,
    )
    const exact = parseHoldings((await listActive(party, snapshot)).contracts).find(
      (candidate) => candidate.kind === 'cash' && candidate.amount === minAmount,
    )
    if (!exact) throw new Error(`Cash split committed, but no ${minAmount} unit holding was returned.`)
    return exact.contractId
  }
  return h.contractId
}

/** Find an exact quantity. When a wallet has a larger bearer holding, split it
 * first so the spend remains explicit and no action consumes a user's entire
 * reserve by accident. */
async function findCollateral(party: string, asset: string, quantity?: number, snapshot = captureSession()): Promise<string> {
  const { contracts } = await listActive(party, snapshot)
  const collateral = parseHoldings(contracts).filter((x) => x.kind === 'collateral' && x.asset === asset)
  const h = quantity === undefined
    ? collateral[0]
    : collateral.find((x) => x.amount === quantity) ?? collateral.find((x) => x.amount > quantity)
  if (!h) {
    const requested = quantity === undefined ? '' : ` of exactly ${quantity} units`
    throw new Error(`No ${asset} collateral holding${requested} available — ask the demo operator to reset holdings.`)
  }
  if (quantity !== undefined && h.amount !== quantity) {
    const split = await submit(
      party,
      exercise(template('CollateralHolding'), h.contractId, 'SplitCollateral', { splitQuantity: String(quantity) }),
      'split-collateral',
      snapshot,
    )
    // Splitting is a separate transaction. Re-read the party's view and use
    // the exact output, which keeps subsequent choices deterministic.
    void split
    const refreshed = parseHoldings((await listActive(party, snapshot)).contracts).find(
      (candidate) => candidate.kind === 'collateral' && candidate.asset === asset && candidate.amount === quantity,
    )
    if (!refreshed) throw new Error(`Collateral split committed, but no ${quantity} unit holding was returned.`)
    return refreshed.contractId
  }
  return h.contractId
}

/** Return the one active mark for the configured deal. A stream publishes by
 * replacement, so accepting multiple matching marks would hide a broken
 * stream or stale parallel branch from the user. */
async function findCurrentValuation(party: string, asset: string, snapshot = captureSession()): Promise<Contract> {
  const { contracts } = await listActive(party, snapshot)
  const marks = contracts.filter((contract) =>
    contract.template === 'CollateralValuation'
      && contract.args.valuationAgent === cfg.parties.valuer
      && contract.args.lender === cfg.parties.lender
      && contract.args.borrower === cfg.parties.borrower
      && contract.args.regulator === cfg.parties.regulator
      && contract.args.collateralAsset === asset
      && typeof contract.args.streamId === 'string'
  )
  if (marks.length !== 1) {
    throw new Error(`Expected exactly one active ${asset} valuation mark for the configured stream; found ${marks.length}. Publish or reset the demo first.`)
  }
  return marks[0]
}

function ledgerMaturity(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return `${value}T00:00:00.000Z`
}

/** Lender funds + creates the offer from a cash holding (MakeOffer). */
export async function createOffer(draft: Draft, snapshot = captureSession()): Promise<TxResult> {
  const valuation = await findCurrentValuation(cfg.parties.lender, COLLATERAL_ASSET, snapshot)
  const cashCid = await findCash(cfg.parties.lender, draft.principal, snapshot)
  return submit(
    cfg.parties.lender,
    exercise(template('CashHolding'), cashCid, 'MakeOffer', {
      borrower: cfg.parties.borrower,
      regulator: cfg.parties.regulator,
      valuationAgent: cfg.parties.valuer,
      valuationCid: valuation.contractId,
      principal: String(draft.principal),
      interest: String(draft.interest),
      collateralAsset: COLLATERAL_ASSET,
      collateralQuantity: String(draft.collateral),
      maturity: ledgerMaturity(draft.maturity),
      liquidationThresholdLtv: String(LIQUIDATION_THRESHOLD_LTV),
      marginCallWindowSeconds: String(MARGIN_CALL_WINDOW_SECONDS),
    }),
    'offer',
    snapshot,
  )
}

/** Borrower accepts, locking their collateral holding into the loan. */
export async function acceptOffer(offerCid: string, snapshot = captureSession()): Promise<TxResult> {
  const { contracts } = await listActive(cfg.parties.borrower, snapshot)
  const offer = contracts.find((c) => c.contractId === offerCid && c.template === 'LoanOffer')
  if (!offer) throw new Error('Offer is not visible to the borrower or is no longer active; refresh before accepting.')
  if (offer.args.issuer !== cfg.issuer) {
    throw new Error('Refusing to accept an offer issued by a different issuer; refresh the configured issuer view.')
  }
  const requestedQuantity = Number(offer?.args.collateralQuantity)
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error('Offer collateral quantity is missing or invalid; refresh the lender offer before accepting.')
  }
  const streamId = offer.args.valuationStreamId
  if (typeof streamId !== 'string') {
    throw new Error('Offer has no agreed valuation stream; refresh the lender offer before accepting.')
  }
  const marks = contracts.filter((contract) =>
    contract.template === 'CollateralValuation'
      && contract.args.streamId === streamId
      && contract.args.valuationAgent === offer.args.valuationAgent
      && contract.args.lender === offer.args.lender
      && contract.args.borrower === offer.args.borrower
      && contract.args.regulator === offer.args.regulator
      && contract.args.collateralAsset === offer.args.collateralAsset
  )
  if (marks.length !== 1) {
    throw new Error(`Expected exactly one current valuation for the offer's agreed stream; found ${marks.length}. Refresh or publish the agreed stream mark before accepting.`)
  }
  const collateralCid = await findCollateral(cfg.parties.borrower, offer.args.collateralAsset ?? COLLATERAL_ASSET, requestedQuantity, snapshot)
  return submit(
    cfg.parties.borrower,
    exercise(template('LoanOffer'), offerCid, 'Accept', { collateralCid, valuationCid: marks[0].contractId }),
    'accept',
    snapshot,
  )
}

export const withdrawOffer = (cid: string, snapshot = captureSession()) =>
  submit(cfg.parties.lender, exercise(template('LoanOffer'), cid, 'Withdraw'), 'withdraw', snapshot)

/** Borrower repays from a cash holding covering principal + interest. */
export async function repayLoan(loanCid: string, repayment: number, snapshot = captureSession()): Promise<TxResult> {
  const repaymentCid = await findCash(cfg.parties.borrower, repayment, snapshot)
  return submit(cfg.parties.borrower, exercise(template('Loan'), loanCid, 'Repay', { repaymentCid }), 'repay', snapshot)
}

/** Borrower pays part of the balance with an exact cash holding. During a
 * margin call the ledger requires a fresh mark proving the payment cures it. */
export async function partialRepay(loanCid: string, amount: number, valuationCid: string | null, snapshot = captureSession()): Promise<TxResult> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.')
  const paymentCid = await findCash(cfg.parties.borrower, amount, snapshot)
  return submit(cfg.parties.borrower, exercise(template('Loan'), loanCid, 'PartialRepay', { paymentCid, valuationCid }), 'partial-repay', snapshot)
}

export const MARGIN_CALL_WINDOW_SECONDS = 60

/** Replace the current mark on the configured stream. This is manually
 * attested demo data, not an oracle claim; the UI never creates a parallel
 * valuation contract or chooses an arbitrary latest stream. */
export async function publishValuation(unitPrice: number, asset: string, snapshot = captureSession()): Promise<TxResult> {
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Valuation price must be greater than zero.')
  const { contracts } = await listActive(cfg.parties.valuer, snapshot)
  const marks = contracts.filter((contract) =>
    contract.template === 'CollateralValuation'
      && contract.contractId
      && contract.args.valuationAgent === cfg.parties.valuer
      && contract.args.lender === cfg.parties.lender
      && contract.args.borrower === cfg.parties.borrower
      && contract.args.regulator === cfg.parties.regulator
      && contract.args.collateralAsset === asset
      && typeof contract.args.streamId === 'string'
  )
  if (marks.length !== 1) {
    throw new Error(`Expected exactly one active ${asset} mark on its configured valuation stream; found ${marks.length}. Reset the demo to restore the stream lineage.`)
  }
  return submit(
    cfg.parties.valuer,
    exercise(template('CollateralValuation'), marks[0].contractId, 'Publish', { unitPrice: String(unitPrice) }),
    'valuation',
    snapshot,
  )
}

export const issueMarginCall = (loanCid: string, valuationCid: string, snapshot = captureSession()): Promise<TxResult> =>
  submit(cfg.parties.lender, exercise(template('Loan'), loanCid, 'IssueMarginCall', { valuationCid }), 'margin-call', snapshot)

export async function topUpCollateral(loanCid: string, asset: string, topUpQuantity: number, valuationCid: string, snapshot = captureSession()): Promise<TxResult> {
  if (!Number.isFinite(topUpQuantity) || topUpQuantity <= 0) throw new Error('Top-up quantity must be greater than zero.')
  const collateralCid = await findCollateral(cfg.parties.borrower, asset, topUpQuantity, snapshot)
  return submit(
    cfg.parties.borrower,
    exercise(template('Loan'), loanCid, 'TopUpCollateral', {
      collateralCid,
      topUpQuantity: String(topUpQuantity),
      valuationCid,
    }),
    'top-up',
    snapshot,
  )
}

export const resolveMarginCall = (loanCid: string, valuationCid: string, snapshot = captureSession()): Promise<TxResult> =>
  submit(cfg.parties.borrower, exercise(template('Loan'), loanCid, 'ResolveMarginCall', { valuationCid }), 'resolve-call', snapshot)

/** Borrower escrows one whole holding of the other eligible asset as a
 * replacement for the loan's locked collateral, naming that asset's agreed
 * price stream. The lender sees only the request, never the wallet. */
export async function proposeSubstitution(loan: Contract, holdingCid: string, snapshot = captureSession()): Promise<TxResult> {
  const { contracts } = await listActive(cfg.parties.borrower, snapshot)
  const holding = parseHoldings(contracts).find((h) => h.contractId === holdingCid && h.kind === 'collateral')
  if (!holding?.asset) throw new Error('Replacement holding is no longer available; refresh before proposing.')
  const mark = await findCurrentValuation(cfg.parties.borrower, holding.asset, snapshot)
  return submit(
    cfg.parties.borrower,
    exercise(template('CollateralHolding'), holdingCid, 'ProposeSubstitution', {
      lender: loan.args.lender,
      regulator: loan.args.regulator,
      valuationAgent: loan.args.valuationAgent,
      releaseAsset: loan.args.collateralAsset,
      releaseQuantity: loan.args.collateralQuantity,
      newValuationStreamId: mark.args.streamId,
    }),
    'propose-substitution',
    snapshot,
  )
}

/** Lender approves: Canton re-checks coverage on a fresh mark of the new asset
 * and swaps the collateral atomically. */
export const applySubstitution = (loanCid: string, requestCid: string, newValuationCid: string, snapshot = captureSession()): Promise<TxResult> =>
  submit(cfg.parties.lender, exercise(template('Loan'), loanCid, 'ApplySubstitution', { requestCid, newValuationCid }), 'apply-substitution', snapshot)

export const rejectSubstitution = (requestCid: string, snapshot = captureSession()): Promise<TxResult> =>
  submit(cfg.parties.lender, exercise(template('SubstitutionRequest'), requestCid, 'RejectSubstitution'), 'reject-substitution', snapshot)

export const cancelSubstitution = (requestCid: string, snapshot = captureSession()): Promise<TxResult> =>
  submit(cfg.parties.borrower, exercise(template('SubstitutionRequest'), requestCid, 'CancelSubstitution'), 'cancel-substitution', snapshot)

/** Liquidation uses only a ledger valuation CID. The lender never supplies a
 * private mark directly; freshness, deadline, counterparties, and LTV are
 * checked by the Loan choice. */
export const liquidateLoan = (cid: string, valuationCid: string, snapshot = captureSession()): Promise<TxResult> =>
  submit(cfg.parties.lender, exercise(template('Loan'), cid, 'Liquidate', { valuationCid }), 'liquidate', snapshot)

/** Close a loan after its exact ledger maturity instant, without a price mark
 * or margin call. The Daml choice enforces now > maturity. */
export const liquidateOverdueLoan = (cid: string, snapshot = captureSession()): Promise<TxResult> =>
  submit(cfg.parties.lender, exercise(template('Loan'), cid, 'LiquidateOverdue'), 'liquidate-overdue', snapshot)

/** Seed the canonical demo holdings: lender 100 cash, borrower 105 cash plus
 * the locked-offer quantity (150) and a separate 50-unit top-up reserve. */
export async function seedDemo(snapshot = captureSession()): Promise<void> {
  requireOperator(snapshot)
  for (const asset of COLLATERAL_ASSETS) {
    await submitAs(
      [cfg.parties.lender, cfg.parties.borrower, cfg.parties.valuer],
      createAndExercise(
        template('ValuationStream'),
        {
          valuationAgent: cfg.parties.valuer,
          lender: cfg.parties.lender,
          borrower: cfg.parties.borrower,
          regulator: cfg.parties.regulator,
          collateralAsset: asset,
        },
        'PublishInitial',
        { unitPrice: '1' },
      ),
      'seed-valuation',
      snapshot,
    )
  }
  await submitAs([cfg.issuer, cfg.parties.lender], create(template('CashHolding'), { issuer: cfg.issuer, owner: cfg.parties.lender, amount: String(SEED.lenderCash) }), 'seed', snapshot)
  await submitAs([cfg.issuer, cfg.parties.borrower], create(template('CashHolding'), { issuer: cfg.issuer, owner: cfg.parties.borrower, amount: String(SEED.borrowerCash) }), 'seed', snapshot)
  await submitAs([cfg.issuer, cfg.parties.borrower], create(template('CollateralHolding'), { issuer: cfg.issuer, owner: cfg.parties.borrower, asset: COLLATERAL_ASSET, quantity: String(SEED.borrowerCollateral) }), 'seed', snapshot)
  await submitAs([cfg.issuer, cfg.parties.borrower], create(template('CollateralHolding'), { issuer: cfg.issuer, owner: cfg.parties.borrower, asset: COLLATERAL_ASSET, quantity: String(SEED.borrowerReserve) }), 'seed', snapshot)
  await submitAs([cfg.issuer, cfg.parties.borrower], create(template('CollateralHolding'), { issuer: cfg.issuer, owner: cfg.parties.borrower, asset: SUBSTITUTE_ASSET, quantity: String(SEED.borrowerSubstitute) }), 'seed', snapshot)
}

async function submitReset(actAs: string[], command: unknown, prefix: string, snapshot = captureSession()): Promise<TxResult> {
  const { userId } = requireOperator(snapshot)
  const res = await api<any>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commands: [command],
      commandId: nextCommandId(`reset-${prefix}`),
      actAs,
      userId,
    },
  }, snapshot)
  const tx = res.transaction ?? {}
  const created: TxResult['created'] = []
  const archived: TxResult['archived'] = []
  for (const ev of tx.events ?? []) {
    if (ev.CreatedEvent)
      created.push({ template: templateName(ev.CreatedEvent.templateId), contractId: ev.CreatedEvent.contractId })
    if (ev.ArchivedEvent)
      archived.push({ template: templateName(ev.ArchivedEvent.templateId), contractId: ev.ArchivedEvent.contractId })
  }
  return { updateId: tx.updateId ?? '', offset: tx.offset ?? 0, synchronizerId: tx.synchronizerId ?? '', created, archived }
}

/** Clear the ledger and re-seed canonical holdings so the demo can be re-run.
 * Reset is an explicit cooperative demo cleanup. It archives active loans with
 * issuer, lender, and borrower rather than bypassing the margin-call deadline/Liquidate
 * choice, then burns known holdings and valuation records before seeding. */
export async function resetDemo(snapshot = captureSession()): Promise<void> {
  requireOperator(snapshot)
  let { contracts } = await listActive(cfg.parties.lender, snapshot)
  for (const c of contracts) {
    if (c.template === 'LoanOffer') await withdrawOffer(c.contractId, snapshot)
    else if (c.template === 'Loan') {
      await submitReset(
        [cfg.issuer, cfg.parties.lender, cfg.parties.borrower],
        exercise(template('Loan'), c.contractId, 'Archive'),
        'archive-loan',
        snapshot,
      )
    }
  }
  ;({ contracts } = await listActive(cfg.parties.lender, snapshot))
  for (const c of contracts) {
    if (c.template === 'SubstitutionRequest')
      await submitReset([cfg.issuer, cfg.parties.borrower], exercise(template('SubstitutionRequest'), c.contractId, 'Archive'), 'archive-substitution', snapshot)
    else if (c.template === 'LoanClosed')
      await submitReset(
        [cfg.issuer, cfg.parties.lender, cfg.parties.borrower],
        exercise(template('LoanClosed'), c.contractId, 'Dismiss'),
        'dismiss',
        snapshot,
      )
  }
  // Price and stream records have multiple signatories. Reset is an explicit
  // cooperative demo cleanup, so archive both templates with all authorized
  // parties before recreating one stream and its initial mark.
  const { contracts: valuations } = await listActive(cfg.parties.valuer, snapshot)
  const cleanupActors = [cfg.parties.lender, cfg.parties.borrower, cfg.parties.valuer]
  for (const c of valuations) {
    if (c.template === 'CollateralValuation') {
      await submitAs(cleanupActors, exercise(template('CollateralValuation'), c.contractId, 'Archive'), 'burn-valuation', snapshot)
    }
  }
  for (const c of valuations) {
    if (c.template === 'ValuationStream') {
      await submitAs(cleanupActors, exercise(template('ValuationStream'), c.contractId, 'Archive'), 'burn-valuation-stream', snapshot)
    }
  }
  // Burn each trusted holding with issuer and owner authority before reseeding.
  for (const party of [cfg.parties.lender, cfg.parties.borrower]) {
    const { contracts: held } = await listActive(party, snapshot)
    for (const c of held) {
      if (c.template === 'CashHolding' || c.template === 'CollateralHolding')
        await submitAs([cfg.issuer, party], exercise(template(c.template), c.contractId, 'Archive'), 'burn', snapshot)
    }
  }
  await seedDemo(snapshot)
}
