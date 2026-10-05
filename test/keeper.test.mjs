import test, { afterEach, beforeEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide, loanLtv, formatDecimal } from '../scripts/keeper-lib.mjs'
import { ConfigError, HttpError, classifySubmitError, createKeeper, parseConfig, runOperator } from '../scripts/keeper.mjs'
import { JournalError, openJournal } from '../scripts/keeper/journal.mjs'

const NOW = Date.parse('2026-09-26T12:00:00.000Z')
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString()
const HOUR = 3_600_000
const DAY = 24 * HOUR

const P = {
  issuer: 'Issuer::1',
  lender: 'Lender::1',
  borrower: 'Borrower::1',
  regulator: 'Regulator::1',
  valuer: 'Valuer::1',
  dso: 'DSO::1',
}

function tbillLoan(over = {}) {
  return {
    contractId: 'loan-1',
    template: 'Loan',
    args: {
      issuer: P.issuer, lender: P.lender, borrower: P.borrower, regulator: P.regulator,
      valuationAgent: P.valuer, valuationStreamId: 'stream-tbill',
      principal: '100.0000000000', interest: '5.0000000000',
      collateralAsset: 'Tokenized T-Bill', collateralQuantity: '150.0000000000',
      maturity: iso(30 * DAY), liquidationThresholdLtv: '80.0000000000', marginCallWindowSeconds: '300',
      marginCall: null, collateralLocked: true, amountRepaid: null,
      ...over,
    },
  }
}

function coinLoan(over = {}) {
  return {
    contractId: 'coin-loan-1',
    template: 'CoinLoan',
    args: {
      issuer: P.issuer, lender: P.lender, borrower: P.borrower, regulator: P.regulator,
      valuationAgent: P.valuer, valuationStreamId: 'stream-cc', coinAdmin: P.dso,
      principal: '100.0000000000', interest: '5.0000000000', collateralQuantity: '1000.0000000000',
      maturity: iso(30 * DAY), liquidationThresholdLtv: '80.0000000000', marginCallWindowSeconds: '300',
      settlementRef: 'veil-123', allocationCid: 'alloc-borrower',
      marginCall: null, amountRepaid: null,
      ...over,
    },
  }
}

function mark(streamId, unitPrice, observedAt = iso(-60_000), over = {}) {
  return {
    contractId: `mark-${streamId}`,
    args: {
      valuationAgent: P.valuer, lender: P.lender, borrower: P.borrower, regulator: P.regulator,
      collateralAsset: streamId === 'stream-cc' ? 'Canton Coin' : 'Tokenized T-Bill',
      streamId, unitPrice, observedAt, ...over,
    },
  }
}

const kinds = (actions) => actions.map((a) => a.kind)
const openCall = (deadline) => ({ issuedAt: iso(-10 * 60_000), deadline, unitPrice: '0.7000000000' })

