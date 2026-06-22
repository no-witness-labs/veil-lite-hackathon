// Minimal client for the Canton JSON Ledger API v2.
//
// The npm @daml/ledger package targets the old v1 HTTP JSON API, so we talk to
// v2 directly with fetch. The sandbox runs with auth disabled, so requests carry
// no bearer token — the acting party is named explicitly in each command.
import config from './ledger-config.json'
import type { ActiveState, Contract, DealArgs, Draft, Role, TemplateName, TxResult } from './types'

// In dev, call same-origin ("/v2/...") so the Vite proxy forwards to the sandbox
// (the JSON API sends no CORS headers). In a production build, use the configured
// absolute URL.
const BASE = import.meta.env.DEV ? '' : config.jsonApiUrl
const PKG = config.packageRef // "#veil"
const USER_ID = config.userId
export const parties: Record<Role, string> = config.parties as Record<Role, string>

const TEMPLATES = {
  LoanOffer: `${PKG}:Veil:LoanOffer`,
  Loan: `${PKG}:Veil:Loan`,
  LoanClosed: `${PKG}:Veil:LoanClosed`,
} as const

const KNOWN_TEMPLATES: TemplateName[] = ['LoanOffer', 'Loan', 'LoanClosed']

let commandSeq = 0
function nextCommandId(prefix: string): string {
  commandSeq += 1
  return `veil-${prefix}-${Date.now()}-${commandSeq}`
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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
  const res = await fetch(`${BASE}/v2/state/ledger-end`)
  if (!res.ok) throw new Error(`Failed to read ledger end (HTTP ${res.status})`)
  return (await res.json()).offset as number
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
    const entity = String(ce.templateId).split(':').pop() as TemplateName
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

function templateName(templateId: unknown): string {
  return String(templateId).split(':').pop() ?? '?'
}

async function submit(actAs: string, command: unknown, prefix: string): Promise<TxResult> {
  const res = await api<any>('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commands: [command],
      commandId: nextCommandId(prefix),
      actAs: [actAs],
      userId: USER_ID,
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

function exercise(templateId: string, contractId: string, choice: string) {
  return { ExerciseCommand: { templateId, contractId, choice, choiceArgument: {} } }
}

export function createOffer(draft: Draft): Promise<TxResult> {
  return submit(
    parties.lender,
    create(TEMPLATES.LoanOffer, {
      lender: parties.lender,
      borrower: parties.borrower,
      regulator: parties.regulator,
      principal: String(draft.principal),
      interest: String(draft.interest),
      collateralAsset: 'Tokenized T-Bill / MMF',
      collateralQuantity: String(draft.collateral),
      maturity: draft.maturity,
    }),
    'offer',
  )
}

export const acceptOffer = (cid: string) =>
  submit(parties.borrower, exercise(TEMPLATES.LoanOffer, cid, 'Accept'), 'accept')

export const withdrawOffer = (cid: string) =>
  submit(parties.lender, exercise(TEMPLATES.LoanOffer, cid, 'Withdraw'), 'withdraw')

export const repayLoan = (cid: string) =>
  submit(parties.borrower, exercise(TEMPLATES.Loan, cid, 'Repay'), 'repay')

export const liquidateLoan = (cid: string) =>
  submit(parties.lender, exercise(TEMPLATES.Loan, cid, 'Liquidate'), 'liquidate')

/** Clear the ledger back to an empty state so the demo can be re-run.
 * Run with lender authority: withdraw offers, liquidate live loans, dismiss
 * every settlement record (including ones produced by this reset). */
export async function resetDemo(): Promise<void> {
  let { contracts } = await listActive(parties.lender)
  for (const c of contracts) {
    if (c.template === 'LoanOffer') await withdrawOffer(c.contractId)
    else if (c.template === 'Loan') await liquidateLoan(c.contractId)
  }
  ;({ contracts } = await listActive(parties.lender))
  for (const c of contracts) {
    if (c.template === 'LoanClosed')
      await submit(parties.lender, exercise(TEMPLATES.LoanClosed, c.contractId, 'Dismiss'), 'dismiss')
  }
}
