// Run with: node --experimental-strip-types --test test/loan-book.test.mjs
// (Node 22.6+; the loan-book helpers are plain TypeScript with no runtime deps.)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBookRows,
  compareRisk,
  fmtCountdown,
  selectDeal,
  summarizeBook,
  toCsv,
  toJson,
} from '../frontend/src/loanBook.ts'

const NOW = Date.parse('2026-09-26T12:00:00Z')
const ISSUER = 'Issuer::1'
const parties = { issuer: ISSUER, lender: 'Lender::1', borrower: 'Borrower::1', regulator: 'Regulator::1', valuationAgent: 'Valuer::1' }
const iso = (msFromNow) => new Date(NOW + msFromNow).toISOString()

let nextOffset = 1
const deal = (template, contractId, args) => ({
  contractId,
  template,
  offset: nextOffset++,
  args: {
    ...parties,
    principal: '100',
    interest: '5',
    collateralQuantity: '150',
    liquidationThresholdLtv: '90',
    maturity: iso(7 * 86400000),
    ...args,
  },
})
const mark = (contractId, streamId, unitPrice, observedAt, collateralAsset = 'Tokenized T-Bill') => ({
  contractId,
  template: 'CollateralValuation',
  offset: nextOffset++,
  args: { ...parties, streamId, unitPrice: String(unitPrice), observedAt, collateralAsset },
})

function fixture() {
  return [
    deal('LoanOffer', 'offer-1', { collateralAsset: 'Tokenized T-Bill', valuationStreamId: 's-offer' }),
    // Healthy: 100 / (150 * 1.0) = 66.7%
    deal('Loan', 'loan-healthy', { collateralAsset: 'Tokenized T-Bill', valuationStreamId: 's-healthy' }),
    mark('m-healthy', 's-healthy', 1.0, iso(-60000)),
    // Breached: 100 / (150 * 0.5) = 133.3%, no margin call yet
    deal('Loan', 'loan-breach', { collateralAsset: 'Tokenized T-Bill', valuationStreamId: 's-breach' }),
    mark('m-breach', 's-breach', 0.5, iso(-60000)),
    // Margin call due in 30s, mark stale
    deal('Loan', 'loan-call-soon', {
      collateralAsset: 'Tokenized T-Bill',
      valuationStreamId: 's-stale',
      marginCall: { issuedAt: iso(-30000), deadline: iso(30000), unitPrice: '0.5' },
    }),
    mark('m-stale', 's-stale', 1.0, iso(-10 * 60000)),
    // Margin call due later, partially repaid Canton Coin loan
    deal('CoinLoan', 'coin-call-later', {
      valuationStreamId: 's-coin',
      allocationCid: 'alloc-1',
      amountRepaid: '25',
      marginCall: { issuedAt: iso(-30000), deadline: iso(120000), unitPrice: '0.5' },
    }),
    mark('m-coin', 's-coin', 1.0, iso(-1000), 'Canton Coin'),
    deal('LoanClosed', 'closed-repaid', { collateralAsset: 'Tokenized T-Bill', reason: 'Repaid' }),
    deal('LoanClosed', 'closed-liq', { collateralAsset: 'Tokenized T-Bill', reason: 'LiquidatedAtMaturity' }),
    deal('LoanClosed', 'closed-wo', { collateralAsset: 'Canton Coin', reason: 'WrittenOff' }),
    // Foreign issuer never enters the book.
    deal('Loan', 'foreign', { issuer: 'Other::9', collateralAsset: 'Tokenized T-Bill' }),
  ]
}