describe('decide', () => {
  test('healthy loan on a fresh mark is a no-op hold', () => {
    const actions = decide([tbillLoan()], [mark('stream-tbill', '1.0')], NOW)
    assert.deepEqual(kinds(actions), ['hold'])
    assert.equal(actions[0].reason, 'healthy')
    assert.equal(actions[0].ltv, '66.6667')
  })

  test('breach with no open call issues a margin call', () => {
    // 100 / (150 * 0.8) = 83.33% >= 80%
    const [action] = decide([tbillLoan()], [mark('stream-tbill', '0.8')], NOW)
    assert.equal(action.kind, 'issueMarginCall')
    assert.equal(action.choice, 'IssueMarginCall')
    assert.equal(action.valuationCid, 'mark-stream-tbill')
    assert.equal(action.ltv, '83.3333')
  })

  test('breach exactly at the threshold counts, as on the ledger', () => {
    // 120 / (150 * 1.0) * 100 = 80.0
    const [action] = decide([tbillLoan({ principal: '120.0' })], [mark('stream-tbill', '1.0')], NOW)
    assert.equal(action.kind, 'issueMarginCall')
  })

  test('open call before its deadline is a no-op, even if breached', () => {
    const loan = tbillLoan({ marginCall: openCall(iso(60_000)) })
    const actions = decide([loan], [mark('stream-tbill', '0.5')], NOW)
    assert.deepEqual(kinds(actions), ['hold'])
    assert.match(actions[0].reason, /open until/)
  })

  test('expired call and still breached liquidates', () => {
    const loan = tbillLoan({ marginCall: openCall(iso(-60_000)) })
    const [action] = decide([loan], [mark('stream-tbill', '0.7')], NOW)
    assert.equal(action.kind, 'liquidate')
    assert.equal(action.choice, 'Liquidate')
    assert.equal(action.valuationCid, 'mark-stream-tbill')
  })

  test('expired call inside the skew margin waits', () => {
    const loan = tbillLoan({ marginCall: openCall(iso(-2_000)) })
    assert.deepEqual(kinds(decide([loan], [mark('stream-tbill', '0.7')], NOW)), ['hold'])
  })

  test('expired call but recovered price is a no-op', () => {
    const loan = tbillLoan({ marginCall: openCall(iso(-60_000)) })
    const actions = decide([loan], [mark('stream-tbill', '1.0')], NOW)
    assert.deepEqual(kinds(actions), ['hold'])
    assert.match(actions[0].reason, /recovered/)
  })

  test('stale mark never triggers an action', () => {
    const stale = mark('stream-tbill', '0.5', iso(-301_000))
    const actions = decide([tbillLoan()], [stale], NOW)
    assert.deepEqual(kinds(actions), ['needsFreshPrice'])
    const expired = decide([tbillLoan({ marginCall: openCall(iso(-60_000)) })], [stale], NOW)
    assert.deepEqual(kinds(expired), ['needsFreshPrice'])
  })

  test('mark within the skew margin of going stale is treated as stale', () => {
    const edge = mark('stream-tbill', '0.5', iso(-297_000))
    assert.deepEqual(kinds(decide([tbillLoan()], [edge], NOW)), ['needsFreshPrice'])
  })

  test('missing, foreign-stream or ambiguous marks need a fresh price', () => {
    assert.deepEqual(kinds(decide([tbillLoan()], [], NOW)), ['needsFreshPrice'])
    assert.deepEqual(kinds(decide([tbillLoan()], [mark('stream-other', '0.5')], NOW)), ['needsFreshPrice'])
    const foreignValuer = mark('stream-tbill', '0.5', iso(-60_000), { valuationAgent: 'Other::1' })
    assert.deepEqual(kinds(decide([tbillLoan()], [foreignValuer], NOW)), ['needsFreshPrice'])
    const twin = { ...mark('stream-tbill', '0.5'), contractId: 'mark-twin' }
    const [action] = decide([tbillLoan()], [mark('stream-tbill', '0.5'), twin], NOW)
    assert.equal(action.kind, 'needsFreshPrice')
    assert.match(action.reason, /ambiguous/)
  })

  test('past maturity liquidates a T-Bill loan as overdue on a fresh mark', () => {
    const [action] = decide([tbillLoan({ maturity: iso(-60_000) })], [mark('stream-tbill', '1.0')], NOW)
    assert.equal(action.kind, 'liquidateOverdue')
    assert.equal(action.choice, 'LiquidateOverdue')
    assert.equal(action.valuationCid, 'mark-stream-tbill')
  })

  test('past maturity without a fresh mark asks for a price instead of failing on-ledger', () => {
    // 0.9.0 returns surplus collateral at the attested price, so overdue
    // liquidation of a T-Bill loan needs a fresh mark.
    const [none] = decide([tbillLoan({ maturity: iso(-60_000) })], [], NOW)
    assert.equal(none.kind, 'needsFreshPrice')
    assert.match(none.reason, /past maturity/)
    const [stale] = decide([tbillLoan({ maturity: iso(-60_000) })], [mark('stream-tbill', '1.0', iso(-10 * 60_000))], NOW)
    assert.equal(stale.kind, 'needsFreshPrice')
  })

  test('at maturity (within skew) no margin call is issued', () => {
    const actions = decide([tbillLoan({ maturity: iso(2_000) })], [mark('stream-tbill', '0.5')], NOW)
    assert.deepEqual(kinds(actions), ['hold'])
  })

  test('CoinLoan: breach, expiry and overdue map to the coin choices', () => {
    // 100 / (1000 * 0.12) = 83.3%
    const cc = mark('stream-cc', '0.12')
    assert.equal(decide([coinLoan()], [cc], NOW)[0].choice, 'IssueCoinMarginCall')
    const expired = coinLoan({ marginCall: openCall(iso(-60_000)) })
    assert.equal(decide([expired], [cc], NOW)[0].choice, 'LiquidateCoin')
    const overdue = decide([coinLoan({ maturity: iso(-HOUR) })], [], NOW)
    assert.deepEqual(kinds(overdue), ['liquidateOverdue'])
    assert.equal(overdue[0].choice, 'LiquidateCoinOverdue')
  })

  test('CoinLoan near its settlement deadline warns loudly', () => {
    // settlement deadline = maturity + 1 day = now + 4h
    const actions = decide([coinLoan({ maturity: iso(4 * HOUR - DAY) })], [], NOW)
    assert.deepEqual(kinds(actions), ['warnSettlementDeadline', 'liquidateOverdue'])
    assert.equal(actions[0].hoursLeft, 4)
    const passed = decide([coinLoan({ maturity: iso(-2 * DAY) })], [], NOW)
    assert.match(passed[0].reason, /has passed/)
    const far = decide([coinLoan({ maturity: iso(-HOUR) })], [], NOW)
    assert.deepEqual(kinds(far), ['liquidateOverdue'])
    const custom = decide([coinLoan({ maturity: iso(-HOUR) })], [], NOW, { settlementWarnHours: 24 })
    assert.deepEqual(kinds(custom), ['warnSettlementDeadline', 'liquidateOverdue'])
  })

  test('CoinLoan past its settlement deadline is closed as lapsed, not liquidated', () => {
    const lapsed = decide([coinLoan({ maturity: iso(-DAY - 60_000) })], [], NOW)
    assert.deepEqual(kinds(lapsed), ['warnSettlementDeadline', 'closeLapsed'])
    assert.equal(lapsed[1].choice, 'CloseLapsedCoinLoan')
    // Within the skew margin of the deadline the lock may still settle.
    const atDeadline = decide([coinLoan({ maturity: iso(-DAY - 2_000) })], [], NOW)
    assert.deepEqual(kinds(atDeadline), ['warnSettlementDeadline', 'liquidateOverdue'])
  })

  test('collateral value that rounds to zero is a breach, not an invalid loan', () => {
    // 0.1 x 0.0000000001 = 0 at 10 places; the ledger cross-multiplies (0.10.0).
    const actions = decide([tbillLoan({ collateralQuantity: '0.1' })], [mark('stream-tbill', '0.0000000001')], NOW)
    assert.deepEqual(kinds(actions), ['issueMarginCall'])
    assert.equal(actions[0].ltv, 'unbounded')
    assert.equal(loanLtv({ principal: '1', interest: '0', amountRepaid: null, collateralQuantity: '0.1' }, '0.0000000001'), null)
  })

  test('partial repayment reduces outstanding principal only beyond interest', () => {
    const price = mark('stream-tbill', '0.8') // collateral value 120
    // repaid 3 <= interest 5: outstanding stays 100 -> 83.3% breach
    const interestOnly = decide([tbillLoan({ amountRepaid: '3.0' })], [price], NOW)[0]
    assert.equal(interestOnly.kind, 'issueMarginCall')
    assert.equal(interestOnly.outstandingPrincipal, '100.0000')
    // repaid 15: 10 over interest -> outstanding 90 -> 75% healthy
    const paidDown = decide([tbillLoan({ amountRepaid: '15.0' })], [price], NOW)[0]
    assert.equal(paidDown.kind, 'hold')
    assert.equal(paidDown.outstandingPrincipal, '90.0000')
    assert.equal(paidDown.ltv, '75.0000')
  })

  test('LTV rounds like Daml Numeric 10', () => {
    assert.equal(formatDecimal(loanLtv({ principal: '1', interest: '0', amountRepaid: null, collateralQuantity: '3' }, '1'), 10), '33.3333333300')
  })

  test('malformed loan is reported, not thrown', () => {
    const actions = decide([tbillLoan({ maturity: 'soon' }), tbillLoan()], [mark('stream-tbill', '1.0')], NOW)
    assert.deepEqual(kinds(actions), ['invalid', 'hold'])
  })
})

// ------------------------------------------------------------------ I/O --

const LEDGER = 'http://ledger.test'
const REGISTRY = 'http://registry.test'
const originalFetch = globalThis.fetch
let calls
let routes
// Requests nothing scripted for. The keeper would treat the resulting throw as
// an unknown outcome, so tests assert this stays empty instead.
let unscripted
let stateDirs

beforeEach(() => {
  calls = []
  routes = []
  unscripted = []
  stateDirs = []
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(init.body) : undefined
    const call = { url: String(url), method: init.method ?? 'GET', body, headers: init.headers }
    calls.push(call)
    const route = routes.find((r) => r.match(call))
    if (!route) {
      unscripted.push(`${call.method} ${call.url}`)
      throw new Error(`unexpected fetch ${call.method} ${call.url}`)
    }
    const reply = typeof route.reply === 'function' ? await route.reply(call) : route.reply
    if (reply.throw) throw reply.throw
    const { status = 200, json } = reply
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const dir of stateDirs) rmSync(dir, { recursive: true, force: true })
})

