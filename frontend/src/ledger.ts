// Minimal client for the Canton JSON Ledger API v2.
//
// The npm @daml/ledger package targets the old v1 HTTP JSON API, so we talk to
// v2 directly with fetch. The sandbox runs with auth disabled, so requests carry
// no bearer token — the acting party is named explicitly in each command.
//
// Runtime config (party ids, rulesCid, instruments) is fetched from
// /ledger-config.json, which scripts/bootstrap.sh writes into frontend/public.
import type {
  ActiveState,
  Contract,
  DealArgs,
  Draft,
  Holding,
  InstrumentId,
  Role,
  TemplateName,
  TxResult,
} from './types'

interface LedgerConfig {
  jsonApiUrl: string
  packageRef: string
  simpleTokenPackageRef: string
  userId: string
  parties: Record<Role, string>
  rulesCid: string
  instruments: { usd: InstrumentId; tbill: InstrumentId }
}

const DEFAULTS: LedgerConfig = {
  jsonApiUrl: 'http://127.0.0.1:6864',
  packageRef: '#veil',
  simpleTokenPackageRef: '#simple-token',
  userId: 'veil',
  parties: {
    lender: '',
    borrower: '',
    regulator: '',
    outsider: '',
    registry: '',
    operator: '',
  },
  rulesCid: '',
  instruments: { usd: { admin: '', id: 'USD' }, tbill: { admin: '', id: 'TBILL' } },
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
      instruments: { ...DEFAULTS.instruments, ...(loaded.instruments ?? {}) },
    }
    return Boolean(cfg.parties.lender && cfg.rulesCid)
  } catch {
    return false
  }
}

export const getParties = (): Record<Role, string> => cfg.parties

export const COLLATERAL_LABEL = 'Tokenized T-Bill / MMF'

const IF_HOLDING =
  '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding'
const IF_ALLOCATION =
  '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation'
const IF_ALLOC_FACTORY =
  '#splice-api-token-allocation-instruction-v1:Splice.Api.Token.AllocationInstructionV1:AllocationFactory'
const TM_SIMPLE_HOLDING = '#simple-token:SimpleToken.Holding:SimpleHolding'

const DEAL_TEMPLATES: TemplateName[] = ['LoanOffer', 'Loan', 'LoanClosed', 'Escrow']

/** Canonical demo seed (kept in sync with scripts/bootstrap.sh). */
const SEED = { lenderCash: 100, borrowerCash: 105, borrowerCollateral: 150 }