test('builds one row per issuer-matching deal, sorted by risk', () => {
  const rows = buildBookRows(fixture(), ISSUER, NOW)
  assert.deepEqual(rows.map((r) => r.contractId), [
    'loan-breach', 'loan-call-soon', 'coin-call-later', 'loan-healthy', 'offer-1', 'closed-wo', 'closed-liq', 'closed-repaid',
  ])
  const byId = Object.fromEntries(rows.map((r) => [r.contractId, r]))
  assert.equal(byId['loan-breach'].breached, true)
  assert.equal(byId['loan-breach'].ltvState, 'fresh')
  assert.ok(Math.abs(byId['loan-breach'].ltv - 133.333) < 0.01)
  assert.equal(byId['loan-call-soon'].status, 'margin-call')
  assert.equal(byId['loan-call-soon'].ltvState, 'stale')
  assert.equal(byId['loan-call-soon'].ltv, null)
  assert.equal(byId['coin-call-later'].asset, 'Canton Coin')
  assert.equal(byId['coin-call-later'].allocationCid, 'alloc-1')
  // 25 repaid settles the 5 interest first, then 20 of principal.
  assert.equal(byId['coin-call-later'].outstandingPrincipal, 80)
  assert.equal(byId['offer-1'].status, 'offered')
  assert.equal(byId['offer-1'].outstandingPrincipal, 0)
  assert.equal(byId['offer-1'].ltvState, 'missing')
  assert.equal(byId['closed-liq'].status, 'liquidated')
  assert.equal(byId['closed-wo'].status, 'written-off')
  assert.equal(byId['closed-repaid'].ltvState, 'n/a')
})

test('summary covers only open loans', () => {
  const summary = summarizeBook(buildBookRows(fixture(), ISSUER, NOW))
  assert.equal(summary.active, 4)
  assert.equal(summary.inMarginCall, 2)
  assert.equal(summary.totalOutstandingPrincipal, 380)
  assert.ok(Math.abs(summary.worstLtv - 133.333) < 0.01)
  assert.equal(summary.nextDeadline, iso(30000))
})

test('empty book summarises to zeros and nulls', () => {
  assert.deepEqual(summarizeBook([]), { totalOutstandingPrincipal: 0, active: 0, inMarginCall: 0, worstLtv: null, nextDeadline: null })
})

test('compareRisk puts the sooner deadline first within a tier', () => {
  const base = { status: 'margin-call', breached: false, ltv: null, offset: 1 }
  assert.ok(compareRisk({ ...base, marginCallDeadline: iso(1000) }, { ...base, marginCallDeadline: iso(5000) }) < 0)
})

test('fmtCountdown', () => {
  assert.equal(fmtCountdown(iso(65000), NOW), '1m 05s')
  assert.equal(fmtCountdown(iso(2 * 3600000 + 5 * 60000), NOW), '2h 05m')
  assert.equal(fmtCountdown(iso(-1), NOW), 'passed')
  assert.equal(fmtCountdown('nope', NOW), '—')
})

test('selectDeal prefers a visible picked deal and falls back to the latest', () => {
  const contracts = fixture()
  assert.equal(selectDeal(contracts, ISSUER, 'loan-healthy').contractId, 'loan-healthy')
  assert.equal(selectDeal(contracts, ISSUER, 'gone').contractId, 'closed-wo')
  assert.equal(selectDeal(contracts, ISSUER, 'foreign').contractId, 'closed-wo')
  assert.equal(selectDeal(contracts, ISSUER, 'm-healthy').contractId, 'closed-wo')
  assert.equal(selectDeal(contracts, ISSUER, null).contractId, 'closed-wo')
})

test('CSV export carries the ledger-view header, escapes, and neutralises formulas', () => {
  const rows = buildBookRows(fixture(), ISSUER, NOW)
  rows[0].reason = '=HYPERLINK("x")'
  rows[1].asset = 'T-Bill, 3M'
  const meta = { role: 'regulator', partyName: 'Market Supervisor', partyId: 'Regulator::1', offset: 42, generatedAt: iso(0) }
  const csv = toCsv(rows, meta)
  const lines = csv.trimEnd().split('\r\n')
  assert.match(lines[0], /^# Veil loan book: the ledger view of Market Supervisor \(regulator, Regulator::1\) at ledger offset 42/)
  assert.equal(lines.length, 2 + rows.length)
  assert.ok(lines[1].startsWith('contractId,template,status,'))
  assert.ok(lines[2].includes(`"'=HYPERLINK(""x"")"`))
  assert.ok(lines[3].includes('"T-Bill, 3M"'))

  const json = JSON.parse(toJson(rows, summarizeBook(rows), meta))
  assert.equal(json.offset, 42)
  assert.equal(json.rows.length, rows.length)
  assert.equal(json.rows.find((r) => r.contractId === 'loan-call-soon').ltv, null)
})
