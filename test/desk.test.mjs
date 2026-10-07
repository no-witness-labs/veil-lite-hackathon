import test from 'node:test'
import assert from 'node:assert/strict'
import { deskExpired, deskNeedsRepair, deskStreamIds, hasDemoBorrower, onDesk, parseDesk, scopeToDesk } from '../frontend/src/desk.ts'
import { buildBookRows, selectDeal } from '../frontend/src/loanBook.ts'
import { valuationCandidates } from '../frontend/src/state.ts'
import { advance, currentStep, tourSteps } from '../frontend/src/tour.ts'

const NOW = Date.parse('2026-09-29T10:00:00Z')
const fresh = new Date(NOW - 60_000).toISOString()
const parties = { issuer: 'Issuer::1', lender: 'Lender::1', borrower: 'Borrower::1', regulator: 'Regulator::1', valuationAgent: 'Valuer::1' }

let offset = 1
const mark = (streamId, asset, unitPrice = '1') => ({
  contractId: `m-${streamId}`, template: 'CollateralValuation', offset: offset++,
  args: { ...parties, streamId, collateralAsset: asset, unitPrice, observedAt: fresh },
})
const deal = (template, contractId, streamId, extra = {}) => ({
  contractId, template, offset: offset++,
  args: { ...parties, valuationStreamId: streamId, principal: '100', interest: '5', collateralQuantity: '150', liquidationThresholdLtv: '90', collateralAsset: 'Tokenized T-Bill', maturity: new Date(NOW + 7 * 86400000).toISOString(), marginCall: null, ...extra },
})
const desk = (id, streams) => ({ token: `t-${id}`, deskId: id, streams, expiresAt: Math.floor(NOW / 1000) + 3600 })

const A = desk('A', { 'Tokenized T-Bill': 'a-tb', 'Tokenized MMF': 'a-mmf', 'Canton Coin': 'a-cc' })
const B = desk('B', { 'Tokenized T-Bill': 'b-tb', 'Tokenized MMF': 'b-mmf', 'Canton Coin': 'b-cc' })

/** Two visitors on the shared parties, as the lender sees them. */
function ledger() {
  return [
    mark('a-tb', 'Tokenized T-Bill'), mark('a-mmf', 'Tokenized MMF'), mark('a-cc', 'Canton Coin', '0.15'),
    mark('b-tb', 'Tokenized T-Bill', '0.62'), mark('b-mmf', 'Tokenized MMF'), mark('b-cc', 'Canton Coin', '0.15'),
    deal('LoanOffer', 'offer-a', 'a-tb'),
    deal('Loan', 'loan-b', 'b-tb'),
    { contractId: 'sub-b', template: 'SubstitutionRequest', offset: offset++, args: { ...parties, newValuationStreamId: 'b-mmf', newAsset: 'Tokenized MMF', newQuantity: '160' } },
    { contractId: 'cash', template: 'CashHolding', offset: offset++, args: { issuer: parties.issuer, owner: parties.lender, amount: '9900' } },
  ]
}

test('scopeToDesk keeps this desk\'s deals and marks plus shared holdings', () => {
  const ids = (list) => list.map((c) => c.contractId).sort()
  assert.deepEqual(ids(scopeToDesk(ledger(), deskStreamIds(A))), ['cash', 'm-a-cc', 'm-a-mmf', 'm-a-tb', 'offer-a'])
  assert.deepEqual(ids(scopeToDesk(ledger(), deskStreamIds(B))), ['cash', 'loan-b', 'm-b-cc', 'm-b-mmf', 'm-b-tb', 'sub-b'])
  // Without a desk no deal or mark is shown at all.
  assert.deepEqual(ids(scopeToDesk(ledger(), deskStreamIds(null))), ['cash'])
})