/** Dynamic allocation window — wide future horizon so demo works regardless of calendar date. */
function allocWindow() {
  const now = Date.now()
  return {
    requestedAt: new Date(now - 60_000).toISOString(),
    allocateBefore: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(),
    settleBefore: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

const EMPTY_META = { values: {} as Record<string, never> }
const EMPTY_EXTRA_ARGS = { context: EMPTY_META, meta: EMPTY_META }

// In dev, call same-origin ("/v2/...") so the Vite proxy forwards to the sandbox
// (the JSON API sends no CORS headers). In a production build, use the configured URL.
const base = () => (import.meta.env.DEV ? '' : cfg.jsonApiUrl)
const template = (name: Exclude<TemplateName, 'Holding'>) => `${cfg.packageRef}:Veil:${name}`

/** LTV threshold (%) above which the on-ledger Liquidate choice is permitted. */
export const LIQUIDATION_THRESHOLD_LTV = 90

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

function toDamlTime(date: string): string {
  return date.includes('T') ? date : `${date}T00:00:00Z`
}

function holdingView(ce: Record<string, unknown>): DealArgs | null {
  for (const iv of (ce.interfaceViews as Record<string, unknown>[] | undefined) ?? []) {
    if (!String(iv.interfaceId).includes('HoldingV1:Holding')) continue
    const view = iv.viewValue as DealArgs | undefined
    if (view?.owner && view?.instrumentId) return view
  }
  return null
}

function parseEntry(entry: Record<string, unknown>): Contract | null {
  const ce = (entry?.contractEntry as Record<string, unknown> | undefined)?.JsActiveContract as
    | Record<string, unknown>
    | undefined
  const created = ce?.createdEvent as Record<string, unknown> | undefined
  if (!created?.contractId) return null

  const entity = templateName(created.templateId) as TemplateName
  if (DEAL_TEMPLATES.includes(entity)) {
    return {
      contractId: created.contractId as string,
      template: entity,
      offset: (created.offset as number) ?? 0,
      args: created.createArgument as DealArgs,
    }
  }

  const view = holdingView(created)
  if (!view) return null
  return {
    contractId: created.contractId as string,
    template: 'Holding',
    offset: (created.offset as number) ?? 0,
    args: view,
  }
}

/** Active contracts visible to `party`, normalized, plus the raw ledger JSON
 * (for the inspector). Outsider → empty. */
export async function listActive(party: string): Promise<ActiveState> {
  const offset = await ledgerEnd()
  const entries = await api<Record<string, unknown>[]>('/v2/state/active-contracts', {
    filter: {
      filtersByParty: {
        [party]: {
          cumulative: [
            { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
            {
              identifierFilter: {
                InterfaceFilter: {
                  value: {
                    interfaceId: IF_HOLDING,
                    includeInterfaceView: true,
                    includeCreatedEventBlob: false,
                  },
                },
              },
            },
          ],
        },
      },
    },
    verbose: false,
    activeAtOffset: offset,
  })

  const seen = new Set<string>()
  const contracts: Contract[] = []
  for (const entry of entries) {
    const c = parseEntry(entry)
    if (!c || seen.has(c.contractId)) continue
    seen.add(c.contractId)
    contracts.push(c)
  }
  return { contracts, raw: entries, offset }
}

interface SubmitOpts {
  readAs?: string[]
  disclosedContracts?: unknown[]
}

async function submit(
  actAs: string[],
  command: unknown,
  prefix: string,
  opts: SubmitOpts = {},
): Promise<TxResult> {
  const res = await api<Record<string, unknown>>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commands: [command],
      commandId: nextCommandId(prefix),
      actAs,
      readAs: opts.readAs ?? [],
      disclosedContracts: opts.disclosedContracts ?? [],
      userId: cfg.userId,
    },
  })
  const tx = (res.transaction ?? {}) as Record<string, unknown>
  const created: TxResult['created'] = []
  const archived: TxResult['archived'] = []
  for (const ev of (tx.events as Record<string, unknown>[] | undefined) ?? []) {
    if (ev.CreatedEvent) {
      const ce = ev.CreatedEvent as Record<string, unknown>
      created.push({ template: templateName(ce.templateId), contractId: ce.contractId as string })
    }
    if (ev.ArchivedEvent) {
      const ae = ev.ArchivedEvent as Record<string, unknown>
      archived.push({ template: templateName(ae.templateId), contractId: ae.contractId as string })
    }
  }
  return {
    updateId: (tx.updateId as string) ?? '',
    offset: (tx.offset as number) ?? 0,
    synchronizerId: (tx.synchronizerId as string) ?? '',
    created,
    archived,
  }
}

function create(templateId: string, createArguments: Record<string, unknown>) {
  return { CreateCommand: { templateId, createArguments } }
}

function exercise(
  templateId: string,
  contractId: string,
  choice: string,
  choiceArgument: Record<string, unknown> = {},
) {
  return { ExerciseCommand: { templateId, contractId, choice, choiceArgument } }
}

function exerciseInterface(
  interfaceId: string,
  contractId: string,
  choice: string,
  choiceArgument: Record<string, unknown> = {},
) {
  return { ExerciseCommand: { templateId: interfaceId, contractId, choice, choiceArgument } }
}

