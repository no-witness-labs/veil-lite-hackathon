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
  parties: { lender: '', borrower: '', regulator: '', outsider: '' },
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
]

export const COLLATERAL_ASSET = 'Tokenized T-Bill / MMF'

/** Canonical demo seed (kept in sync with scripts/bootstrap.sh). */
const SEED = { lenderCash: 100, borrowerCash: 105, borrowerCollateral: 150 }

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
  const res = await api<any>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commands: [command],
      commandId: nextCommandId(prefix),
      actAs: [actAs],
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
  return h.contractId
}

async function findCollateral(party: string, asset: string): Promise<string> {
  const { contracts } = await listActive(party)
  const h = parseHoldings(contracts).find((x) => x.kind === 'collateral' && x.asset === asset)
  if (!h) throw new Error(`No ${asset} collateral holding available — use "Reset demo" to re-seed holdings.`)
  return h.contractId
}

/** Lender funds + creates the offer from a cash holding (MakeOffer). */
export async function createOffer(draft: Draft): Promise<TxResult> {
  const cashCid = await findCash(cfg.parties.lender, draft.principal)
  return submit(
    cfg.parties.lender,
    exercise(template('CashHolding'), cashCid, 'MakeOffer', {
      borrower: cfg.parties.borrower,
      regulator: cfg.parties.regulator,
      principal: String(draft.principal),
      interest: String(draft.interest),
      collateralAsset: COLLATERAL_ASSET,
      collateralQuantity: String(draft.collateral),
      maturity: draft.maturity,
      liquidationThresholdLtv: String(LIQUIDATION_THRESHOLD_LTV),
    }),
    'offer',
  )
}

/** Borrower accepts, locking their collateral holding into the loan. */
export async function acceptOffer(offerCid: string): Promise<TxResult> {
  const collateralCid = await findCollateral(cfg.parties.borrower, COLLATERAL_ASSET)
  return submit(cfg.parties.borrower, exercise(template('LoanOffer'), offerCid, 'Accept', { collateralCid }), 'accept')
}

export const withdrawOffer = (cid: string) =>
  submit(cfg.parties.lender, exercise(template('LoanOffer'), cid, 'Withdraw'), 'withdraw')

/** Borrower repays from a cash holding covering principal + interest. */
export async function repayLoan(loanCid: string, repayment: number): Promise<TxResult> {
  const repaymentCid = await findCash(cfg.parties.borrower, repayment)
  return submit(cfg.parties.borrower, exercise(template('Loan'), loanCid, 'Repay', { repaymentCid }), 'repay')
}

/** Lender liquidates, supplying the current collateral value. The ledger rejects
 * this unless the resulting LTV breaches the loan's threshold; collateral is seized. */
export const liquidateLoan = (cid: string, currentCollateralValue: number) =>
  submit(
    cfg.parties.lender,
    exercise(template('Loan'), cid, 'Liquidate', { currentCollateralValue: String(currentCollateralValue) }),
    'liquidate',
  )

/** Seed the canonical demo holdings: lender 100 cash, borrower 105 cash + 150 collateral. */
export async function seedDemo(): Promise<void> {
  await submit(cfg.parties.lender, create(template('CashHolding'), { owner: cfg.parties.lender, amount: String(SEED.lenderCash) }), 'seed')
  await submit(cfg.parties.borrower, create(template('CashHolding'), { owner: cfg.parties.borrower, amount: String(SEED.borrowerCash) }), 'seed')
  await submit(cfg.parties.borrower, create(template('CollateralHolding'), { owner: cfg.parties.borrower, asset: COLLATERAL_ASSET, quantity: String(SEED.borrowerCollateral) }), 'seed')
}

/** Clear the ledger and re-seed canonical holdings so the demo can be re-run.
 * Deal contracts are cleared with lender authority (a near-zero mark forces the
 * liquidation guard during cleanup); holdings are archived by their owner. */
export async function resetDemo(): Promise<void> {
  let { contracts } = await listActive(cfg.parties.lender)
  for (const c of contracts) {
    if (c.template === 'LoanOffer') await withdrawOffer(c.contractId)
    else if (c.template === 'Loan') await liquidateLoan(c.contractId, 0.01)
  }
  ;({ contracts } = await listActive(cfg.parties.lender))
  for (const c of contracts) {
    if (c.template === 'LoanClosed')
      await submit(cfg.parties.lender, exercise(template('LoanClosed'), c.contractId, 'Dismiss'), 'dismiss')
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