test('each visitor\'s position, marks and tour see only their own desk', () => {
  const viewA = scopeToDesk(ledger(), deskStreamIds(A))
  const dealA = selectDeal(viewA, parties.issuer, null)
  assert.equal(dealA.contractId, 'offer-a')
  // Visitor B's loan is the most recent deal on the ledger, but A never picks it,
  // even when asked for it by id (a loan-book click on another desk's row).
  assert.equal(selectDeal(viewA, parties.issuer, 'loan-b').contractId, 'offer-a')
  // B's stressed 0.62 mark does not reach A's price step.
  const marksA = valuationCandidates(viewA)
  assert.ok(marksA.every((m) => m.streamId.startsWith('a-')))
  const progressA = advance({ done: new Set() }, { role: 'lender', deal: dealA, marks: marksA, now: NOW }, 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), progressA.done).id, 'accept')

  const viewB = scopeToDesk(ledger(), deskStreamIds(B))
  const dealB = selectDeal(viewB, parties.issuer, null)
  assert.equal(dealB.contractId, 'loan-b')
  const progressB = advance({ done: new Set() }, { role: 'lender', deal: dealB, marks: valuationCandidates(viewB), now: NOW }, 'tbill')
  assert.equal(currentStep(tourSteps('tbill'), progressB.done).id, 'call')
})

test('loan book lists every deal but marks and sorts this desk first', () => {
  const rows = buildBookRows(ledger(), parties.issuer, NOW, deskStreamIds(A))
  assert.deepEqual(rows.map((r) => [r.contractId, r.mine]), [['offer-a', true], ['loan-b', false]])
  // Without a desk nothing is marked and the risk order stands.
  assert.deepEqual(buildBookRows(ledger(), parties.issuer, NOW).map((r) => r.mine), [false, false])
})

test('onDesk follows each template\'s stream field', () => {
  const ids = deskStreamIds(B)
  assert.equal(onDesk(ledger().find((c) => c.contractId === 'sub-b'), ids), true)
  assert.equal(onDesk({ contractId: 'b-tb', template: 'ValuationStream', offset: 1, args: {} }, ids), true)
  assert.equal(onDesk(deal('LoanClosed', 'closed', 'b-mmf'), ids), true)
  assert.equal(onDesk(deal('LoanClosed', 'closed', 'a-mmf'), ids), false)
})

test('a desk needs repair when a party that sees prices is missing one of its streams', () => {
  assert.equal(deskNeedsRepair(ledger(), A), false)
  assert.equal(deskNeedsRepair(ledger().filter((c) => c.contractId !== 'm-a-mmf'), A), true)
  // After an operator reset nothing is left.
  assert.equal(deskNeedsRepair([], A), true)
})

test('parseDesk validates stored desks; deskExpired keeps a safety margin', () => {
  assert.deepEqual(parseDesk(JSON.parse(JSON.stringify(A))), A)
  assert.equal(parseDesk(null), null)
  assert.equal(parseDesk({ ...A, streams: {} }), null)
  assert.equal(parseDesk({ ...A, streams: { 'Tokenized T-Bill': 5 } }), null)
  assert.equal(parseDesk({ ...A, expiresAt: 'soon' }), null)
  assert.equal(parseDesk({ ...A, token: '' }), null)
  assert.equal(deskExpired(A, NOW), false)
  assert.equal(deskExpired(A, NOW + 3600_000 - 30_000), true)
  assert.equal(deskExpired(A, NOW + 3600_000 - 30_000, 0), false)
})

test('the operator reset leaves alone deals and marks of a non-demo borrower', () => {
  const wallet = 'veil-wallet-1::1220ab'
  const of = (template, args) => ({ contractId: `#${template}`, template, offset: 1, args })
  assert.equal(hasDemoBorrower(of('LoanClosed', { borrower: parties.borrower }), parties.borrower), true)
  assert.equal(hasDemoBorrower(of('CollateralValuation', { borrower: parties.borrower }), parties.borrower), true)
  assert.equal(hasDemoBorrower(of('LoanClosed', { borrower: wallet }), parties.borrower), false)
  assert.equal(hasDemoBorrower(of('CollateralValuation', { borrower: wallet }), parties.borrower), false)
  // Contracts without a borrower (holdings) stay in scope.
  assert.equal(hasDemoBorrower(of('CashHolding', { owner: parties.lender }), parties.borrower), true)
})