function mkAllocationSpec(
  sender: string,
  receiver: string,
  executor: string,
  instrumentId: InstrumentId,
  amount: string,
) {
  const { requestedAt, allocateBefore, settleBefore } = allocWindow()
  return {
    settlement: {
      executor,
      settlementRef: { id: 'veil-loan', cid: null },
      requestedAt,
      allocateBefore,
      settleBefore,
      meta: EMPTY_META,
    },
    transferLegId: 'leg',
    transferLeg: { sender, receiver, amount, instrumentId, meta: EMPTY_META },
  }
}

function findCreatedAllocation(result: TxResult): string {
  const cid = result.created.find(
    (c) => c.template === 'Allocation' || c.template.endsWith('Allocation'),
  )?.contractId
  if (!cid) throw new Error('Allocation funding did not create an Allocation contract')
  return cid
}

async function fundAllocation(
  sender: string,
  spec: ReturnType<typeof mkAllocationSpec>,
  inputHoldingCids: string[],
): Promise<string> {
  const result = await submit(
    [cfg.parties.registry, sender],
    exerciseInterface(IF_ALLOC_FACTORY, cfg.rulesCid, 'AllocationFactory_Allocate', {
      expectedAdmin: cfg.parties.registry,
      allocation: spec,
      requestedAt: spec.settlement.requestedAt,
      inputHoldingCids,
      extraArgs: EMPTY_EXTRA_ARGS,
    }),
    'allocate',
  )
  return findCreatedAllocation(result)
}

/** A party's own wallet holdings (cash + collateral), derived from Holding interface views. */
export function parseHoldings(contracts: Contract[]): Holding[] {
  const out: Holding[] = []
  for (const c of contracts) {
    if (c.template !== 'Holding') continue
    if (c.args.lock != null) continue
    const id = c.args.instrumentId?.id ?? ''
    const amount = Number(c.args.amount)
    if (id === cfg.instruments.usd.id)
      out.push({ contractId: c.contractId, kind: 'cash', amount })
    else if (id === cfg.instruments.tbill.id)
      out.push({ contractId: c.contractId, kind: 'collateral', amount, asset: COLLATERAL_LABEL })
  }
  return out
}

async function findInstrumentHolding(
  party: string,
  instrument: 'USD' | 'TBILL',
  minAmount: number,
): Promise<string> {
  const { contracts } = await listActive(party)
  const kind = instrument === 'USD' ? 'cash' : 'collateral'
  const h = parseHoldings(contracts)
    .filter((x) => x.kind === kind && x.amount >= minAmount)
    .sort((a, b) => a.amount - b.amount)[0]
  if (!h) {
    throw new Error(
      `No ${instrument} holding ≥ ${minAmount} available — use "Reset demo" to re-seed holdings.`,
    )
  }
  return h.contractId
}

/** Lender funds a principal allocation and creates the offer. */
export async function createOffer(draft: Draft): Promise<TxResult> {
  const cashCid = await findInstrumentHolding(cfg.parties.lender, 'USD', draft.principal)
  const cashAlloc = await fundAllocation(
    cfg.parties.lender,
    mkAllocationSpec(
      cfg.parties.lender,
      cfg.parties.borrower,
      cfg.parties.lender,
      cfg.instruments.usd,
      String(draft.principal),
    ),
    [cashCid],
  )
  return submit(
    [cfg.parties.lender],
    create(template('LoanOffer'), {
      lender: cfg.parties.lender,
      borrower: cfg.parties.borrower,
      regulator: cfg.parties.regulator,
      operator: cfg.parties.operator,
      cashAllocationCid: cashAlloc,
      cashInstrumentId: cfg.instruments.usd,
      principal: String(draft.principal),
      interest: String(draft.interest),
      collateralInstrumentId: cfg.instruments.tbill,
      collateralQuantity: String(draft.collateral),
      liquidationThresholdLtv: String(LIQUIDATION_THRESHOLD_LTV),
      maturity: toDamlTime(draft.maturity),
    }),
    'offer',
  )
}

