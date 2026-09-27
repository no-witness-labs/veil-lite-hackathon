import test from 'node:test'
import assert from 'node:assert/strict'
import { advance, currentStep, tourHints, tourSteps } from '../frontend/src/tour.ts'

const NOW = Date.parse('2026-09-27T10:00:00Z')
const fresh = new Date(NOW - 60_000).toISOString()
const stale = new Date(NOW - 10 * 60_000).toISOString()
const mark = (asset, unitPrice, observedAt = fresh, streamId = `s-${asset}`) => ({ contractId: `m-${asset}`, unitPrice, observedAt, collateralAsset: asset, streamId, valuationAgent: 'V', lender: 'L', borrower: 'B', regulator: 'R', offset: 1 })
const loan = (template, over = {}) => ({
  contractId: 'c1', template, offset: 1,
  args: { principal: '100', interest: '5', collateralQuantity: template.startsWith('Coin') ? '1000' : '150', liquidationThresholdLtv: '90', valuationStreamId: template.startsWith('Coin') ? 's-Canton Coin' : 's-Tokenized T-Bill', collateralAsset: template.startsWith('Coin') ? undefined : 'Tokenized T-Bill', marginCall: null, ...over },
})
const view = (role, deal, marks = [], now = NOW) => ({ role, deal, marks, now })
const ids = (p) => [...p.done].sort()

test('a fresh price on the track asset completes the first step', () => {
  const done = advance({ done: new Set() }, view('valuer', undefined, [mark('Tokenized T-Bill', 1)]), 'tbill')
  assert.deepEqual(ids(done), ['price'])
  assert.equal(currentStep(tourSteps('tbill'), done.done).id, 'offer')
})

test('the loan stage fills every earlier step, whichever party sees it', () => {
  const offered = advance({ done: new Set() }, view('borrower', loan('LoanOffer')), 'tbill')
  assert.deepEqual(ids(offered), ['offer', 'price'])
  const breached = advance(offered, view('lender', loan('Loan'), [mark('Tokenized T-Bill', 0.62)]), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), breached.done).id, 'call')
  const called = advance(breached, view('borrower', loan('Loan', { marginCall: { issuedAt: fresh, deadline: new Date(NOW + 60_000).toISOString(), unitPrice: '0.62' } })), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), called.done).id, 'cure')
  const cured = advance(called, view('borrower', loan('Loan')), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), cured.done).id, 'repay')
  const repaid = advance(cured, view('regulator', loan('LoanClosed', { reason: 'Repaid' })), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), repaid.done).id, 'privacy')
  const all = advance(repaid, view('outsider', undefined), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), all.done), undefined)
})

test('parties that cannot see the loan never move or rewind it', () => {
  const offered = advance({ done: new Set(['price']) }, view('lender', loan('LoanOffer')), 'tbill')
  assert.deepEqual(ids(advance(offered, view('valuer', undefined, [mark('Tokenized T-Bill', 1)]), 'tbill')), ids(offered))
  assert.deepEqual(ids(advance(offered, view('outsider', undefined), 'tbill')), ids(offered))
})

test('a reset (no loan for a party that would see it) rewinds the loan steps', () => {
  const active = advance({ done: new Set() }, view('borrower', loan('Loan')), 'tbill')
  const reset = advance(active, view('lender', undefined), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), reset.done).id, 'price')
})

test('a loan on the other track does not count, and is pointed out', () => {
  const coinLoan = loan('CoinLoan')
  assert.deepEqual(ids(advance({ done: new Set() }, view('lender', coinLoan), 'tbill')), [])
  const hints = tourHints(tourSteps('tbill')[1], view('lender', coinLoan), 'tbill')
  assert.ok(hints.some((h) => /Canton Coin/.test(h)))
})

test('the coin track follows a CoinLoan', () => {
  const done = advance({ done: new Set() }, view('borrower', loan('CoinLoan'), [mark('Canton Coin', 0.11)]), 'coin')
  assert.equal(currentStep(tourSteps('coin'), done.done).id, 'call')
})

test('a stale price and an expired call produce hints', () => {
  const steps = tourSteps('tbill')
  const staleHints = tourHints(steps[2], view('borrower', loan('LoanOffer'), [mark('Tokenized T-Bill', 1, stale)]), 'tbill')
  assert.ok(staleHints.some((h) => /older than five minutes/.test(h)))
  const expired = loan('Loan', { marginCall: { issuedAt: stale, deadline: new Date(NOW - 1000).toISOString(), unitPrice: '0.62' } })
  assert.ok(tourHints(steps[5], view('lender', expired), 'tbill').some((h) => /deadline has passed/.test(h)))
})

test('the valuer view completes the stress step from the remembered loan terms', () => {
  const active = advance({ done: new Set() }, view('borrower', loan('Loan'), [mark('Tokenized T-Bill', 1)]), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), active.done).id, 'stress')
  const healthy = advance(active, view('valuer', undefined, [mark('Tokenized T-Bill', 0.95)]), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), healthy.done).id, 'stress')
  const stressed = advance(active, view('valuer', undefined, [mark('Tokenized T-Bill', 0.62)]), 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), stressed.done).id, 'call')
})

test('a repaid Canton Coin loan completes the coin track', () => {
  const called = advance({ done: new Set(['price', 'offer', 'accept', 'stress', 'call', 'cure']) }, view('borrower', loan('CoinLoan')), 'coin')
  const closed = { contractId: 'c2', template: 'LoanClosed', offset: 2, args: { reason: 'Repaid', collateralAsset: 'Canton Coin', collateralQuantity: '1000' } }
  const repaid = advance(called, view('regulator', closed), 'coin')
  assert.equal(currentStep(tourSteps('coin'), repaid.done).id, 'privacy')
  // The same closed record does not count for the T-Bill track.
  assert.equal(currentStep(tourSteps('tbill'), advance({ done: new Set() }, view('regulator', closed), 'tbill').done).id, 'price')
})
