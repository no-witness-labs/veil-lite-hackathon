import test, { afterEach, beforeEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decide, loanLtv, formatDecimal } from '../scripts/keeper-lib.mjs'
import { createKeeper, parseConfig } from '../scripts/keeper.mjs'

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

  test('past maturity liquidates as overdue without a mark', () => {
    const [action] = decide([tbillLoan({ maturity: iso(-60_000) })], [], NOW)
    assert.equal(action.kind, 'liquidateOverdue')
    assert.equal(action.choice, 'LiquidateOverdue')
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

beforeEach(() => {
  calls = []
  routes = []
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(init.body) : undefined
    const call = { url: String(url), method: init.method ?? 'GET', body, headers: init.headers }
    calls.push(call)
    const route = routes.find((r) => r.match(call))
    if (!route) throw new Error(`unexpected fetch ${call.method} ${call.url}`)
    const { status = 200, json } = typeof route.reply === 'function' ? route.reply(call) : route.reply
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

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

function keeper(execute, over = {}) {
  const config = parseConfig(execute ? ['--execute'] : [], {
    VEIL_LEDGER_TARGET: LEDGER,
    VEIL_REGISTRY_URL: REGISTRY,
    VEIL_PARTY_LENDER: P.lender,
    VEIL_PARTY_VALUER: P.valuer,
    VEIL_PARTY_ISSUER: P.issuer,
    VEIL_LEDGER_USER_ID: 'team-user',
    VEIL_KEEPER_BEARER: 'test-token',
    ...over,
  })
  const events = []
  return { k: createKeeper(config, { now: () => NOW, emit: (e) => events.push(e) }), events }
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
    assert.deepEqual(summary, { decisions: 2, submitted: 0, benign: 0, errors: 0 })
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

  test('execute submits LiquidateOverdue with an empty argument', async () => {
    const loan = tbillLoan({ maturity: iso(-HOUR) })
    ledgerState([acsEntry('pkg:Veil:Loan', loan.contractId, loan.args)])
    routes.push({ match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'), reply: { json: { transaction: { updateId: 'u2', events: [] } } } })
    await keeper(true).k.tick()
    assert.deepEqual(submits()[0].body.commands.commands[0].ExerciseCommand, {
      templateId: '#veil-lite:Veil:Loan', contractId: 'loan-1', choice: 'LiquidateOverdue', choiceArgument: {},
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
    assert.deepEqual(summary, { decisions: 1, submitted: 1, benign: 0, errors: 0 })

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

  test('already-consumed contract is benign; other failures are errors', async () => {
    const a = tbillLoan({ maturity: iso(-HOUR) })
    const b = { ...tbillLoan({ maturity: iso(-HOUR) }), contractId: 'loan-2' }
    ledgerState([acsEntry('pkg:Veil:Loan', a.contractId, a.args), acsEntry('pkg:Veil:Loan', b.contractId, b.args)])
    routes.push({
      match: (c) => c.url.endsWith('/v2/commands/submit-and-wait-for-transaction'),
      reply: (c) => c.body.commands.commands[0].ExerciseCommand.contractId === 'loan-1'
        ? { status: 404, json: { code: 'CONTRACT_NOT_FOUND', cause: 'Contract could not be found' } }
        : { status: 400, json: { code: 'DAML_FAILURE', cause: 'loan is not past maturity' } },
    })
    const { k, events } = keeper(true)
    const summary = await k.tick()
    assert.deepEqual(summary, { decisions: 2, submitted: 0, benign: 1, errors: 1 })
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
    ledgerState([acsEntry('pkg:Veil:Loan', loan.contractId, loan.args)])
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

describe('parseConfig', () => {
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