function tempStateDir() {
  const dir = mkdtempSync(join(tmpdir(), 'veil-keeper-test-'))
  stateDirs.push(dir)
  return dir
}

const acsEntry = (templateId, contractId, createArgument) => ({
  contractEntry: { JsActiveContract: { createdEvent: { templateId, contractId, createArgument } } },
})

function ledgerState(contracts) {
  routes.push(
    { match: (c) => c.url === `${LEDGER}/v2/state/ledger-end`, reply: { json: { offset: 42 } } },
    {
      match: (c) => c.url === `${LEDGER}/v2/state/active-contracts` && c.body.filter.filtersByParty[P.lender].cumulative[0].identifierFilter.WildcardFilter,
      reply: { json: contracts },
    },
  )
}

function keeper(execute, over = {}, { clock = { now: NOW }, configure = () => {} } = {}) {
  const config = parseConfig(execute ? ['--execute'] : [], {
    VEIL_LEDGER_TARGET: LEDGER,
    VEIL_REGISTRY_URL: REGISTRY,
    VEIL_PARTY_LENDER: P.lender,
    VEIL_PARTY_VALUER: P.valuer,
    VEIL_PARTY_ISSUER: P.issuer,
    VEIL_LEDGER_USER_ID: 'team-user',
    VEIL_KEEPER_BEARER: 'test-token',
    VEIL_KEEPER_STATE_DIR: tempStateDir(),
    ...over,
  })
  configure(config)
  const events = []
  const now = () => clock.now
  return { k: createKeeper(config, { now, emit: (e) => events.push(e) }), events, config, journal: openJournal(config.stateDir, { now }) }
}