/** Borrower + operator escrow the collateral into an `Escrow` (custodian sees only the collateral):
 *  fund a borrower -> operator allocation, execute it into the operator's holding, wrap in an Escrow. */
async function escrowCollateral(qty: number): Promise<string> {
  const collateralCid = await findInstrumentHolding(cfg.parties.borrower, 'TBILL', qty)
  const collAlloc = await fundAllocation(
    cfg.parties.borrower,
    mkAllocationSpec(
      cfg.parties.borrower,
      cfg.parties.operator,
      cfg.parties.operator,
      cfg.instruments.tbill,
      String(qty),
    ),
    [collateralCid],
  )
  // Execute the allocation into the operator's escrow holding (borrower + operator co-sign).
  const execRes = await submit(
    [cfg.parties.borrower, cfg.parties.operator],
    exerciseInterface(IF_ALLOCATION, collAlloc, 'Allocation_ExecuteTransfer', {
      extraArgs: EMPTY_EXTRA_ARGS,
    }),
    'escrow-exec',
  )
  const escrowHoldingCid = execRes.created.find((c) => c.template.endsWith('Holding'))?.contractId
  if (!escrowHoldingCid) throw new Error('Escrow execute produced no holding')
  const res = await submit(
    [cfg.parties.borrower, cfg.parties.operator],
    create(template('Escrow'), {
      operator: cfg.parties.operator,
      borrower: cfg.parties.borrower,
      lender: cfg.parties.lender,
      regulator: cfg.parties.regulator,
      escrowCollateralCid: escrowHoldingCid,
      collateralFactoryCid: cfg.rulesCid,
      collateralInstrumentId: cfg.instruments.tbill,
      collateralQuantity: String(qty),
    }),
    'escrow',
  )
  const cid = res.created.find((c) => c.template === 'Escrow')?.contractId
  if (!cid) throw new Error('Escrow creation failed')
  return cid
}

/** Borrower escrows the collateral with the custodian, then accepts the offer (principal delivered). */
export async function acceptOffer(offerCid: string): Promise<TxResult> {
  const { contracts } = await listActive(cfg.parties.borrower)
  const offer = contracts.find((c) => c.contractId === offerCid && c.template === 'LoanOffer')
  if (!offer?.args.collateralQuantity) {
    throw new Error('Offer not found or missing collateralQuantity')
  }
  const escrowCid = await escrowCollateral(Number(offer.args.collateralQuantity))
  return submit(
    [cfg.parties.borrower],
    exercise(template('LoanOffer'), offerCid, 'Accept', {
      escrowCid,
      cashExtraArgs: EMPTY_EXTRA_ARGS,
    }),
    'accept',
  )
}

/** Lender withdraws an unaccepted offer and refunds the principal allocation. */
export async function withdrawOffer(offerCid: string): Promise<TxResult> {
  const { contracts } = await listActive(cfg.parties.lender)
  const offer = contracts.find((c) => c.contractId === offerCid && c.template === 'LoanOffer')
  const cashAllocCid = offer?.args.cashAllocationCid
  const result = await submit(
    [cfg.parties.lender],
    exercise(template('LoanOffer'), offerCid, 'Withdraw'),
    'withdraw',
  )
  if (cashAllocCid) {
    await submit(
      [cfg.parties.lender],
      exerciseInterface(IF_ALLOCATION, cashAllocCid, 'Allocation_Withdraw', {
        extraArgs: EMPTY_EXTRA_ARGS,
      }),
      'refund',
    )
  }
  return result
}

