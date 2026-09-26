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
import { assertSession, captureSession, clearSession, requireOperator, requireSession, type AuthSnapshot } from './auth'
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
  'CoinLoanOffer',
  'CoinLoan',
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
  'CoinLoanOffer',
  'CoinLoan',
  'Amulet',
]

/** The asset offers are written against, and the eligible replacement the
 * borrower can substitute in while a loan is open. Each has its own jointly
 * authorized price stream. */
export const COLLATERAL_ASSET = 'Tokenized T-Bill'
export const SUBSTITUTE_ASSET = 'Tokenized MMF'
export const COLLATERAL_ASSETS = [COLLATERAL_ASSET, SUBSTITUTE_ASSET] as const
/** Real Canton Coin collateral, locked in a CIP-112 committed allocation. */
export const COIN_ASSET = 'Canton Coin'
/** Every asset the valuer prices, each on its own agreed stream. */
export const VALUED_ASSETS = [COLLATERAL_ASSET, SUBSTITUTE_ASSET, COIN_ASSET] as const
/** Seed mark per asset; Canton Coin is priced near its market level. */
const SEED_PRICE: Record<string, string> = { [COIN_ASSET]: '0.15' }

/** Canonical demo seed (kept in sync with scripts/bootstrap.sh). */
const SEED = { lenderCash: 10000, borrowerCash: 10500, borrowerCollateral: 15000, borrowerReserve: 5000, borrowerSubstitute: 16000 }

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
    // Only Canton Coin's own Amulet template counts as a coin holding.
    if (entity === 'Amulet' && !String(ce.templateId).includes(':Splice.Amulet:Amulet')) continue
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

async function submitAs(actAs: string[], command: unknown, prefix: string, snapshot = captureSession(), disclosedContracts?: DisclosedContract[]): Promise<TxResult> {
  const { userId } = requireSession(snapshot)
  const res = await api<any>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commands: [command],
      commandId: nextCommandId(prefix),
      actAs,
      userId,
      // The registry adds debug fields; the Ledger API needs only these four.
      ...(disclosedContracts && disclosedContracts.length > 0
        ? { disclosedContracts: disclosedContracts.map(({ templateId, contractId, createdEventBlob, synchronizerId }) => ({ templateId, contractId, createdEventBlob, synchronizerId })) }
        : {}),
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

/** A party's own wallet holdings (cash + collateral), derived from contracts. */
export function parseHoldings(contracts: Contract[]): Holding[] {
  const out: Holding[] = []
  for (const c of contracts) {
    if (c.template === 'CashHolding' && c.args.issuer === cfg.issuer)
      out.push({ contractId: c.contractId, kind: 'cash', amount: Number(c.args.amount), issuer: c.args.issuer })
    else if (c.template === 'CollateralHolding' && c.args.issuer === cfg.issuer)
      out.push({ contractId: c.contractId, kind: 'collateral', amount: Number(c.args.quantity), asset: c.args.asset, issuer: c.args.issuer })
    else if (c.template === 'Amulet') {
      // Holding fees decay the amount slowly; the initial amount is shown.
      const amount = (c.args as unknown as { amount?: { initialAmount?: string } }).amount?.initialAmount
      out.push({ contractId: c.contractId, kind: 'coin', amount: Number(amount), asset: COIN_ASSET })
    }
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
  if (draft.collateralAsset === COIN_ASSET) return createCoinOffer(draft, snapshot)
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
      liquidationThresholdLtv: String(draft.thresholdLtv),
      marginCallWindowSeconds: String(draft.marginCallWindowSeconds),
    }),
    'offer',
    snapshot,
  )
}