const submits = () => calls.filter((c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'))

describe('keeper I/O', () => {
  test('dry-run prints decisions and submits nothing', async () => {
    const loan = tbillLoan()
    ledgerState([
      acsEntry('pkg:Veil:Loan', loan.contractId, loan.args),
      acsEntry('pkg:Veil:CollateralValuation', 'mark-stream-tbill', mark('stream-tbill', '0.8').args),
      acsEntry('pkg:Veil:CoinLoan', 'coin-overdue', coinLoan({ maturity: iso(-HOUR) }).args),
    ])
    const { k, events } = keeper(false)
    const summary = await k.tick()
    assert.equal(submits().length, 0)
    assert.ok(calls.every((c) => c.url.startsWith(LEDGER)), 'dry-run must not call the registry')
    assert.deepEqual(summary, { decisions: 2, submitted: 0, benign: 0, errors: 0, proposed: 0, blocked: 0, unknown: 0 })
    const decisions = events.filter((e) => e.event === 'decision')
    assert.deepEqual(decisions.map((d) => [d.kind, d.mode]), [['issueMarginCall', 'dry-run'], ['liquidateOverdue', 'dry-run']])
    assert.equal(calls[0].headers.Authorization, 'Bearer test-token')
  })

  test('execute submits the exact T-Bill margin call command', async () => {
    const loan = tbillLoan()
    ledgerState([
      acsEntry('pkg:Veil:Loan', loan.contractId, loan.args),
      acsEntry('pkg:Veil:CollateralValuation', 'mark-stream-tbill', mark('stream-tbill', '0.8').args),
    ])
    routes.push({ match: (c) => c.url === `${LEDGER}/v2/commands/submit-and-wait-for-transaction`, reply: { json: { transaction: { updateId: 'u1', events: [] } } } })
    const { k, events } = keeper(true)
    await k.tick()
    const [submit] = submits()
    assert.equal(submit.method, 'POST')
    const { commands } = submit.body
    assert.deepEqual(commands.commands, [{
      ExerciseCommand: { templateId: '#veil-lite:Veil:Loan', contractId: 'loan-1', choice: 'IssueMarginCall', choiceArgument: { valuationCid: 'mark-stream-tbill' } },
    }])
    assert.deepEqual(commands.actAs, [P.lender])
    assert.equal(commands.userId, 'team-user')
    assert.match(commands.commandId, /^veil-keeper-issueMarginCall-[0-9a-f]{32}$/)
    assert.equal(commands.disclosedContracts, undefined)
    assert.ok(events.some((e) => e.event === 'submitted' && e.updateId === 'u1'))
  })

  test('execute submits LiquidateOverdue with the fresh mark', async () => {
    const loan = tbillLoan({ maturity: iso(-HOUR) })
    const m = mark('stream-tbill', '1.0')
    ledgerState([acsEntry('pkg:Veil:Loan', loan.contractId, loan.args), acsEntry('pkg:Veil:CollateralValuation', m.contractId, m.args)])
    routes.push({ match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'), reply: { json: { transaction: { updateId: 'u2', events: [] } } } })
    await keeper(true).k.tick()
    assert.deepEqual(submits()[0].body.commands.commands[0].ExerciseCommand, {
      templateId: '#veil-lite:Veil:Loan', contractId: 'loan-1', choice: 'LiquidateOverdue', choiceArgument: { valuationCid: 'mark-stream-tbill' },
    })
  })

  test('CoinLoan liquidation: receipt, settlement context and disclosed contracts', async () => {
    const loan = coinLoan({ marginCall: openCall(iso(-60_000)) })
    ledgerState([
      acsEntry('pkg:Veil:CoinLoan', loan.contractId, loan.args),
      acsEntry('pkg:Veil:CollateralValuation', 'mark-stream-cc', mark('stream-cc', '0.12').args),
    ])
    // No reusable receipt from an earlier attempt.
    routes.push({ match: (c) => c.url.endsWith('/v2/state/active-contracts') && c.body.filter.filtersByParty[P.lender].cumulative[0].identifierFilter.InterfaceFilter, reply: { json: [] } })
    const allocDisclosed = { templateId: 'splice:AllocationFactory', contractId: 'factory-1', createdEventBlob: 'blob-a', synchronizerId: 'sync::1', debugPayload: { x: 1 } }
    const settleDisclosed = { templateId: 'splice:AmuletRules', contractId: 'rules-1', createdEventBlob: 'blob-s', synchronizerId: 'sync::1' }
    routes.push(
      { match: (c) => c.url === `${REGISTRY}/registry/allocation-instruction/v2/allocation-factory`, reply: { json: { factoryId: 'factory-1', choiceContext: { choiceContextData: { values: { a: 1 } }, disclosedContracts: [allocDisclosed] } } } },
      { match: (c) => c.url === `${REGISTRY}/registry/allocation/v2/settlement-factory`, reply: { json: { factoryId: 'settle-1', choiceContext: { choiceContextData: { values: { s: 1 } }, disclosedContracts: [settleDisclosed] } } } },
      {
        match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'),
        reply: (c) => c.body.commands.commands[0].ExerciseCommand.choice === 'PrepareCoinReceipt'
          ? { json: { transaction: { updateId: 'u-prep', events: [{ CreatedEvent: { templateId: 'splice:Splice.AmuletAllocation:AmuletAllocation', contractId: 'receipt-1' } }] } } }
          : { json: { transaction: { updateId: 'u-liq', events: [] } } },
      },
    )
    const { k, events } = keeper(true)
    const summary = await k.tick()
    assert.deepEqual(summary, { decisions: 1, submitted: 1, benign: 0, errors: 0, proposed: 0, blocked: 0, unknown: 0 })

    const [prepare, liquidate] = submits().map((c) => c.body.commands)
    assert.deepEqual(prepare.commands[0].ExerciseCommand, {
      templateId: '#veil-lite:Veil:CoinLoan', contractId: 'coin-loan-1', choice: 'PrepareCoinReceipt',
      choiceArgument: { allocationFactoryCid: 'factory-1', extraArgs: { context: { values: { a: 1 } }, meta: { values: {} } } },
    })
    assert.deepEqual(prepare.actAs, [P.lender])
    assert.deepEqual(prepare.disclosedContracts, [{ templateId: 'splice:AllocationFactory', contractId: 'factory-1', createdEventBlob: 'blob-a', synchronizerId: 'sync::1' }])

    const allocReq = calls.find((c) => c.url.endsWith('/allocation-factory')).body
    assert.equal(allocReq.choiceArguments.allocation.authorizer.owner, P.lender)
    assert.equal(allocReq.choiceArguments.allocation.committed, false)
    assert.equal(allocReq.choiceArguments.allocation.transferLegSides[0].side, 'ReceiverSide')
    assert.equal(allocReq.choiceArguments.allocation.settlementDeadline, new Date(Date.parse(loan.args.maturity) + DAY).toISOString())
    assert.deepEqual(allocReq.choiceArguments.settlement, { executors: [P.lender], id: 'veil-123', cid: null, meta: { values: {} } })

    const settleReq = calls.find((c) => c.url.endsWith('/settlement-factory')).body
    assert.deepEqual(settleReq.choiceArguments.allocations.map((a) => a.allocationCid), ['alloc-borrower', 'receipt-1'])
    assert.deepEqual(settleReq.choiceArguments.transferLegs[0].sender.owner, P.borrower)

    assert.deepEqual(liquidate.commands[0].ExerciseCommand, {
      templateId: '#veil-lite:Veil:CoinLoan', contractId: 'coin-loan-1', choice: 'LiquidateCoin',
      choiceArgument: {
        valuationCid: 'mark-stream-cc', settlementFactoryCid: 'settle-1', receiptAllocationCid: 'receipt-1',
        extraArgs: { context: { values: { s: 1 } }, meta: { values: {} } },
      },
    })
    assert.deepEqual(liquidate.actAs, [P.lender])
    assert.equal(liquidate.userId, 'team-user')
    assert.deepEqual(liquidate.disclosedContracts, [settleDisclosed])
    assert.ok(calls.every((c) => c.headers.Authorization === 'Bearer test-token'))
    assert.ok(events.some((e) => e.event === 'receipt' && e.reused === false))
  })

  test('CoinLoan overdue reuses an earlier receipt allocation', async () => {
    const loan = coinLoan({ maturity: iso(-HOUR) })
    ledgerState([acsEntry('pkg:Veil:CoinLoan', loan.contractId, loan.args)])
    const view = {
      settlement: { executors: [P.lender], id: 'veil-123', cid: null, meta: { values: {} } },
      allocation: {
        authorizer: { owner: P.lender, provider: null, id: '' },
        transferLegSides: [{ transferLegId: 'collateral', side: 'ReceiverSide', otherside: { owner: P.borrower, provider: null, id: '' }, amount: '1000.0000000000', instrumentId: 'Amulet', meta: { values: {} } }],
      },
    }
    routes.push(
      { match: (c) => c.url.endsWith('/v2/state/active-contracts') && c.body.filter.filtersByParty[P.lender].cumulative[0].identifierFilter.InterfaceFilter, reply: { json: [{ contractEntry: { JsActiveContract: { createdEvent: { templateId: 'splice:X:AmuletAllocation', contractId: 'receipt-old', interfaceViews: [{ viewValue: view }] } } } }] } },
      { match: (c) => c.url.endsWith('/settlement-factory'), reply: { json: { factoryId: 'settle-1', choiceContext: { choiceContextData: {}, disclosedContracts: [] } } } },
      { match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'), reply: { json: { transaction: { updateId: 'u', events: [] } } } },
    )
    await keeper(true).k.tick()
    assert.equal(calls.filter((c) => c.url.endsWith('/allocation-factory')).length, 0)
    const [only] = submits()
    const ex = only.body.commands.commands[0].ExerciseCommand
    assert.equal(ex.choice, 'LiquidateCoinOverdue')
    assert.equal(ex.choiceArgument.receiptAllocationCid, 'receipt-old')
    assert.equal(ex.choiceArgument.valuationCid, undefined)
  })

  test('CoinLoan opened by 0.10.0: receipt and batch name both executors; a lender-only receipt is not reused', async () => {
    const loan = coinLoan({ maturity: iso(-HOUR), settlementExecutors: [P.lender, P.borrower] })
    ledgerState([acsEntry('pkg:Veil:CoinLoan', loan.contractId, loan.args)])
    const legacyReceipt = {
      settlement: { executors: [P.lender], id: 'veil-123', cid: null, meta: { values: {} } },
      allocation: {
        authorizer: { owner: P.lender, provider: null, id: '' },
        transferLegSides: [{ transferLegId: 'collateral', side: 'ReceiverSide', otherside: { owner: P.borrower, provider: null, id: '' }, amount: '1000.0000000000', instrumentId: 'Amulet', meta: { values: {} } }],
      },
    }
    routes.push(
      { match: (c) => c.url.endsWith('/v2/state/active-contracts') && c.body.filter.filtersByParty[P.lender].cumulative[0].identifierFilter.InterfaceFilter, reply: { json: [{ contractEntry: { JsActiveContract: { createdEvent: { templateId: 'splice:X:AmuletAllocation', contractId: 'receipt-old', interfaceViews: [{ viewValue: legacyReceipt }] } } } }] } },
      { match: (c) => c.url.endsWith('/allocation-factory'), reply: { json: { factoryId: 'factory-1', choiceContext: { choiceContextData: {}, disclosedContracts: [] } } } },
      { match: (c) => c.url.endsWith('/settlement-factory'), reply: { json: { factoryId: 'settle-1', choiceContext: { choiceContextData: {}, disclosedContracts: [] } } } },
      {
        match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'),
        reply: (c) => c.body.commands.commands[0].ExerciseCommand.choice === 'PrepareCoinReceipt'
          ? { json: { transaction: { updateId: 'u-prep', events: [{ CreatedEvent: { templateId: 'splice:Splice.AmuletAllocation:AmuletAllocation', contractId: 'receipt-new' } }] } } }
          : { json: { transaction: { updateId: 'u-liq', events: [] } } },
      },
    )
    await keeper(true).k.tick()
    const joint = { executors: [P.lender, P.borrower], id: 'veil-123', cid: null, meta: { values: {} } }
    const allocReq = calls.find((c) => c.url.endsWith('/allocation-factory')).body
    assert.deepEqual(allocReq.choiceArguments.settlement, joint)
    assert.deepEqual(allocReq.choiceArguments.actors, [P.lender])
    const settleReq = calls.find((c) => c.url.endsWith('/settlement-factory')).body
    assert.deepEqual(settleReq.choiceArguments.settlement, joint)
    assert.deepEqual(settleReq.choiceArguments.actors, [P.lender, P.borrower])
    assert.deepEqual(settleReq.choiceArguments.allocations.map((a) => a.allocationCid), ['alloc-borrower', 'receipt-new'])
    const [, liquidate] = submits().map((c) => c.body.commands)
    assert.equal(liquidate.commands[0].ExerciseCommand.choice, 'LiquidateCoinOverdue')
    // The CoinLoan's signatories carry the borrower's authority on-ledger.
    assert.deepEqual(liquidate.actAs, [P.lender])
  })

  test('lapsed CoinLoan is closed with CloseLapsedCoinLoan and no registry call', async () => {
    const loan = coinLoan({ maturity: iso(-2 * DAY), settlementExecutors: [P.lender, P.borrower] })
    ledgerState([acsEntry('pkg:Veil:CoinLoan', loan.contractId, loan.args)])
    routes.push({ match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'), reply: { json: { transaction: { updateId: 'u-lapse', events: [] } } } })
    const summary = await keeper(true).k.tick()
    assert.equal(summary.submitted, 1)
    assert.ok(calls.every((c) => c.url.startsWith(LEDGER)), 'a lapsed close must not call the registry')
    assert.deepEqual(submits()[0].body.commands.commands[0].ExerciseCommand, {
      templateId: '#veil-lite:Veil:CoinLoan', contractId: 'coin-loan-1', choice: 'CloseLapsedCoinLoan', choiceArgument: {},
    })
  })

  test('already-consumed contract is benign; other failures are errors', async () => {
    const a = tbillLoan({ maturity: iso(-HOUR) })
    const b = { ...tbillLoan({ maturity: iso(-HOUR) }), contractId: 'loan-2' }
    const m = mark('stream-tbill', '1.0')
    ledgerState([acsEntry('pkg:Veil:Loan', a.contractId, a.args), acsEntry('pkg:Veil:Loan', b.contractId, b.args), acsEntry('pkg:Veil:CollateralValuation', m.contractId, m.args)])
    routes.push({
      match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'),
      reply: (c) => c.body.commands.commands[0].ExerciseCommand.contractId === 'loan-1'
        ? { status: 404, json: { code: 'CONTRACT_NOT_FOUND', cause: 'Contract could not be found' } }
        : { status: 400, json: { code: 'DAML_FAILURE', cause: 'loan is not past maturity' } },
    })
    const { k, events } = keeper(true)
    const summary = await k.tick()
    assert.deepEqual(summary, { decisions: 2, submitted: 0, benign: 1, errors: 1, proposed: 0, blocked: 0, unknown: 0 })
    assert.ok(events.some((e) => e.event === 'superseded' && e.loanCid === 'loan-1'))
    assert.ok(events.some((e) => e.event === 'error' && e.loanCid === 'loan-2'))
  })

  test('loans of another issuer or lender are not acted on', async () => {
    const other = tbillLoan({ issuer: 'Other::1', maturity: iso(-HOUR) })
    const notMine = { ...tbillLoan({ lender: 'Lender::2', maturity: iso(-HOUR) }), contractId: 'loan-x' }
    ledgerState([acsEntry('pkg:Veil:Loan', other.contractId, other.args), acsEntry('pkg:Veil:Loan', notMine.contractId, notMine.args)])
    const { k, events } = keeper(true)
    const summary = await k.tick()
    assert.equal(summary.decisions, 0)
    assert.equal(submits().length, 0)
    assert.ok(events.some((e) => e.event === 'skip' && e.loanCid === 'loan-1'))
  })

  test('refresh-token auth exchanges once and derives the user id from the token', async () => {
    const loan = tbillLoan({ maturity: iso(-HOUR) })
    const m = mark('stream-tbill', '1.0')
    ledgerState([acsEntry('pkg:Veil:Loan', loan.contractId, loan.args), acsEntry('pkg:Veil:CollateralValuation', m.contractId, m.args)])
    const jwt = `x.${Buffer.from(JSON.stringify({ sub: 'user-from-token' })).toString('base64url')}.y`
    routes.push(
      { match: (c) => c.url === 'http://oidc.test/token', reply: { json: { access_token: jwt, expires_in: 3600 } } },
      { match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'), reply: { json: { transaction: { updateId: 'u', events: [] } } } },
    )
    const { k } = keeper(true, {
      VEIL_KEEPER_BEARER: '', VEIL_LEDGER_USER_ID: '',
      VEIL_UPSTREAM_REFRESH_TOKEN: 'refresh-secret', VEIL_OIDC_TOKEN_URL: 'http://oidc.test/token', VEIL_OIDC_CLIENT_ID: 'client',
    })
    await k.tick()
    const tokenCalls = calls.filter((c) => c.url === 'http://oidc.test/token')
    assert.equal(tokenCalls.length, 1)
    assert.deepEqual(tokenCalls[0].body, { grant_type: 'refresh_token', client_id: 'client', refresh_token: 'refresh-secret' })
    assert.equal(submits()[0].body.commands.userId, 'user-from-token')
    assert.equal(submits()[0].headers.Authorization, `Bearer ${jwt}`)
  })
})

// --------------------------------------------------------------- Journal --

const SUBMIT_PATH = '/v2/commands/submit-and-wait-for-transaction'
const accepted = (updateId) => () => ({ json: { transaction: { updateId, events: [] } } })
const cantonReject = (status, code, extra = {}) => () => ({ status, json: { code, cause: `${code} cause`, context: {}, ...extra } })
const networkError = (code) => () => ({ throw: Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) }) })

/**
 * A scripted ledger: every submission, completion page and update lookup must
 * be queued by the test. It never answers on its own; an unscripted request is
 * recorded in `unscripted` and throws.
 */
function scriptedLedger(contracts, { end = 100 } = {}) {
  const fake = { contracts, end, submits: [], completionPages: [], updates: new Map() }
  const unscriptedReply = (what) => {
    unscripted.push(what)
    return { throw: new Error(`fake ledger: nothing scripted for ${what}`) }
  }
  routes.push(
    { match: (c) => c.url === `${LEDGER}/v2/state/ledger-end`, reply: () => ({ json: { offset: fake.end } }) },
    { match: (c) => c.url === `${LEDGER}/v2/state/active-contracts`, reply: () => ({ json: fake.contracts }) },
    { match: (c) => c.url === `${LEDGER}${SUBMIT_PATH}`, reply: (c) => (fake.submits.length > 0 ? fake.submits.shift()(c) : unscriptedReply('submit')) },
    { match: (c) => c.url.startsWith(`${LEDGER}/v2/commands/completions?`), reply: () => (fake.completionPages.length > 0 ? { json: fake.completionPages.shift() } : unscriptedReply('completions')) },
    { match: (c) => c.url === `${LEDGER}/v2/updates/update-by-id`, reply: (c) => (fake.updates.has(c.body.updateId) ? { json: fake.updates.get(c.body.updateId) } : unscriptedReply('update-by-id')) },
  )
  return fake
}

const breachedLoanContracts = () => {
  const loan = tbillLoan()
  const m = mark('stream-tbill', '0.8')
  return [acsEntry('pkg:Veil:Loan', loan.contractId, loan.args), acsEntry('pkg:Veil:CollateralValuation', m.contractId, m.args)]
}
// Margin call expired, still breached: the keeper decides `liquidate`.
const liquidatableContracts = (price = '0.7') => {
  const loan = tbillLoan({ marginCall: openCall(iso(-60_000)) })
  const m = mark('stream-tbill', price)
  return [acsEntry('pkg:Veil:Loan', loan.contractId, loan.args), acsEntry('pkg:Veil:CollateralValuation', m.contractId, m.args)]
}
const MARGIN_OP = 'issueMarginCall:loan-1'
const LIQUIDATE_OP = 'liquidate:loan-1'
const submitCalls = () => calls.filter((c) => c.url.endsWith(SUBMIT_PATH))
const completion = (entry, over = {}) => ({ completionResponse: { Completion: { value: { commandId: entry.commandId, submissionId: entry.submissionId, userId: 'team-user', actAs: [P.lender], offset: 107, ...over } } } })
const auditLog = (journal) => readFileSync(journal.auditFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

describe('keeper journal', () => {
  afterEach(() => assert.deepEqual(unscripted, [], 'the fake ledger received a request no test scripted'))

  test('the pending entry is durable before the command is sent', async () => {
    const fake = scriptedLedger(breachedLoanContracts(), { end: 100 })
    const { k, journal } = keeper(true)
    let seenAtSubmit
    fake.submits.push((c) => {
      seenAtSubmit = JSON.parse(readFileSync(journal.file, 'utf8')).entries[MARGIN_OP]
      assert.equal(c.body.commands.commandId, seenAtSubmit.commandId)
      assert.equal(c.body.commands.submissionId, seenAtSubmit.submissionId)
      return accepted('u-1')()
    })
    const summary = await k.tick()
    assert.equal(summary.submitted, 1)
    assert.equal(seenAtSubmit.status, 'pending')
    assert.equal(seenAtSubmit.offset, 100)
    assert.deepEqual(seenAtSubmit.actAs, [P.lender])
    assert.deepEqual(seenAtSubmit.expect, { archive: 'loan-1', createTemplate: '^Veil:Loan$' })
    assert.match(seenAtSubmit.commandId, /^veil-keeper-issueMarginCall-[0-9a-f]{32}$/)
    const done = journal.get(MARGIN_OP)
    assert.equal(done.status, 'completed')
    assert.equal(done.updateId, 'u-1')
    assert.deepEqual(auditLog(journal).map((r) => [r.event, r.status]), [['submission', undefined], ['outcome', 'completed']])
  })

  test('lost response is unknown, then reconciled to completed from the completions stream', async () => {
    const fake = scriptedLedger(breachedLoanContracts(), { end: 100 })
    const { k, journal, events } = keeper(true)
    fake.submits.push(networkError('ECONNRESET'))
    const first = await k.tick()
    assert.equal(first.unknown, 1)
    assert.equal(first.errors, 0)
    const entry = journal.get(MARGIN_OP)
    assert.equal(entry.status, 'unknown')

    // The command did land: the loan moved on and a completion exists.
    fake.contracts = []
    fake.completionPages.push([
      { completionResponse: { OffsetCheckpoint: { value: { offset: 103 } } } },
      completion({ ...entry, commandId: 'someone-else' }, { offset: 104 }),
      completion(entry, { updateId: 'u-late', offset: 107 }),
    ])
    fake.updates.set('u-late', { update: { Transaction: { value: { updateId: 'u-late', events: [
      { ArchivedEvent: { contractId: 'loan-1', templateId: 'pkg:Veil:Loan' } },
      { CreatedEvent: { contractId: 'loan-1b', templateId: 'pkg:Veil:Loan' } },
    ] } } } })
    const second = await k.tick()
    assert.equal(second.unknown, 0)
    assert.equal(submitCalls().length, 1)
    const req = calls.find((c) => c.url.includes('/v2/commands/completions'))
    assert.match(req.url, /\?limit=\d+&stream_idle_timeout_ms=\d+$/)
    assert.deepEqual(req.body, { userId: 'team-user', parties: [P.lender], beginExclusive: 100 })
    const done = journal.get(MARGIN_OP)
    assert.equal(done.status, 'completed')
    assert.equal(done.updateId, 'u-late')
    assert.equal(done.verified, true)
    assert.ok(events.some((e) => e.event === 'reconciled' && e.status === 'completed'))
  })

  test('unknown with no completion stays unknown and is never resubmitted', async () => {
    const fake = scriptedLedger(breachedLoanContracts())
    const { k, journal, events } = keeper(true)
    fake.submits.push(() => ({ status: 504, json: 'gateway timeout' }))
    await k.tick()
    assert.equal(journal.get(MARGIN_OP).status, 'unknown')

    fake.completionPages.push([]) // caught up, nothing for our command
    const second = await k.tick()
    assert.equal(submitCalls().length, 1, 'an unknown operation must not be resubmitted')
    assert.equal(second.unknown, 1)
    assert.equal(second.blocked, 1)
    assert.ok(events.some((e) => e.event === 'indeterminate' && e.opKey === MARGIN_OP))
    assert.match(journal.get(MARGIN_OP).unknownReason, /no completion after offset 100/)
  })

  test('a scan that runs out of pages keeps the entry unknown', async () => {
    const fake = scriptedLedger(breachedLoanContracts())
    const { k, journal } = keeper(true, {}, { configure: (c) => Object.assign(c.reconcile, { pageSize: 2, maxPages: 1 }) })
    fake.submits.push(networkError('ECONNRESET'))
    await k.tick()
    const entry = journal.get(MARGIN_OP)
    fake.completionPages.push([completion({ ...entry, commandId: 'a' }, { offset: 101 }), completion({ ...entry, commandId: 'b' }, { offset: 102 })])
    const second = await k.tick()
    assert.equal(submitCalls().length, 1)
    assert.equal(second.unknown, 1)
    assert.match(journal.get(MARGIN_OP).unknownReason, /page budget exhausted at offset 102/)
  })

  test('a transient rejection is retried after backoff with the same command id', async () => {
    const fake = scriptedLedger(breachedLoanContracts())
    const clock = { now: NOW }
    const { k, journal } = keeper(true, {}, { clock })
    fake.submits.push(cantonReject(503, 'SERVICE_NOT_RUNNING', { errorCategory: 1, grpcCodeValue: 14 }))
    const first = await k.tick()
    assert.equal(first.errors, 1)
    const rejected = journal.get(MARGIN_OP)
    assert.equal(rejected.status, 'rejected')
    assert.deepEqual([rejected.rejection.class, rejected.rejection.dispatched], ['transient', false])
    assert.equal(rejected.nextAttemptAt, iso(30_000))

    const early = await k.tick() // still inside the backoff window
    assert.equal(early.blocked, 1)
    assert.equal(submitCalls().length, 1)

    clock.now = NOW + 31_000
    fake.submits.push(accepted('u-2'))
    const later = await k.tick()
    assert.equal(later.submitted, 1)
    const [a, b] = submitCalls().map((c) => c.body.commands)
    assert.equal(a.commandId, b.commandId)
    assert.notEqual(a.submissionId, b.submissionId)
    assert.deepEqual([journal.get(MARGIN_OP).status, journal.get(MARGIN_OP).attempts], ['completed', 2])
  })

  test('a definitive rejection is not retried until an operator asks', async () => {
    const fake = scriptedLedger(breachedLoanContracts())
    const clock = { now: NOW }
    const { k, journal } = keeper(true, {}, { clock })
    fake.submits.push(cantonReject(400, 'DAML_INTERPRETATION_ERROR', { errorCategory: 9, grpcCodeValue: 9 }))
    await k.tick()
    assert.equal(journal.get(MARGIN_OP).rejection.class, 'definitive')

    clock.now = NOW + 60_000
    const again = await k.tick()
    assert.equal(again.blocked, 1)
    assert.equal(submitCalls().length, 1)

    runOperator({ op: 'retry', target: MARGIN_OP, by: 'ops-1' }, journal)
    fake.submits.push(accepted('u-3'))
    assert.equal((await k.tick()).submitted, 1)
    assert.equal(journal.get(MARGIN_OP).status, 'completed')
    assert.ok(auditLog(journal).some((r) => r.event === 'retry' && r.by === 'ops-1' && r.from === 'rejected'))
    assert.throws(() => runOperator({ op: 'retry', target: MARGIN_OP, by: 'ops-1' }, journal), /completed/)
  })

  test('only one submission per operation is in flight across keepers', async () => {
    const fake = scriptedLedger(breachedLoanContracts())
    const stateDir = tempStateDir()
    const a = keeper(true, { VEIL_KEEPER_STATE_DIR: stateDir })
    const b = keeper(true, { VEIL_KEEPER_STATE_DIR: stateDir })
    let other
    fake.submits.push(async () => {
      other = await b.k.tick() // a second keeper runs while the first submission is in flight
      return accepted('u-4')()
    })
    const summary = await a.k.tick()
    assert.equal(summary.submitted, 1)
    assert.equal(other.submitted, 0)
    assert.equal(other.blocked, 1)
    assert.ok(b.events.some((e) => e.event === 'blocked' && e.status === 'pending'))
    assert.equal(submitCalls().length, 1)
  })

  test('liquidation waits for the approval quorum, then executes once', async () => {
    const fake = scriptedLedger(liquidatableContracts())
    const { k, journal, events } = keeper(true, { VEIL_KEEPER_ID: 'keeper-1', VEIL_KEEPER_REQUIRE_APPROVAL: '2' })
    const first = await k.tick()
    assert.equal(first.proposed, 1)
    assert.equal(submitCalls().length, 0)
    const { id } = journal.get(LIQUIDATE_OP)
    assert.ok(events.some((e) => e.event === 'proposal' && e.id === id && e.required === 2))

    runOperator({ op: 'approve', target: id, by: 'alice', remarks: '' }, journal)
    assert.throws(() => runOperator({ op: 'approve', target: id, by: 'Alice' }, journal), /already decided/)
    await k.tick()
    assert.equal(submitCalls().length, 0, 'one approval is not a quorum of two')
    assert.equal((await k.tick()).proposed, 0, 'an open proposal is not proposed again')

    runOperator({ op: 'approve', target: id, by: 'bob', remarks: 'checked the mark' }, journal)
    fake.submits.push(accepted('u-liq'))
    const executed = await k.tick()
    assert.equal(executed.submitted, 1)
    assert.equal(submitCalls()[0].body.commands.commands[0].ExerciseCommand.choice, 'Liquidate')
    const done = journal.get(LIQUIDATE_OP)
    assert.equal(done.status, 'completed')
    assert.deepEqual(done.proposal.decisions.map((d) => d.by), ['alice', 'bob'])
    assert.deepEqual(auditLog(journal).map((r) => r.event), ['proposal', 'decision', 'decision', 'submission', 'outcome'])

    await k.tick()
    assert.equal(submitCalls().length, 1, 'a completed liquidation is not executed again')
  })

  test('the proposer cannot approve its own proposal', async () => {
    scriptedLedger(liquidatableContracts())
    const { k, journal } = keeper(true, { VEIL_KEEPER_ID: 'keeper-1', VEIL_KEEPER_REQUIRE_APPROVAL: '1' })
    await k.tick()
    const { id } = journal.get(LIQUIDATE_OP)
    assert.throws(() => runOperator({ op: 'approve', target: id, by: ' Keeper-1 ' }, journal), JournalError)
    assert.equal(journal.get(LIQUIDATE_OP).proposal.decisions.length, 0)
    await k.tick()
    assert.equal(submitCalls().length, 0)
  })

  test('a rejection needs remarks and closes the proposal', async () => {
    scriptedLedger(liquidatableContracts())
    const { k, journal } = keeper(true, { VEIL_KEEPER_ID: 'keeper-1', VEIL_KEEPER_REQUIRE_APPROVAL: '1' })
    await k.tick()
    const { id } = journal.get(LIQUIDATE_OP)
    assert.throws(() => parseConfig(['--reject', id, '--by', 'carol'], {}), (e) => e instanceof ConfigError && /--remarks/.test(e.message))
    assert.throws(() => runOperator({ op: 'reject', target: id, by: 'carol', remarks: '  ' }, journal), /needs --remarks/)
    runOperator({ op: 'reject', target: id, by: 'carol', remarks: 'borrower is topping up' }, journal)
    assert.equal(journal.get(LIQUIDATE_OP).status, 'declined')
    assert.throws(() => runOperator({ op: 'approve', target: id, by: 'dave' }, journal), /declined/)
    const after = await k.tick()
    assert.deepEqual([after.proposed, after.blocked, submitCalls().length], [0, 1, 0])
    assert.ok(auditLog(journal).some((r) => r.event === 'decision' && r.decision === 'reject' && r.remarks === 'borrower is topping up'))
  })

  test('an approved liquidation is refused when the live ledger no longer supports it', async () => {
    const fake = scriptedLedger(liquidatableContracts('0.7'))
    const { k, journal, events } = keeper(true, { VEIL_KEEPER_ID: 'keeper-1', VEIL_KEEPER_REQUIRE_APPROVAL: '1' })
    await k.tick()
    const { id } = journal.get(LIQUIDATE_OP)
    runOperator({ op: 'approve', target: id, by: 'alice' }, journal)

    fake.contracts = liquidatableContracts('1.0') // price recovered before execution
    const refused = await k.tick()
    assert.equal(submitCalls().length, 0)
    assert.equal(refused.blocked, 1)
    assert.ok(events.some((e) => e.event === 'executionRefused' && e.id === id))
    assert.equal(journal.get(LIQUIDATE_OP).status, 'proposed')

    fake.contracts = [] // the loan itself is gone: the approval is void
    await k.tick()
    assert.equal(journal.get(LIQUIDATE_OP).status, 'stale')
    assert.equal(submitCalls().length, 0)
  })
})

describe('classifySubmitError', () => {
  const http = (status, body) => new HttpError('POST /v2/commands/submit-and-wait-for-transaction', status, typeof body === 'string' ? body : JSON.stringify(body))
  const canton = (code, errorCategory, grpcCodeValue, extra = {}) => ({ code, cause: 'x', context: {}, errorCategory, grpcCodeValue, ...extra })
  const net = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) })
  const shape = (o) => (o.status === 'unknown' ? 'unknown' : `${o.rejection.class}${o.rejection.dispatched === false ? '/not-dispatched' : ''}`)

  test('transient only when nothing can have committed', () => {
    assert.equal(shape(classifySubmitError(net('ECONNREFUSED'))), 'transient/not-dispatched')
    assert.equal(shape(classifySubmitError(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new AggregateError([net('ECONNREFUSED').cause, net('ECONNREFUSED').cause]), { code: 'ECONNREFUSED' }) }))), 'transient/not-dispatched')
    assert.equal(shape(classifySubmitError(http(429, 'slow down'))), 'transient/not-dispatched')
    assert.equal(shape(classifySubmitError(http(503, canton('SERVICE_NOT_RUNNING', 1, 14)))), 'transient/not-dispatched')
    assert.equal(shape(classifySubmitError(http(409, canton('LOCAL_VERDICT_LOCKED_CONTRACTS', 2, 10)))), 'transient/not-dispatched')
  })

  test('possibly-landed failures are unknown', () => {
    assert.equal(shape(classifySubmitError(net('ECONNRESET'))), 'unknown')
    assert.equal(shape(classifySubmitError(new DOMException('timed out', 'TimeoutError'))), 'unknown')
    assert.equal(shape(classifySubmitError(http(504, 'gateway timeout'))), 'unknown')
    assert.equal(shape(classifySubmitError(http(500, canton('INTERNAL', 4, 13)))), 'unknown')
    assert.equal(shape(classifySubmitError(http(504, canton('REQUEST_TIME_OUT', 3, 4)))), 'unknown')
    assert.equal(shape(classifySubmitError(http(409, canton('X', 2, 10, { definiteAnswer: false })))), 'unknown')
    assert.equal(shape(classifySubmitError(new SyntaxError('bad json'))), 'unknown')
  })

  test('everything else is definitive', () => {
    assert.equal(shape(classifySubmitError(http(404, canton('CONTRACT_NOT_FOUND', 11, 5)))), 'definitive')
    assert.equal(shape(classifySubmitError(http(400, canton('DAML_INTERPRETATION_ERROR', 9, 9)))), 'definitive')
    assert.equal(shape(classifySubmitError(http(409, canton('DUPLICATE_COMMAND', 10, 6)))), 'definitive')
    assert.equal(shape(classifySubmitError(http(400, { code: 'UNCLASSIFIED', cause: 'no category' }))), 'definitive')
    assert.equal(shape(classifySubmitError(http(401, 'unauthorized'))), 'definitive')
  })
})