/** Borrower repays via a funded repayment allocation; collateral released from escrow. */
export async function repayLoan(loanCid: string, repayment: number): Promise<TxResult> {
  const repaymentCid = await findInstrumentHolding(cfg.parties.borrower, 'USD', repayment)
  const repayAlloc = await fundAllocation(
    cfg.parties.borrower,
    mkAllocationSpec(
      cfg.parties.borrower,
      cfg.parties.lender,
      cfg.parties.borrower,
      cfg.instruments.usd,
      String(repayment),
    ),
    [repaymentCid],
  )
  return submit(
    [cfg.parties.borrower],
    exercise(template('Loan'), loanCid, 'Repay', {
      repayAllocationCid: repayAlloc,
      repayExtraArgs: EMPTY_EXTRA_ARGS,
      collateralExtraArgs: EMPTY_EXTRA_ARGS,
    }),
    'repay',
    { readAs: [cfg.parties.operator, cfg.parties.registry] },
  )
}

/** Lender liquidates on an LTV breach; escrow collateral seized to the lender. */
export const liquidateLoan = (cid: string, currentCollateralValue: number) =>
  submit(
    [cfg.parties.lender],
    exercise(template('Loan'), cid, 'Liquidate', {
      currentCollateralValue: String(currentCollateralValue),
      collateralExtraArgs: EMPTY_EXTRA_ARGS,
    }),
    'liquidate',
    { readAs: [cfg.parties.operator, cfg.parties.registry] },
  )

async function mintHolding(owner: string, instrumentId: InstrumentId, amount: number): Promise<void> {
  await submit(
    [cfg.parties.registry, owner],
    create(TM_SIMPLE_HOLDING, {
      admin: cfg.parties.registry,
      owner,
      instrumentId,
      amount: String(amount),
      meta: EMPTY_META,
    }),
    'seed',
  )
}

/** Seed the canonical demo holdings. */
export async function seedDemo(): Promise<void> {
  await mintHolding(cfg.parties.lender, cfg.instruments.usd, SEED.lenderCash)
  await mintHolding(cfg.parties.borrower, cfg.instruments.usd, SEED.borrowerCash)
  await mintHolding(cfg.parties.borrower, cfg.instruments.tbill, SEED.borrowerCollateral)
}

/** Clear the ledger and re-seed canonical holdings so the demo can be re-run. */
export async function resetDemo(): Promise<void> {
  let { contracts } = await listActive(cfg.parties.lender)
  for (const c of contracts) {
    if (c.template === 'LoanOffer') await withdrawOffer(c.contractId)
    else if (c.template === 'Loan') await liquidateLoan(c.contractId, 0.01)
  }
  ;({ contracts } = await listActive(cfg.parties.lender))
  for (const c of contracts) {
    if (c.template === 'LoanClosed')
      await submit(
        [cfg.parties.lender],
        exercise(template('LoanClosed'), c.contractId, 'Dismiss'),
        'dismiss',
      )
  }
  await archiveDanglingEscrows()
  // Burn every holding (owner + registry co-sign SimpleHolding).
  for (const party of [cfg.parties.lender, cfg.parties.borrower, cfg.parties.operator]) {
    await archiveHoldings(party)
  }
  await seedDemo()
}

/** Archive any escrows the operator still custodies (operator + borrower co-sign). */
async function archiveDanglingEscrows(): Promise<void> {
  const { contracts } = await listActive(cfg.parties.operator)
  for (const c of contracts) {
    if (c.template === 'Escrow')
      await submit(
        [cfg.parties.operator, cfg.parties.borrower],
        exercise(template('Escrow'), c.contractId, 'Archive'),
        'burn-escrow',
      )
  }
}

/** Archive all of a party's SimpleHoldings (owner + registry co-sign). */
async function archiveHoldings(party: string): Promise<void> {
  const { contracts } = await listActive(party)
  for (const c of contracts) {
    if (c.template !== 'Holding') continue
    await submit(
      [cfg.parties.registry, party],
      exercise(TM_SIMPLE_HOLDING, c.contractId, 'Archive'),
      'burn',
    )
  }
}

export function collateralLabel(instrumentId?: InstrumentId): string {
  if (instrumentId?.id === cfg.instruments.tbill.id) return COLLATERAL_LABEL
  return instrumentId?.id ?? 'Collateral'
}
