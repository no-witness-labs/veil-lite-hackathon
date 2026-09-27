// Guided demo: which step a visitor is on, derived from what the ledger shows
// the current party rather than from clicks. A party only sees part of the
// story (the valuer never sees the loan, the outsider sees nothing), so the
// progress reached so far is carried in memory and only moves forward, except
// when the loan disappears (someone reset the demo).
import type { Contract, Role, Valuation } from './types'
import { isCoinDeal, marginCallOf, statusOf } from './state.ts'

export type TourTrack = 'tbill' | 'coin'
export type StepId = 'price' | 'offer' | 'accept' | 'stress' | 'call' | 'cure' | 'repay' | 'privacy'

export interface TourStep {
  id: StepId
  role: Role
  title: string
  instruction: string
}

const TRACK_ASSET: Record<TourTrack, string> = { tbill: 'Tokenized T-Bill', coin: 'Canton Coin' }
/** Lowest price at which the default offer (100 against 150 T-Bill or 1,000 CC,
 * 90% threshold) can still be originated; a stressed price left behind by an
 * earlier visitor would otherwise block the next one's Create offer. */
const LENDABLE_PRICE: Record<TourTrack, number> = { tbill: 100 / (150 * 0.9), coin: 100 / (1000 * 0.9) }

export function tourSteps(track: TourTrack): TourStep[] {
  const coin = track === 'coin'
  return [
    {
      id: 'price', role: 'valuer', title: 'Publish a fresh price',
      instruction: coin
        ? 'Select Canton Coin, enter 0.15 and press Publish mark. Prices are usable for five minutes.'
        : 'Keep Tokenized T-Bill selected, press Healthy · 1.00, then Publish mark. Prices are usable for five minutes.',
    },
    {
      id: 'offer', role: 'lender', title: 'Fund an offer',
      instruction: coin
        ? 'Choose collateral Canton Coin (real), keep the other terms and press Create offer. The principal is reserved now.'
        : 'Keep the default terms (every field is editable) and press Create offer. The principal is reserved now.',
    },
    {
      id: 'accept', role: 'borrower', title: 'Accept and lock collateral',
      instruction: coin
        ? 'Press Accept offer. In one transaction 1,000 real Canton Coin locks in a CIP-112 committed allocation and the principal arrives.'
        : 'Press Accept offer. In one transaction 150 T-Bill units lock and the principal arrives.',
    },
    {
      id: 'stress', role: 'valuer', title: 'Drop the price',
      instruction: coin
        ? 'Select Canton Coin, enter 0.11 and press Publish mark. LTV now breaches 90%.'
        : 'Press Stress · 0.62, then Publish mark. LTV now breaches 90%.',
    },
    {
      id: 'call', role: 'lender', title: 'Issue a margin call',
      instruction: 'Press Issue margin call. Canton starts a 60-second cure deadline; continue quickly.',
    },
    {
      id: 'cure', role: 'borrower', title: 'Cure the call',
      instruction: coin
        ? 'In Pay down, pay 30 and press Pay down. LTV falls back under the threshold and the call clears.'
        : 'In Pay down, pay 30 and press Pay down (or Top up). LTV falls back under the threshold and the call clears.',
    },
    {
      id: 'repay', role: 'borrower', title: 'Repay and release',
      instruction: coin
        ? 'Press Repay. The allocation is cancelled and the Canton Coin unlocks.'
        : 'Press Repay. All locked collateral returns to the borrower.',
    },
    {
      id: 'privacy', role: 'outsider', title: 'Check the privacy',
      instruction: 'Open the Raw ledger tab: an outsider\'s ledger query returns []. The regulator sees the settlement; the valuer never sees the loan.',
    },
  ]
}

export const STEP_ORDER: StepId[] = ['price', 'offer', 'accept', 'stress', 'call', 'cure', 'repay', 'privacy']
/** Steps whose completion shows on the loan itself, in order. */
const LOAN_STEPS: StepId[] = ['offer', 'accept', 'stress', 'call', 'cure', 'repay']
/** Parties that can see the loan and so can tell whether it still exists. */
const LOAN_OBSERVERS = new Set<Role>(['lender', 'borrower', 'regulator'])

/** Terms of the loan last seen by a party that can see it, so the valuer's
 * view (prices only) can tell when a published price breaches that loan. */
export interface KnownLoan {
  streamId: string
  outstandingPrincipal: number
  collateral: number
  threshold: number
}

export interface TourProgress {
  done: Set<StepId>
  loan?: KnownLoan
}

export interface TourView {
  role: Role
  deal?: Contract
  /** Marks visible to this party (all streams). */
  marks: Valuation[]
  now: number
}

const FRESH_MS = 5 * 60 * 1000
const isFresh = (mark: Valuation, now: number) => {
  const age = now - Date.parse(mark.observedAt)
  return Number.isFinite(age) && age >= 0 && age <= FRESH_MS
}

export function trackOfDeal(deal?: Contract): TourTrack | undefined {
  if (!deal) return undefined
  // A closed Canton Coin loan is a LoanClosed record whose asset says so.
  if (deal.template === 'LoanClosed') return deal.args.collateralAsset === TRACK_ASSET.coin ? 'coin' : 'tbill'
  return isCoinDeal(deal) ? 'coin' : 'tbill'
}

const breaches = (loan: KnownLoan, unitPrice: number) =>
  (loan.outstandingPrincipal / (loan.collateral * unitPrice)) * 100 >= loan.threshold

