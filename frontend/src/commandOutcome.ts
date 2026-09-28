// Pure logic for telling a committed, rejected or unknown command apart.
//
// A submission whose response is lost (network drop, proxy or gateway timeout)
// may still commit. Resubmitting blindly could run the action twice, so the UI
// instead reads the completion stream from the ledger end captured before the
// submission and looks for the command id it sent.

/** The proxy's error envelope. Ledger errors add errorId and category. */
export interface ErrorBody {
  code?: string
  message?: string
  requestId?: string
  errorId?: string
  category?: number
}

export interface CompletionError {
  code: string
  message: string
  errorId?: string
  category?: number
}

export interface CompletionEntry {
  commandId: string
  offset: number
  succeeded: boolean
  updateId?: string
  error?: CompletionError
}

export interface CompletionPage {
  completions: CompletionEntry[]
  lastOffset: number | null
}

export type ResolvedOutcome =
  | { outcome: 'completed'; updateId: string; offset: number }
  | { outcome: 'rejected'; error: CompletionError }
  | { outcome: 'unknown' }

// Canton error categories whose outcome is not definite: 1 is a transient
// server failure, 3 is "deadline exceeded, request state unknown".
const UNKNOWN_CATEGORIES = new Set([1, 3])
// Proxy codes raised after the request may already have reached the ledger.
const UNKNOWN_CODES = new Set(['LEDGER_TIMEOUT', 'PROXY_ERROR', 'REQUEST_TIMEOUT'])
const GATEWAY_STATUSES = new Set([502, 503, 504])

export const OUTCOME_CHECKING = 'Outcome unknown, checking the ledger…'

export function parseErrorBody(text: string): ErrorBody | null {
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const body = value as Record<string, unknown>
    if (typeof body.code !== 'string') return null
    return {
      code: body.code,
      message: typeof body.message === 'string' ? body.message : undefined,
      requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
      errorId: typeof body.errorId === 'string' ? body.errorId : undefined,
      category: typeof body.category === 'number' ? body.category : undefined,
    }
  } catch {
    return null
  }
}

/** Whether a failed submission was definitely rejected or may have committed. */
export function classifyFailure(status: number, body: ErrorBody | null): 'rejected' | 'unknown' {
  if (!body) return GATEWAY_STATUSES.has(status) ? 'unknown' : 'rejected'
  if (body.category !== undefined && UNKNOWN_CATEGORIES.has(body.category)) return 'unknown'
  if (body.code && UNKNOWN_CODES.has(body.code)) return 'unknown'
  return 'rejected'
}

/** One line for the UI: the ledger's (or Daml contract's) message, then the
 * code and request id so a report can be matched to the server log. */
export function describeFailure(status: number, body: ErrorBody | null): string {
  if (!body) return `The server returned HTTP ${status}.`
  const message = body.message || `The request failed (HTTP ${status}).`
  const ref = [errorLabel(body.code, body.errorId), body.requestId && `request ${body.requestId}`].filter(Boolean).join('; ')
  return ref ? `${message} (${ref})` : message
}

export function describeCompletionError(error: CompletionError): string {
  return `${error.message} (${errorLabel(error.code, error.errorId)})`
}

/** A Daml `failWithStatus` id such as cannot-withdraw-committed-allocation is
 * worth showing; the generic unhandled-assertion id is not. */
function errorLabel(code: string | undefined, errorId: string | undefined): string | undefined {
  return errorId && !errorId.startsWith('UNHANDLED_EXCEPTION') ? errorId : code
}

/** Next command id: readable prefix plus a random part, unique across tabs. */
export function newCommandId(prefix: string, random: () => string): string {
  return `veil-${prefix}-${random()}`
}

export interface ResolveOptions {
  attempts: number
  delayMs: number
  sleep: (ms: number) => Promise<void>
  /** Errors for which the lookup should simply try again. Others propagate. */
  retryable: (error: unknown) => boolean
}

/** Poll completions from `beginExclusive` until `commandId` shows up. */
export async function resolveOutcome(
  commandId: string,
  beginExclusive: number,
  fetchPage: (beginExclusive: number) => Promise<CompletionPage>,
  options: ResolveOptions,
): Promise<ResolvedOutcome> {
  let begin = beginExclusive
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    if (attempt > 0) await options.sleep(options.delayMs)
    let page: CompletionPage
    try {
      page = await fetchPage(begin)
    } catch (error) {
      if (options.retryable(error)) continue
      throw error
    }
    const match = page.completions.find((entry) => entry.commandId === commandId)
    if (match) {
      return match.succeeded
        ? { outcome: 'completed', updateId: match.updateId ?? '', offset: match.offset }
        : { outcome: 'rejected', error: match.error ?? { code: 'LEDGER_REJECTED', message: 'The ledger rejected the command.' } }
    }
    if (page.lastOffset !== null && page.lastOffset > begin) begin = page.lastOffset
  }
  return { outcome: 'unknown' }
}