/** Borrower accepts, locking their collateral holding into the loan. */
export async function acceptOffer(offerCid: string, snapshot = captureSession()): Promise<TxResult> {
  const { contracts } = await listActive(cfg.parties.borrower, snapshot)
  const offer = contracts.find((c) => c.contractId === offerCid && (c.template === 'LoanOffer' || c.template === 'CoinLoanOffer'))
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
      && contract.args.collateralAsset === (offer.template === 'CoinLoanOffer' ? COIN_ASSET : offer.args.collateralAsset)
  )
  if (marks.length !== 1) {
    throw new Error(`Expected exactly one current valuation for the offer's agreed stream; found ${marks.length}. Refresh or publish the agreed stream mark before accepting.`)
  }
  if (offer.template === 'CoinLoanOffer') return acceptCoinOffer(offer, marks[0].contractId, snapshot)
  const collateralCid = await findCollateral(cfg.parties.borrower, offer.args.collateralAsset ?? COLLATERAL_ASSET, requestedQuantity, snapshot)
  return submit(
    cfg.parties.borrower,
    exercise(template('LoanOffer'), offerCid, 'Accept', { collateralCid, valuationCid: marks[0].contractId }),
    'accept',
    snapshot,
  )
}

const isCoin = (deal: Contract) => deal.template === 'CoinLoanOffer' || deal.template === 'CoinLoan'

export const withdrawOffer = (offer: Contract, snapshot = captureSession()) =>
  isCoin(offer)
    ? submit(cfg.parties.lender, exercise(template('CoinLoanOffer'), offer.contractId, 'WithdrawCoinOffer'), 'withdraw', snapshot)
    : submit(cfg.parties.lender, exercise(template('LoanOffer'), offer.contractId, 'Withdraw'), 'withdraw', snapshot)

/** Borrower repays from a cash holding covering the outstanding balance. */
export async function repayLoan(loan: Contract, repayment: number, snapshot = captureSession()): Promise<TxResult> {
  if (isCoin(loan)) return repayCoinLoan(loan, repayment, snapshot)
  const repaymentCid = await findCash(cfg.parties.borrower, repayment, snapshot)
  return submit(cfg.parties.borrower, exercise(template('Loan'), loan.contractId, 'Repay', { repaymentCid }), 'repay', snapshot)
}

/** Borrower pays part of the balance with an exact cash holding. Passing a
 * fresh mark during a margin call asks the ledger to cure it; without one the
 * payment only reduces the balance and the call stays open. */
export async function partialRepay(loan: Contract, amount: number, valuationCid: string | null, snapshot = captureSession()): Promise<TxResult> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.')
  const paymentCid = await findCash(cfg.parties.borrower, amount, snapshot)
  const [templateName, choice] = isCoin(loan) ? ['CoinLoan', 'PartialRepayCoin'] as const : ['Loan', 'PartialRepay'] as const
  return submit(cfg.parties.borrower, exercise(template(templateName), loan.contractId, choice, { paymentCid, valuationCid }), 'partial-repay', snapshot)
}

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

export const issueMarginCall = (loan: Contract, valuationCid: string, snapshot = captureSession()): Promise<TxResult> =>
  isCoin(loan)
    ? submit(cfg.parties.lender, exercise(template('CoinLoan'), loan.contractId, 'IssueCoinMarginCall', { valuationCid }), 'margin-call', snapshot)
    : submit(cfg.parties.lender, exercise(template('Loan'), loan.contractId, 'IssueMarginCall', { valuationCid }), 'margin-call', snapshot)

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

export const resolveMarginCall = (loan: Contract, valuationCid: string, snapshot = captureSession()): Promise<TxResult> =>
  isCoin(loan)
    ? submit(cfg.parties.borrower, exercise(template('CoinLoan'), loan.contractId, 'ResolveCoinMarginCall', { valuationCid }), 'resolve-call', snapshot)
    : submit(cfg.parties.borrower, exercise(template('Loan'), loan.contractId, 'ResolveMarginCall', { valuationCid }), 'resolve-call', snapshot)

/** Borrower escrows an exact quantity of the other eligible asset as a
 * replacement for the loan's locked collateral, naming that asset's agreed
 * price stream. A larger holding is split privately first; the lender sees
 * only the request, never the wallet. */
