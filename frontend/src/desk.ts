// Visitor desks: pure selection logic (no React, no DOM, no fetch) so it can be
// unit-tested with Node's type stripping (test/desk.test.mjs).
//
// Every visitor of the open demo signs in as the same shared parties. A desk is
// the set of valuation streams /api/desk opened for this browser, one per
// valued asset. Every offer, loan, closed record and mark names its stream, so
// the stream ids decide which contracts are this visitor's. Holdings are
// shared wallets and are not desk-scoped.
import type { Contract, TemplateName } from './types'

export interface Desk {
  /** Signed by the server; lets this browser close its own desk. Not a ledger credential. */
  token: string
  deskId: string
  /** Stream contract id per valued asset. */
  streams: Record<string, string>
  /** Unix seconds. */
  expiresAt: number
}

const DESK_SCOPED = new Set<TemplateName>([
  'LoanOffer',
  'CoinLoanOffer',
  'Loan',
  'CoinLoan',
  'LoanClosed',
  'SubstitutionRequest',
  'CollateralValuation',
  'ValuationStream',
])

export const deskStreamIds = (desk: Desk | null | undefined): Set<string> => new Set(desk ? Object.values(desk.streams) : [])

/** The stream a contract belongs to; null for contracts outside any desk. */
export function streamOf(contract: Contract): string | null {
  switch (contract.template) {
    case 'CollateralValuation':
      return contract.args.streamId ?? null
    case 'ValuationStream':
      return contract.contractId
    case 'SubstitutionRequest':
      return contract.args.newValuationStreamId ?? null
    default:
      return DESK_SCOPED.has(contract.template) ? contract.args.valuationStreamId ?? null : null
  }
}

export const isDeskScoped = (contract: Contract): boolean => DESK_SCOPED.has(contract.template)

export function onDesk(contract: Contract, streams: ReadonlySet<string>): boolean {
  const stream = streamOf(contract)
  return stream !== null && streams.has(stream)
}

/** True unless the contract names a borrower other than the demo's own. The
 * operator reset acts only for the demo's parties, so it must leave alone deals
 * and marks of any other borrower (e.g. a self-custody wallet's external party,
 * which signs only with its own key). */
export const hasDemoBorrower = (contract: Contract, borrower: string): boolean =>
  !contract.args.borrower || contract.args.borrower === borrower

/** The visitor's view: this desk's deals and marks plus everything that is
 * not desk-scoped (holdings). Without a desk, no deal or mark is shown. */
export function scopeToDesk(contracts: Contract[], streams: ReadonlySet<string>): Contract[] {
  return contracts.filter((contract) => !isDeskScoped(contract) || onDesk(contract, streams))
}

/** True when a party that sees marks shows none for some desk stream: the
 * operator reset or the idle janitor closed it, and the desk needs repair. */
export function deskNeedsRepair(contracts: Contract[], desk: Desk): boolean {
  const live = new Set(contracts.filter((c) => c.template === 'CollateralValuation').map((c) => c.args.streamId))
  return Object.values(desk.streams).some((stream) => !live.has(stream))
}

export const deskExpired = (desk: Desk, nowMs: number, marginMs = 60_000): boolean => desk.expiresAt * 1000 - marginMs <= nowMs

/** Validate a stored or returned desk; null when it is not one. */
export function parseDesk(value: unknown): Desk | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.token !== 'string' || !v.token || typeof v.deskId !== 'string' || !v.deskId) return null
  if (typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt)) return null
  const streams = v.streams
  if (!streams || typeof streams !== 'object' || Array.isArray(streams)) return null
  const entries = Object.entries(streams as Record<string, unknown>)
  if (entries.length === 0 || entries.some(([, id]) => typeof id !== 'string' || !id)) return null
  return { token: v.token, deskId: v.deskId, streams: Object.fromEntries(entries) as Record<string, string>, expiresAt: v.expiresAt }
}
