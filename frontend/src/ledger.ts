// Minimal client for the Canton JSON Ledger API v2.
//
// The npm @daml/ledger package targets the old v1 HTTP JSON API, so we talk to
// v2 directly with fetch. The sandbox runs with auth disabled, so requests carry
// no bearer token — the acting party is named explicitly in each command.
//
// Runtime config (party ids) is fetched from /ledger-config.json, which
// scripts/bootstrap.sh writes into frontend/public. Keeping it out of the source
// import means `npm run build` succeeds on a clean checkout (CI / Vercel) before
// any sandbox has run; the app shows a clear "run start-sandbox" message instead.
import type { ActiveState, Contract, DealArgs, Draft, Holding, Role, TemplateName, TxResult } from './types'

interface LedgerConfig {
  jsonApiUrl: string
  packageRef: string
  userId: string
  parties: Record<Role, string>
}

const DEFAULTS: LedgerConfig = {
  jsonApiUrl: 'http://127.0.0.1:6864',
  packageRef: '#veil-lite',
  userId: 'veil',
  parties: { lender: '', borrower: '', regulator: '', valuer: '', outsider: '' },
}

let cfg: LedgerConfig = DEFAULTS

/** Load runtime config written by scripts/bootstrap.sh. Returns false when it's
 * missing or has no parties yet (i.e. the sandbox hasn't been bootstrapped). */
export async function loadConfig(): Promise<boolean> {
  try {
    const res = await fetch('/ledger-config.json', { cache: 'no-store' })
    if (!res.ok) return false
    const loaded = await res.json()
    cfg = {
      ...DEFAULTS,
      ...loaded,
      parties: { ...DEFAULTS.parties, ...(loaded.parties ?? {}) },
    }
    return Boolean(cfg.parties.lender)
  } catch {
    return false
  }
}

export const getParties = (): Record<Role, string> => cfg.parties

// In dev, call same-origin ("/v2/...") so the Vite proxy forwards to the sandbox
// (the JSON API sends no CORS headers). In a production build, use the configured URL.
const base = () => (import.meta.env.DEV ? '' : cfg.jsonApiUrl)
const template = (name: TemplateName) => `${cfg.packageRef}:Veil:${name}`

const KNOWN_TEMPLATES: TemplateName[] = [
  'LoanOffer',
  'Loan',
  'LoanClosed',
  'CashHolding',
  'CollateralHolding',
  'ValuationStream',
  'CollateralValuation',
]

export const COLLATERAL_ASSET = 'Tokenized T-Bill / MMF'

/** Canonical demo seed (kept in sync with scripts/bootstrap.sh). */
const SEED = { lenderCash: 100, borrowerCash: 105, borrowerCollateral: 150, borrowerReserve: 50 }