describe('parseConfig', () => {
  test('operator commands need only the journal, and --by', () => {
    const approve = parseConfig(['--approve', 'abc', '--by', 'alice', '--state-dir', '/tmp/x'], {})
    assert.deepEqual(approve.operator, { op: 'approve', target: 'abc', by: 'alice', remarks: '' })
    assert.equal(approve.stateDir, '/tmp/x')
    assert.throws(() => parseConfig(['--approve', 'abc'], {}), /--by/)
    assert.throws(() => parseConfig(['--approve', 'a', '--reject', 'a', '--by', 'x', '--remarks', 'y'], {}), /one of/)
    assert.throws(() => parseConfig(['--require-approval', '1.5'], { VEIL_LEDGER_TARGET: LEDGER, VEIL_PARTY_LENDER: P.lender, VEIL_KEEPER_BEARER: 't' }), /whole number/)
    assert.equal(parseConfig(['--retry', 'k'], {}).operator.op, 'retry')
  })

  test('requires a ledger, a lender and credentials; dry-run by default', () => {
    assert.throws(() => parseConfig([], {}), /VEIL_LEDGER_TARGET/)
    assert.throws(() => parseConfig([], { VEIL_LEDGER_TARGET: LEDGER }), /VEIL_PARTY_LENDER/)
    assert.throws(() => parseConfig([], { VEIL_LEDGER_TARGET: LEDGER, VEIL_PARTY_LENDER: P.lender }), /no credentials/)
    const config = parseConfig(['--once', '--interval', '10', '--ledger-url', 'http://x/'], { VEIL_PARTY_LENDER: P.lender, VEIL_KEEPER_BEARER: 't' })
    assert.equal(config.execute, false)
    assert.equal(config.once, true)
    assert.equal(config.intervalMs, 10_000)
    assert.equal(config.ledgerUrl, 'http://x')
    assert.equal(config.packageRef, '#veil-lite')
    assert.throws(() => parseConfig(['--bogus'], {}), /unknown argument/)
  })
})