/** What this view proves has already happened, as the furthest loan step. */
function observedLoanStep(view: TourView, track: TourTrack, done: Set<StepId>, known?: KnownLoan): StepId | undefined {
  const deal = view.deal
  if (!deal) {
    // The valuer cannot see the loan, only prices: a fresh price on the
    // remembered loan's stream that breaches it completes the stress step.
    if (known && done.has('accept') && !done.has('stress')) {
      const mark = view.marks.find((m) => m.streamId === known.streamId && isFresh(m, view.now))
      if (mark && breaches(known, mark.unitPrice)) return 'stress'
    }
    return undefined
  }
  if (trackOfDeal(deal) !== track) return undefined
  const status = statusOf(deal)
  // A closed loan only proves progress for a visitor who saw it while it was
  // live; another visitor's finished loan must not tick this visitor's steps.
  if (status === 'repaid') return done.has('accept') ? 'repay' : undefined
  if (status === 'offered') return 'offer'
  if (status !== 'active') return undefined
  if (marginCallOf(deal)) return 'call'
  // An active loan with no call after one was seen means it was cured.
  if (done.has('call')) return 'cure'
  const mark = view.marks.find((m) => m.streamId === deal.args.valuationStreamId)
  const terms = knownLoan(deal)
  if (mark && isFresh(mark, view.now) && terms && breaches(terms, mark.unitPrice)) return 'stress'
  return 'accept'
}

function knownLoan(deal: Contract): KnownLoan | undefined {
  const a = deal.args
  if (typeof a.valuationStreamId !== 'string') return undefined
  const principal = Number(a.principal)
  const interest = Number(a.interest)
  const repaid = Number(a.amountRepaid ?? 0)
  const outstandingPrincipal = principal - Math.max(0, repaid - interest)
  return { streamId: a.valuationStreamId, outstandingPrincipal, collateral: Number(a.collateralQuantity), threshold: Number(a.liquidationThresholdLtv) }
}

/** Fold one view into the progress so far. Pure; returns a new progress. */
export function advance(progress: TourProgress, view: TourView, track: TourTrack): TourProgress {
  const done = progress.done
  let loan = progress.loan
  if (view.deal && trackOfDeal(view.deal) === track && statusOf(view.deal) === 'active') loan = knownLoan(view.deal) ?? loan
  const next = new Set(done)
  // The loan is gone for a party that would see it: the demo was reset or
  // the loan closed another way, so the loan steps start over.
  if (LOAN_OBSERVERS.has(view.role) && (!view.deal || (trackOfDeal(view.deal) === track && statusOf(view.deal) === 'liquidated' && done.has('accept')))) {
    for (const id of LOAN_STEPS) next.delete(id)
    // The price step is re-earned below only if this view shows a fresh mark.
    next.delete('price')
  }
  const asset = TRACK_ASSET[track]
  const trackMarks = view.marks.filter((m) => m.collateralAsset === asset)
  if (trackMarks.length > 0 && !next.has('offer')) {
    // Before a loan exists, the price step needs a fresh price the default
    // offer can be made at; a stressed or stale one sends the visitor back.
    if (trackMarks.some((m) => isFresh(m, view.now) && m.unitPrice > LENDABLE_PRICE[track])) next.add('price')
    else next.delete('price')
  }
  const reached = observedLoanStep(view, track, next, loan)
  if (reached) {
    next.add('price')
    for (const id of LOAN_STEPS.slice(0, LOAN_STEPS.indexOf(reached) + 1)) next.add(id)
  }
  if (view.role === 'outsider' && next.has('repay')) next.add('privacy')
  if (!next.has('accept')) loan = undefined
  return { done: next, loan }
}

export function currentStep(steps: TourStep[], done: Set<StepId>): TourStep | undefined {
  return steps.find((step) => !done.has(step.id))
}

/** Context-sensitive nudges for the step the visitor is on. */
export function tourHints(step: TourStep | undefined, view: TourView, track: TourTrack): string[] {
  const hints: string[] = []
  const deal = view.deal
  const dealTrack = trackOfDeal(deal)
  if (deal && dealTrack && dealTrack !== track && statusOf(deal) !== 'repaid' && statusOf(deal) !== 'liquidated') {
    hints.push(`The open loan uses ${TRACK_ASSET[dealTrack]}. Switch the tour to that track, or finish that loan first.`)
  }
  if (step?.id === 'price') {
    const marks = view.marks.filter((m) => m.collateralAsset === TRACK_ASSET[track] && isFresh(m, view.now))
    if (marks.length > 0 && marks.every((m) => m.unitPrice <= LENDABLE_PRICE[track])) {
      hints.push('The current price is stressed (an earlier visitor dropped it). Publish a healthy price first.')
    }
  }
  if (step && step.id !== 'price' && step.id !== 'privacy' && step.id !== 'stress' && view.role !== 'outsider') {
    const asset = TRACK_ASSET[track]
    const marks = view.marks.filter((m) => m.collateralAsset === asset)
    if (marks.length > 0 && !marks.some((m) => isFresh(m, view.now))) {
      hints.push('The price is older than five minutes. Continue as Valuer and publish a fresh one, then come back.')
    }
  }
  const call = marginCallOf(deal)
  if (call && Date.parse(call.deadline) <= view.now) {
    hints.push('The margin-call deadline has passed: the lender may now liquidate, or the borrower can still cure if the price recovers.')
  }
  if (deal && statusOf(deal) === 'liquidated') {
    hints.push('This loan was liquidated. Start again from Fund an offer.')
  }
  return hints
}