export async function proposeSubstitution(loan: Contract, asset: string, quantity: number, snapshot = captureSession()): Promise<TxResult> {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Replacement quantity must be greater than zero.')
  const mark = await findCurrentValuation(cfg.parties.borrower, asset, snapshot)
  const holdingCid = await findCollateral(cfg.parties.borrower, asset, quantity, snapshot)
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
export const liquidateLoan = (loan: Contract, valuationCid: string, snapshot = captureSession()): Promise<TxResult> =>
  isCoin(loan)
    ? liquidateCoinLoan(loan, valuationCid, snapshot)
    : submit(cfg.parties.lender, exercise(template('Loan'), loan.contractId, 'Liquidate', { valuationCid }), 'liquidate', snapshot)

/** Close a loan after its exact ledger maturity instant, without a price mark
 * or margin call. The Daml choice enforces now > maturity. */
export const liquidateOverdueLoan = (loan: Contract, snapshot = captureSession()): Promise<TxResult> =>
  isCoin(loan)
    ? liquidateCoinLoan(loan, null, snapshot)
    : submit(cfg.parties.lender, exercise(template('Loan'), loan.contractId, 'LiquidateOverdue'), 'liquidate-overdue', snapshot)

/* ------------------------------------------------ Canton Coin (CIP-112) -- */

interface DisclosedContract {
  templateId?: string
  contractId: string
  createdEventBlob: string
  synchronizerId?: string
}
interface ChoiceContext {
  choiceContextData: unknown
  disclosedContracts: DisclosedContract[]
}
interface FactoryWithContext {
  factoryId: string
  choiceContext: ChoiceContext
}

const META = { values: {} }
const EMPTY_EXTRA = { context: { values: {} }, meta: META }
const COIN_INSTRUMENT = 'Amulet'
const coinAccount = (party: string) => ({ owner: party, provider: null, id: '' })

/** Registry reads go through the server, which holds the node credential. */
async function registry<T>(path: string, body?: unknown, snapshot = captureSession()): Promise<T> {
  const res = await authorizedFetch(`/api/registry${path}`, body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, snapshot)
  const text = await res.text()
  assertSession(snapshot)
  if (!res.ok) throw new LedgerHttpError(`/api/registry${path}`, res.status, text)
  return JSON.parse(text) as T
}

let coinAdminCache: string | null = null
/** The Canton Coin admin (DSO) party, or null when no registry is configured. */
export async function coinAdmin(snapshot = captureSession()): Promise<string | null> {
  if (coinAdminCache) return coinAdminCache
  try {
    coinAdminCache = (await registry<{ adminId: string }>('/registry/metadata/v1/info', undefined, snapshot)).adminId
    return coinAdminCache
  } catch {
    return null
  }
}

function settlementDeadline(maturity: string): string {
  return new Date(Date.parse(maturity) + 86400e3).toISOString()
}

function coinSpec(admin: string, authorizer: string, committed: boolean, side: 'SenderSide' | 'ReceiverSide', otherside: string, quantity: string, maturity: string) {
  return {
    admin,
    authorizer: coinAccount(authorizer),
    transferLegSides: [{ transferLegId: 'collateral', side, otherside: coinAccount(otherside), amount: quantity, instrumentId: COIN_INSTRUMENT, meta: META }],
    settlementDeadline: settlementDeadline(maturity),
    nextIterationFunding: null,
    committed,
    meta: META,
  }
}

const coinSettlement = (lender: string, id: string) => ({ executors: [lender], id, cid: null, meta: META })

async function allocationFactory(settlement: unknown, allocation: unknown, inputHoldingCids: string[], actor: string, snapshot: AuthSnapshot): Promise<FactoryWithContext> {
  return registry<FactoryWithContext>('/registry/allocation-instruction/v2/allocation-factory', {
    choiceArguments: { settlement, allocation, requestedAt: new Date().toISOString(), inputHoldingCids, extraArgs: EMPTY_EXTRA, actors: [actor] },
    excludeDebugFields: true,
  }, snapshot)
}

async function cancelContext(allocationCid: string, snapshot: AuthSnapshot): Promise<ChoiceContext> {
  return registry<ChoiceContext>(`/registry/allocations/v2/${encodeURIComponent(allocationCid)}/choice-contexts/cancel`, { excludeDebugFields: true }, snapshot)
}

/** Lender funds an offer secured by real Canton Coin. */
async function createCoinOffer(draft: Draft, snapshot: AuthSnapshot): Promise<TxResult> {
  const admin = await coinAdmin(snapshot)
  if (!admin) throw new Error('Canton Coin collateral needs the DevNet token registry, which is not configured here.')
  const valuation = await findCurrentValuation(cfg.parties.lender, COIN_ASSET, snapshot)
  const cashCid = await findCash(cfg.parties.lender, draft.principal, snapshot)
  return submit(
    cfg.parties.lender,
    exercise(template('CashHolding'), cashCid, 'MakeCoinOffer', {
      borrower: cfg.parties.borrower,
      regulator: cfg.parties.regulator,
      valuationAgent: cfg.parties.valuer,
      valuationCid: valuation.contractId,
      coinAdmin: admin,
      principal: String(draft.principal),
      interest: String(draft.interest),
      collateralQuantity: String(draft.collateral),
      maturity: ledgerMaturity(draft.maturity),
      liquidationThresholdLtv: String(draft.thresholdLtv),
      marginCallWindowSeconds: String(draft.marginCallWindowSeconds),
      settlementRef: `veil-${Date.now()}`,
    }),
    'coin-offer',
    snapshot,
  )
}

/** Borrower accepts: in one transaction the Canton Coin is locked in a
 * committed allocation executed only by the lender, and the loan opens. */
async function acceptCoinOffer(offer: Contract, valuationCid: string, snapshot: AuthSnapshot): Promise<TxResult> {
  const a = offer.args
  if (!a.coinAdmin || !a.lender || !a.settlementRef || !a.collateralQuantity || !a.maturity) throw new Error('Canton Coin offer is incomplete; refresh before accepting.')
  const coins = parseHoldings((await listActive(cfg.parties.borrower, snapshot)).contracts).filter((h) => h.kind === 'coin')
  const available = coins.reduce((sum, h) => sum + h.amount, 0)
  if (available < Number(a.collateralQuantity)) throw new Error(`The borrower holds ${available.toFixed(2)} CC; ${a.collateralQuantity} CC must be locked.`)
  const settlement = coinSettlement(a.lender, a.settlementRef)
  const spec = coinSpec(a.coinAdmin, cfg.parties.borrower, true, 'SenderSide', a.lender, a.collateralQuantity, a.maturity)
  const inputHoldingCids = coins.map((h) => h.contractId)
  const factory = await allocationFactory(settlement, spec, inputHoldingCids, cfg.parties.borrower, snapshot)
  return submitAs(
    [cfg.parties.borrower],
    exercise(template('CoinLoanOffer'), offer.contractId, 'AcceptCoin', {
      valuationCid,
      allocationFactoryCid: factory.factoryId,
      inputHoldingCids,
      extraArgs: { context: factory.choiceContext.choiceContextData, meta: META },
    }),
    'accept-coin',
    snapshot,
    factory.choiceContext.disclosedContracts,
  )
}

/** Borrower settles the balance; the Canton Coin allocation is cancelled in
 * the same transaction and the coin unlocks. */
async function repayCoinLoan(loan: Contract, repayment: number, snapshot: AuthSnapshot): Promise<TxResult> {
  if (!loan.args.allocationCid) throw new Error('Loan has no recorded allocation.')
  const repaymentCid = await findCash(cfg.parties.borrower, repayment, snapshot)
  const ctx = await cancelContext(loan.args.allocationCid, snapshot)
  return submitAs(
    [cfg.parties.borrower],
    exercise(template('CoinLoan'), loan.contractId, 'RepayCoin', { repaymentCid, cancelExtraArgs: { context: ctx.choiceContextData, meta: META } }),
    'repay-coin',
    snapshot,
    ctx.disclosedContracts,
  )
}

/** Lender liquidates: prepare the receiving allocation, then settle the batch
 * so the locked Canton Coin moves to the lender. */
async function liquidateCoinLoan(loan: Contract, valuationCid: string | null, snapshot: AuthSnapshot): Promise<TxResult> {
  const a = loan.args
  if (!a.coinAdmin || !a.lender || !a.borrower || !a.settlementRef || !a.collateralQuantity || !a.maturity || !a.allocationCid) throw new Error('Loan is incomplete; refresh before liquidating.')
  const settlement = coinSettlement(a.lender, a.settlementRef)
  const receiptSpec = coinSpec(a.coinAdmin, a.lender, false, 'ReceiverSide', a.borrower, a.collateralQuantity, a.maturity)
  const factory = await allocationFactory(settlement, receiptSpec, [], a.lender, snapshot)
  const prepared = await submitAs(
    [cfg.parties.lender],
    exercise(template('CoinLoan'), loan.contractId, 'PrepareCoinReceipt', { allocationFactoryCid: factory.factoryId, extraArgs: { context: factory.choiceContext.choiceContextData, meta: META } }),
    'coin-receipt',
    snapshot,
    factory.choiceContext.disclosedContracts,
  )
  const receipt = prepared.created.find((c) => /Allocation/.test(c.template))
  if (!receipt) throw new Error('The receiving allocation was not created.')
  const legs = [{ transferLegId: 'collateral', sender: coinAccount(a.borrower), receiver: coinAccount(a.lender), amount: a.collateralQuantity, instrumentId: COIN_INSTRUMENT, meta: META }]
  const allocations = [a.allocationCid, receipt.contractId].map((allocationCid) => ({ allocationCid, extraTransferLegSides: [], nextIterationFunding: null }))
  const settle = await registry<FactoryWithContext>('/registry/allocation/v2/settlement-factory', {
    choiceArguments: { settlement, transferLegs: legs, allocations, actors: [a.lender], extraArgs: EMPTY_EXTRA },
    excludeDebugFields: true,
  }, snapshot)
  const extraArgs = { context: settle.choiceContext.choiceContextData, meta: META }
  const choice = valuationCid
    ? exercise(template('CoinLoan'), loan.contractId, 'LiquidateCoin', { valuationCid, settlementFactoryCid: settle.factoryId, receiptAllocationCid: receipt.contractId, extraArgs })
    : exercise(template('CoinLoan'), loan.contractId, 'LiquidateCoinOverdue', { settlementFactoryCid: settle.factoryId, receiptAllocationCid: receipt.contractId, extraArgs })
  return submitAs([cfg.parties.lender], choice, 'liquidate-coin', snapshot, settle.choiceContext.disclosedContracts)
}

/** Lender releases the Canton Coin and closes the loan (used by reset). */
async function writeOffCoinLoan(loan: Contract, snapshot: AuthSnapshot): Promise<TxResult> {
  if (!loan.args.allocationCid) throw new Error('Loan has no recorded allocation.')
  const ctx = await cancelContext(loan.args.allocationCid, snapshot)
  return submitAs(
    [cfg.parties.lender],
    exercise(template('CoinLoan'), loan.contractId, 'WriteOffCoin', { cancelExtraArgs: { context: ctx.choiceContextData, meta: META } }),
    'write-off-coin',
    snapshot,
    ctx.disclosedContracts,
  )
}

/** Seed demo wallets large enough for user-chosen terms: lender 10,000 cash;
 * borrower 10,500 cash, 15,000 + 5,000 T-Bill units and 16,000 MMF units. The
 * default offer (100 / 5 / 150) splits exact holdings out of these. */
export async function seedDemo(snapshot = captureSession()): Promise<void> {
  requireOperator(snapshot)
  for (const asset of VALUED_ASSETS) {
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
        { unitPrice: SEED_PRICE[asset] ?? '1' },
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
    if (c.template === 'LoanOffer' || c.template === 'CoinLoanOffer') await withdrawOffer(c, snapshot)
    // Never strand a borrower's Canton Coin: the lender releases it first.
    else if (c.template === 'CoinLoan') await writeOffCoinLoan(c, snapshot)
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