let commandSeq = 0
function nextCommandId(prefix: string): string {
  commandSeq += 1
  return `veil-${prefix}-${Date.now()}-${commandSeq}`
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    // Surface the ledger error verbatim — no masking.
    throw new Error(`Ledger API ${path} failed (HTTP ${res.status}): ${text}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

async function ledgerEnd(): Promise<number> {
  const res = await fetch(`${base()}/v2/state/ledger-end`)
  if (!res.ok) throw new Error(`Failed to read ledger end (HTTP ${res.status})`)
  return (await res.json()).offset as number
}

function templateName(templateId: unknown): string {
  return String(templateId).split(':').pop() ?? '?'
}

/** Active contracts visible to `party`, normalized, plus the raw ledger JSON
 * (for the inspector). Outsider → empty. */
export async function listActive(party: string): Promise<ActiveState> {
  const offset = await ledgerEnd()
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
  })

  const contracts: Contract[] = []
  for (const entry of entries) {
    const ce = entry?.contractEntry?.JsActiveContract?.createdEvent
    if (!ce) continue
    const entity = templateName(ce.templateId) as TemplateName
    if (!KNOWN_TEMPLATES.includes(entity)) continue
    contracts.push({
      contractId: ce.contractId,
      template: entity,
      offset: ce.offset ?? 0,
      args: ce.createArgument as DealArgs,
    })
  }
  return { contracts, raw: entries, offset }
}

async function submit(actAs: string, command: unknown, prefix: string): Promise<TxResult> {
  return submitAs([actAs], command, prefix)
}

async function submitAs(actAs: string[], command: unknown, prefix: string): Promise<TxResult> {
  const res = await api<any>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commands: [command],
      commandId: nextCommandId(prefix),
      actAs,
      userId: cfg.userId,
    },
  })
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
    if (c.template === 'CashHolding')
      out.push({ contractId: c.contractId, kind: 'cash', amount: Number(c.args.amount) })
    else if (c.template === 'CollateralHolding')
      out.push({ contractId: c.contractId, kind: 'collateral', amount: Number(c.args.quantity), asset: c.args.asset })
  }
  return out
}

async function findCash(party: string, minAmount: number): Promise<string> {
  const { contracts } = await listActive(party)
  const h = parseHoldings(contracts)
    .filter((x) => x.kind === 'cash' && x.amount >= minAmount)
    .sort((a, b) => a.amount - b.amount)[0]
  if (!h) throw new Error(`No cash holding ≥ ${minAmount} available — use "Reset demo" to re-seed holdings.`)
  if (h.amount > minAmount) {
    await submit(
      party,
      exercise(template('CashHolding'), h.contractId, 'Split', { splitAmount: String(minAmount) }),
      'split-cash',
    )
    const exact = parseHoldings((await listActive(party)).contracts).find(
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
async function findCollateral(party: string, asset: string, quantity?: number): Promise<string> {
  const { contracts } = await listActive(party)
  const collateral = parseHoldings(contracts).filter((x) => x.kind === 'collateral' && x.asset === asset)
  const h = quantity === undefined
    ? collateral[0]
    : collateral.find((x) => x.amount === quantity) ?? collateral.find((x) => x.amount > quantity)
  if (!h) {
    const requested = quantity === undefined ? '' : ` of exactly ${quantity} units`
    throw new Error(`No ${asset} collateral holding${requested} available — use "Reset demo" to re-seed holdings.`)
  }
  if (quantity !== undefined && h.amount !== quantity) {
    const split = await submit(
      party,
      exercise(template('CollateralHolding'), h.contractId, 'SplitCollateral', { splitQuantity: String(quantity) }),
      'split-collateral',
    )
    // Splitting is a separate transaction. Re-read the party's view and use
    // the exact output, which keeps subsequent choices deterministic.
    void split
    const refreshed = parseHoldings((await listActive(party)).contracts).find(
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
async function findCurrentValuation(party: string): Promise<Contract> {
  const { contracts } = await listActive(party)
  const marks = contracts.filter((contract) =>
    contract.template === 'CollateralValuation'
      && contract.args.valuationAgent === cfg.parties.valuer
      && contract.args.lender === cfg.parties.lender
      && contract.args.borrower === cfg.parties.borrower
      && contract.args.regulator === cfg.parties.regulator
      && contract.args.collateralAsset === COLLATERAL_ASSET
      && typeof contract.args.streamId === 'string'
  )
  if (marks.length !== 1) {
    throw new Error(`Expected exactly one active valuation mark for the configured stream; found ${marks.length}. Publish or reset the demo before creating an offer.`)
  }
  return marks[0]
}

function ledgerMaturity(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return `${value}T00:00:00.000Z`
}

/** Lender funds + creates the offer from a cash holding (MakeOffer). */
export async function createOffer(draft: Draft): Promise<TxResult> {
  const valuation = await findCurrentValuation(cfg.parties.lender)
  const cashCid = await findCash(cfg.parties.lender, draft.principal)
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
  )
}

/** Borrower accepts, locking their collateral holding into the loan. */
export async function acceptOffer(offerCid: string): Promise<TxResult> {
  const { contracts } = await listActive(cfg.parties.borrower)
  const offer = contracts.find((c) => c.contractId === offerCid && c.template === 'LoanOffer')
  const requestedQuantity = Number(offer?.args.collateralQuantity)
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error('Offer collateral quantity is missing or invalid; refresh the lender offer before accepting.')
  }
  const collateralCid = await findCollateral(cfg.parties.borrower, COLLATERAL_ASSET, requestedQuantity)
  return submit(cfg.parties.borrower, exercise(template('LoanOffer'), offerCid, 'Accept', { collateralCid }), 'accept')
}

export const withdrawOffer = (cid: string) =>
  submit(cfg.parties.lender, exercise(template('LoanOffer'), cid, 'Withdraw'), 'withdraw')

/** Borrower repays from a cash holding covering principal + interest. */
export async function repayLoan(loanCid: string, repayment: number): Promise<TxResult> {
  const repaymentCid = await findCash(cfg.parties.borrower, repayment)
  return submit(cfg.parties.borrower, exercise(template('Loan'), loanCid, 'Repay', { repaymentCid }), 'repay')
}

export const MARGIN_CALL_WINDOW_SECONDS = 60

/** Replace the current mark on the configured stream. This is manually
 * attested demo data, not an oracle claim; the UI never creates a parallel
 * valuation contract or chooses an arbitrary latest stream. */
export async function publishValuation(unitPrice: number): Promise<TxResult> {
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Valuation price must be greater than zero.')
  const { contracts } = await listActive(cfg.parties.valuer)
  const marks = contracts.filter((contract) =>
    contract.template === 'CollateralValuation'
      && contract.contractId
      && contract.args.valuationAgent === cfg.parties.valuer
      && contract.args.lender === cfg.parties.lender
      && contract.args.borrower === cfg.parties.borrower
      && contract.args.regulator === cfg.parties.regulator
      && contract.args.collateralAsset === COLLATERAL_ASSET
      && typeof contract.args.streamId === 'string'
  )
  if (marks.length !== 1) {
    throw new Error(`Expected exactly one active mark on the configured valuation stream; found ${marks.length}. Reset the demo to restore the stream lineage.`)
  }
  return submit(
    cfg.parties.valuer,
    exercise(template('CollateralValuation'), marks[0].contractId, 'Publish', { unitPrice: String(unitPrice) }),
    'valuation',
  )
}

export const issueMarginCall = (loanCid: string, valuationCid: string): Promise<TxResult> =>
  submit(cfg.parties.lender, exercise(template('Loan'), loanCid, 'IssueMarginCall', { valuationCid }), 'margin-call')

export async function topUpCollateral(loanCid: string, topUpQuantity: number, valuationCid: string): Promise<TxResult> {
  if (!Number.isFinite(topUpQuantity) || topUpQuantity <= 0) throw new Error('Top-up quantity must be greater than zero.')
  const collateralCid = await findCollateral(cfg.parties.borrower, COLLATERAL_ASSET, topUpQuantity)
  return submit(
    cfg.parties.borrower,
    exercise(template('Loan'), loanCid, 'TopUpCollateral', {
      collateralCid,
      topUpQuantity: String(topUpQuantity),
      valuationCid,
    }),
    'top-up',
  )
}

export const resolveMarginCall = (loanCid: string, valuationCid: string): Promise<TxResult> =>
  submit(cfg.parties.borrower, exercise(template('Loan'), loanCid, 'ResolveMarginCall', { valuationCid }), 'resolve-call')

/** Liquidation uses only a ledger valuation CID. The lender never supplies a
 * private mark directly; freshness, deadline, counterparties, and LTV are
 * checked by the Loan choice. */
export const liquidateLoan = (cid: string, valuationCid: string): Promise<TxResult> =>
  submit(cfg.parties.lender, exercise(template('Loan'), cid, 'Liquidate', { valuationCid }), 'liquidate')

/** Close a loan after its exact ledger maturity instant, without a price mark
 * or margin call. The Daml choice enforces now > maturity. */
export const liquidateOverdueLoan = (cid: string): Promise<TxResult> =>
  submit(cfg.parties.lender, exercise(template('Loan'), cid, 'LiquidateOverdue'), 'liquidate-overdue')

/** Seed the canonical demo holdings: lender 100 cash, borrower 105 cash plus
 * the locked-offer quantity (150) and a separate 50-unit top-up reserve. */
export async function seedDemo(): Promise<void> {
  await submitAs(
    [cfg.parties.lender, cfg.parties.borrower, cfg.parties.valuer],
    createAndExercise(
      template('ValuationStream'),
      {
        valuationAgent: cfg.parties.valuer,
        lender: cfg.parties.lender,
        borrower: cfg.parties.borrower,
        regulator: cfg.parties.regulator,
        collateralAsset: COLLATERAL_ASSET,
      },
      'PublishInitial',
      { unitPrice: '1' },
    ),
    'seed-valuation',
  )
  await submit(cfg.parties.lender, create(template('CashHolding'), { owner: cfg.parties.lender, amount: String(SEED.lenderCash) }), 'seed')
  await submit(cfg.parties.borrower, create(template('CashHolding'), { owner: cfg.parties.borrower, amount: String(SEED.borrowerCash) }), 'seed')
  await submit(cfg.parties.borrower, create(template('CollateralHolding'), { owner: cfg.parties.borrower, asset: COLLATERAL_ASSET, quantity: String(SEED.borrowerCollateral) }), 'seed')
  await submit(cfg.parties.borrower, create(template('CollateralHolding'), { owner: cfg.parties.borrower, asset: COLLATERAL_ASSET, quantity: String(SEED.borrowerReserve) }), 'seed')
}

async function submitReset(actAs: string[], command: unknown, prefix: string): Promise<TxResult> {
  const res = await api<any>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commands: [command],
      commandId: nextCommandId(`reset-${prefix}`),
      actAs,
      userId: cfg.userId,
    },
  })
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
 * both signatories rather than bypassing the margin-call deadline/Liquidate
 * choice, then burns known holdings and valuation records before seeding. */
export async function resetDemo(): Promise<void> {
  let { contracts } = await listActive(cfg.parties.lender)
  for (const c of contracts) {
    if (c.template === 'LoanOffer') await withdrawOffer(c.contractId)
    else if (c.template === 'Loan') {
      await submitReset(
        [cfg.parties.lender, cfg.parties.borrower],
        exercise(template('Loan'), c.contractId, 'Archive'),
        'archive-loan',
      )
    }
  }
  ;({ contracts } = await listActive(cfg.parties.lender))
  for (const c of contracts) {
    if (c.template === 'LoanClosed')
      await submit(cfg.parties.lender, exercise(template('LoanClosed'), c.contractId, 'Dismiss'), 'dismiss')
  }
  // Price and stream records have multiple signatories. Reset is an explicit
  // cooperative demo cleanup, so archive both templates with all authorized
  // parties before recreating one stream and its initial mark.
  const { contracts: valuations } = await listActive(cfg.parties.valuer)
  const cleanupActors = [cfg.parties.lender, cfg.parties.borrower, cfg.parties.valuer]
  for (const c of valuations) {
    if (c.template === 'CollateralValuation') {
      await submitAs(cleanupActors, exercise(template('CollateralValuation'), c.contractId, 'Archive'), 'burn-valuation')
    }
  }
  for (const c of valuations) {
    if (c.template === 'ValuationStream') {
      await submitAs(cleanupActors, exercise(template('ValuationStream'), c.contractId, 'Archive'), 'burn-valuation-stream')
    }
  }
  // Burn every holding (each archived by its owner) before re-seeding.
  for (const party of [cfg.parties.lender, cfg.parties.borrower]) {
    const { contracts: held } = await listActive(party)
    for (const c of held) {
      if (c.template === 'CashHolding' || c.template === 'CollateralHolding')
        await submit(party, exercise(template(c.template), c.contractId, 'Archive'), 'burn')
    }
  }
  await seedDemo()
}
