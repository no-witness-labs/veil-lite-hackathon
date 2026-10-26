// Veil 1.0 token loans on Splice LocalNet, against real registries:
//   * Canton Coin (Amulet), whose factories, choice context and disclosures
//     come from Scan's token registry API through the validator's scan proxy;
//   * Splice's reference V2 token (splice-test-token-v2), as two registries
//     standing in for USDCx and CBTC. It has no off-ledger API, so this script
//     serves its context and disclosures the way its registry would.
//
// Three loans, each checked against the parties' real holdings:
//   A  100 USDCx against 150 CBTC: pay down 30, then repay
//   B  100 USDCx against 1,000 CC: margin call, then liquidation
//   C  100 USDCx against 1,000 CC: repay, which unlocks the CC
//
// Needs a fresh Splice LocalNet (0.6.12; the app-provider participant's JSON
// Ledger API on :3975 and its validator on :3903) with no older veil
// package, and the DAR built: dpm build
// Usage: CANTON_TOKEN=<LocalNet ledger API token> node scripts/token-loans-localnet.mjs
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const J = process.env.JSON_API ?? 'http://localhost:3975'
const REGISTRY = process.env.REGISTRY_URL ?? 'http://localhost:3903/api/validator/v0/scan-proxy'
const TOKEN = process.env.CANTON_TOKEN
if (!TOKEN) throw new Error('set CANTON_TOKEN to the ledger API token')
const USER = process.env.LEDGER_USER ?? 'ledger-api-user'
const REPO = new URL('..', import.meta.url).pathname
const RUN = Date.now()
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const step = (t) => console.log(`\n==> ${t}`)
const info = (t) => console.log(`    ${t}`)

async function http(base, path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  if (!r.ok) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data).slice(0, 600)}`), { status: r.status, body: data })
  return data
}
const call = (path, body, method) => http(J, path, body, method)
const registry = (path, body, method) => http(REGISTRY, path, body, method)

const T = {
  ValuationStream: '#veil:Veil:ValuationStream',
  CollateralValuation: '#veil:Veil:CollateralValuation',
  TokenOfferRequest: '#veil:Veil:TokenOfferRequest',
  TokenLoanOffer: '#veil:Veil:TokenLoanOffer',
  TokenLoan: '#veil:Veil:TokenLoan',
  TokenLoanClosed: '#veil:Veil:TokenLoanClosed',
  TokenRules: '#splice-test-token-v2:Splice.Testing.Tokens.TestTokenV2:TokenRules',
  Token: '#splice-test-token-v2:Splice.Testing.Tokens.TestTokenV2.Holding:Token',
}
const HOLDING = '#splice-api-token-holding-v2:Splice.Api.Token.HoldingV2:Holding'
const ALLOCATION = '#splice-api-token-allocation-v2:Splice.Api.Token.AllocationV2:Allocation'
const NO_META = { values: {} }
const create = (templateId, createArguments) => ({ CreateCommand: { templateId, createArguments } })
const exercise = (templateId, contractId, choice, choiceArgument) => ({ ExerciseCommand: { templateId, contractId, choice, choiceArgument } })
const createAndExercise = (templateId, createArguments, choice, choiceArgument) => ({ CreateAndExerciseCommand: { templateId, createArguments, choice, choiceArgument } })
const createdIn = (tx, templateId) => (tx.events ?? []).map((e) => e.CreatedEvent).filter((e) => e && e.templateId.endsWith(templateId.slice(templateId.indexOf(':'))))
const dec = (x) => Number(x).toFixed(10)
const later = (ms) => new Date(Date.now() + ms).toISOString()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function submit(actAs, command, disclosed = []) {
  // One copy of each disclosed contract, whichever source supplied it.
  const disclosedContracts = [...new Map(disclosed.map((d) => [d.contractId, d])).values()]
  const r = await call('/v2/commands/submit-and-wait-for-transaction', {
    commands: { commands: [command], commandId: `veil-tokens-${randomUUID()}`, userId: USER, actAs, readAs: actAs, disclosedContracts },
  })
  return r.transaction
}
// Only the ledger's own rejection, for the expected reason, counts: a network,
// authentication or server error is rethrown rather than read as a refusal.
const mustFail = async (what, reason, run) => {
  try { await run() } catch (e) {
    const cause = typeof e.body?.cause === 'string' ? e.body.cause : ''
    if (e.status !== 400 || !cause.includes(reason)) throw e
    info(`refused as expected: ${what} (${cause.slice(0, 140)})`)
    return
  }
  throw new Error(`${what} was accepted`)
}

async function active(party, filter) {
  const { offset } = await call('/v2/state/ledger-end')
  const entries = await call('/v2/state/active-contracts', {
    eventFormat: { filtersByParty: { [party]: { cumulative: [{ identifierFilter: filter }] } }, verbose: false },
    activeAtOffset: offset,
  })
  return entries.map((e) => e?.contractEntry?.JsActiveContract).filter(Boolean)
    .map((c) => ({ ...c.createdEvent, synchronizerId: c.synchronizerId }))
}
const byInterface = (party, interfaceId) => active(party, { InterfaceFilter: { value: { interfaceId, includeInterfaceView: true, includeCreatedEventBlob: true } } })
const byTemplate = (party, templateId) => active(party, { TemplateFilter: { value: { templateId, includeCreatedEventBlob: true } } })
const disclosure = (ce) => ({ templateId: ce.templateId, contractId: ce.contractId, createdEventBlob: ce.createdEventBlob, synchronizerId: ce.synchronizerId })
const viewOf = (ce) => ce.interfaceViews?.[0]?.viewValue

async function localParty(hint) {
  const party = (await call('/v2/parties', { partyIdHint: `${hint}-${RUN}`, identityProviderId: '', localMetadata: { annotations: {} } })).partyDetails.party
  await call(`/v2/users/${USER}/rights`, { userId: USER, identityProviderId: '', rights: [{ kind: { CanActAs: { value: { party } } } }, { kind: { CanReadAs: { value: { party } } } }] })
  return party
}

const account = (owner) => ({ owner, provider: null, id: '' })

// Holdings of one instrument in one party's own account.
async function holdings(owner, instrument) {
  return (await byInterface(owner, HOLDING)).filter((ce) => {
    const v = viewOf(ce)
    return v && v.account.owner === owner && v.account.provider === null && v.instrumentId.admin === instrument.admin && v.instrumentId.id === instrument.id
  })
}
async function balance(owner, instrument) {
  const hs = (await holdings(owner, instrument)).map(viewOf)
  const sum = (xs) => xs.reduce((a, v) => a + Number(v.amount), 0)
  return { free: sum(hs.filter((v) => !v.lock)), locked: sum(hs.filter((v) => v.lock)) }
}
const unlocked = async (owner, instrument) => (await holdings(owner, instrument)).filter((ce) => !viewOf(ce).lock).map((ce) => ce.contractId)
async function expectBalance(who, owner, instrument, free, locked, tolerance = 1e-6) {
  const b = await balance(owner, instrument)
  info(`${who} holds ${b.free} ${instrument.id}${b.locked ? ` and ${b.locked} locked` : ''}`)
  if (Math.abs(b.free - free) > tolerance || Math.abs(b.locked - locked) > tolerance) {
    throw new Error(`${who}: expected ${free} free and ${locked} locked ${instrument.id}, found ${b.free} and ${b.locked}`)
  }
}

// --- Splice's reference V2 token: one registry per admin. TokenRules is both
// factories; its only stakeholder is the admin, so every use discloses it.
// The context is what the registry's API would serve: the rules contract, and
// no account configurations, since every account here is self-custodial.
async function testTokenRegistry(admin, id) {
  const tx = await submit([admin], create(T.TokenRules, { admin }))
  const rulesCid = createdIn(tx, T.TokenRules)[0].contractId
  const rules = (await byTemplate(admin, T.TokenRules)).find((ce) => ce.contractId === rulesCid)
  const instrument = { admin, id }
  return {
    pinned: { instrument, allocationFactory: rulesCid, settlementFactory: rulesCid },
    instrument,
    disclosed: [disclosure(rules)],
    args: {
      context: { values: { 'testTokenV2/accountConfigs': { tag: 'AV_List', value: [] }, 'testTokenV2/tokenRules': { tag: 'AV_ContractId', value: rulesCid } } },
      meta: NO_META,
    },
    async mint(owner, amount) {
      await submit([admin, owner], create(T.Token, { holding: { account: account(owner), instrumentId: instrument, amount: dec(amount), lock: null, meta: NO_META } }))
    },
    // The holdings an allocation locked, disclosed by the admin, as the
    // registry serves them to an executor who is not their owner.
    async lockedBy(allocationCid) {
      const allocation = (await byInterface(admin, ALLOCATION)).find((ce) => ce.contractId === allocationCid)
      if (!allocation) throw new Error(`${id}: allocation ${allocationCid} not found`)
      const cids = new Set(viewOf(allocation).holdingCids)
      return (await byTemplate(admin, T.Token)).filter((ce) => cids.has(ce.contractId)).map(disclosure)
    },
  }
}

// --- Canton Coin, through Scan's registry API. Scan 0.6.12 serves no V2
// allocation-factory endpoint; its V1 endpoint returns the same factory
// (ExternalPartyAmuletRules implements both versions) and the context Amulet's
// V2 allocation reads (open round, config state), without reading the choice
// arguments.
const contextArgs = (choiceContext) => ({ context: choiceContext.choiceContextData, meta: NO_META })
const scanDisclosed = (choiceContext) => choiceContext.disclosedContracts.map(({ templateId, contractId, createdEventBlob, synchronizerId }) => ({ templateId, contractId, createdEventBlob, synchronizerId }))
async function amuletAllocationFactory() {
  const r = await registry('/registry/allocation-instruction/v1/allocation-factory', { choiceArguments: {}, excludeDebugFields: true })
  return { factoryId: r.factoryId, args: contextArgs(r.choiceContext), disclosed: scanDisclosed(r.choiceContext) }
}
async function amuletSettlementFactory(choiceArguments) {
  const r = await registry('/registry/allocation/v2/settlement-factory', { choiceArguments, excludeDebugFields: true })
  return { factoryId: r.factoryId, args: contextArgs(r.choiceContext), disclosed: scanDisclosed(r.choiceContext) }
}
async function amuletCancel(allocationCid) {
  const r = await registry(`/registry/allocations/v2/${encodeURIComponent(allocationCid)}/choice-contexts/cancel`, { meta: {}, excludeDebugFields: true })
  return { args: contextArgs(r), disclosed: scanDisclosed(r) }
}
// LocalNet runs as DevNet, so the faucet mints Canton Coin to any party.
async function tapAmulet(receiver, amount) {
  const { amulet_rules: { contract: rules, domain_id: rulesDomain } } = await registry('/amulet-rules')
  const { open_mining_rounds: rounds } = await registry('/open-and-issuing-mining-rounds')
  const open = rounds.map((r) => ({ ...r.contract, domain_id: r.domain_id })).filter((c) => new Date(c.payload.opensAt) <= new Date())
    .sort((a, b) => Number(b.payload.round.number) - Number(a.payload.round.number))[0]
  if (!open) throw new Error('no open mining round yet')
  const scanContract = (c, domain) => ({ templateId: c.template_id, contractId: c.contract_id, createdEventBlob: c.created_event_blob, synchronizerId: domain })
  await submit([receiver], exercise(rules.template_id, rules.contract_id, 'AmuletRules_DevNet_Tap', { receiver, amount: dec(amount), openRound: open.contract_id }),
    [scanContract(rules, rulesDomain), scanContract(open, open.domain_id)])
}

// --- one loan
function transferLeg(instrument, transferLegId, sender, receiver, amount) {
  return { transferLegId, sender: account(sender), receiver: account(receiver), amount: dec(amount), instrumentId: instrument.id, meta: NO_META }
}
function settlementInfo(p, anchor, id) {
  return { executors: [p.lender, p.borrower], id, cid: anchor, meta: NO_META }
}

async function stream(p, asset, unitPrice) {
  const tx = await submit([p.lender, p.borrower, p.valuer], create(T.ValuationStream, { valuationAgent: p.valuer, lender: p.lender, borrower: p.borrower, regulator: p.regulator, collateralAsset: asset }))
  const streamCid = createdIn(tx, T.ValuationStream)[0].contractId
  const mark = createdIn(await submit([p.valuer], exercise(T.ValuationStream, streamCid, 'PublishInitial', { unitPrice: dec(unitPrice) })), T.CollateralValuation)[0].contractId
  return { mark }
}
async function publish(p, s, unitPrice) {
  s.mark = createdIn(await submit([p.valuer], exercise(T.CollateralValuation, s.mark, 'Publish', { unitPrice: dec(unitPrice) })), T.CollateralValuation)[0].contractId
  return s.mark
}

async function fundOffer(p, usdc, collateral, s, ref, collateralQuantity) {
  const now = Date.now()
  const request = {
    lender: p.lender, borrower: p.borrower, regulator: p.regulator, valuationAgent: p.valuer,
    principalRegistry: usdc.pinned, collateralRegistry: collateral.pinned,
    principal: dec(100), interest: dec(5), collateralQuantity: dec(collateralQuantity),
    maturity: new Date(now + 7 * 24 * 3600e3).toISOString(), liquidationThresholdLtv: dec(90), marginCallWindowSeconds: '60',
    settlementRef: ref, expiresAt: new Date(now + 3600e3).toISOString(),
  }
  const tx = await submit([p.lender], createAndExercise(T.TokenOfferRequest, request, 'FundTokenOffer', {
    valuationCid: s.mark, inputHoldingCids: await unlocked(p.lender, usdc.instrument), extraArgs: usdc.args,
  }), usdc.disclosed)
  return createdIn(tx, T.TokenLoanOffer)[0]
}

async function acceptOffer(p, usdc, collateral, s, offer, lock) {
  const funding = await usdc.lockedBy(offer.createArgument.fundingAllocationCid)
  const tx = await submit([p.borrower], exercise(T.TokenLoanOffer, offer.contractId, 'AcceptTokenOffer', {
    valuationCid: s.mark, collateralHoldingCids: await unlocked(p.borrower, collateral.instrument),
    lockArgs: lock.args, receiveArgs: usdc.args, settleArgs: usdc.args,
  }), [...usdc.disclosed, ...lock.disclosed, ...funding])
  return createdIn(tx, T.TokenLoan)[0]
}

async function payments(p, usdc) {
  return { paymentHoldingCids: await unlocked(p.borrower, usdc.instrument), args: { sendArgs: usdc.args, receiveArgs: usdc.args, settleArgs: usdc.args } }
}

// ---------------------------------------------------------------------------

step('Installing veil 1.0.0 and splice-test-token-v2 on the app-provider participant')
for (const path of ['.daml/dist/veil-1.0.0.dar', 'vendor/splice-test-token-v2/splice-test-token-v2-1.0.0.dar']) {
  const up = await fetch(`${J}/v2/packages`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: readFileSync(REPO + path) })
  if (!up.ok) throw new Error(`upload ${path} → ${up.status} ${(await up.text()).slice(0, 400)}`)
  info(`uploaded ${path}`)
}

step('Parties and registries')
const p = {}
for (const role of ['lender', 'borrower', 'regulator', 'valuer']) p[role] = await localParty(`veil-${role}`)
const usdc = await testTokenRegistry(await localParty('usdcx-registry'), 'USDCx')
const cbtc = await testTokenRegistry(await localParty('cbtc-registry'), 'CBTC')
const { adminId: dso } = await registry('/registry/metadata/v1/info')
const amuletFactory = await amuletAllocationFactory()
const cc = { instrument: { admin: dso, id: 'Amulet' }, pinned: { instrument: { admin: dso, id: 'Amulet' }, allocationFactory: amuletFactory.factoryId, settlementFactory: amuletFactory.factoryId } }
info(`USDCx and CBTC: Splice test-token registries; Canton Coin: admin ${dso.split('::')[0]}, factory ${amuletFactory.factoryId.slice(0, 12)}…`)
await usdc.mint(p.lender, 1000)
await cbtc.mint(p.borrower, 200)
await tapAmulet(p.borrower, 3000)
await expectBalance('lender', p.lender, usdc.instrument, 1000, 0)
await expectBalance('borrower', p.borrower, cbtc.instrument, 200, 0)
const tapped = await balance(p.borrower, cc.instrument)
info(`borrower holds ${tapped.free} CC from the LocalNet faucet`)

// --- A: USDCx against CBTC, both test-token registries
step('Loan A: 100 USDCx against 150 CBTC')
{
  const s = await stream(p, 'CBTC', 1.0)
  const offer = await fundOffer(p, usdc, cbtc, s, `loan-a-${RUN}`, 150)
  info('the offer commits the lender\'s principal')
  await expectBalance('lender', p.lender, usdc.instrument, 900, 100)
  const loan = await acceptOffer(p, usdc, cbtc, s, offer, { args: cbtc.args, disclosed: cbtc.disclosed })
  info('acceptance pays the principal and locks the collateral in one transaction')
  await expectBalance('borrower', p.borrower, usdc.instrument, 100, 0)
  await expectBalance('borrower', p.borrower, cbtc.instrument, 50, 150)
  await mustFail('the borrower cancelling the lock alone at the registry', "'actors' does not have the same elements as one of 'allowed actors'", () =>
    submit([p.borrower], exercise(ALLOCATION, loan.createArgument.lockCid, 'Allocation_Cancel', { actors: [p.borrower], extraArgs: cbtc.args }), cbtc.disclosed))
  const pay = await payments(p, usdc)
  const paid = createdIn(await submit([p.borrower], exercise(T.TokenLoan, loan.contractId, 'PayDownToken', { amount: dec(30), ...pay, valuationCid: null }), usdc.disclosed), T.TokenLoan)[0]
  info('paid down 30')
  await expectBalance('lender', p.lender, usdc.instrument, 930, 0)
  await usdc.mint(p.borrower, 5)
  const closed = createdIn(await submit([p.borrower], exercise(T.TokenLoan, paid.contractId, 'RepayToken', { ...(await payments(p, usdc)), cancelArgs: cbtc.args }), [...usdc.disclosed, ...cbtc.disclosed]), T.TokenLoanClosed)[0]
  info(`repaid: ${closed.createArgument.reason}, ${closed.createArgument.amountRepaid} USDCx`)
  await expectBalance('lender', p.lender, usdc.instrument, 1005, 0)
  await expectBalance('borrower', p.borrower, cbtc.instrument, 200, 0)
  await expectBalance('borrower', p.borrower, usdc.instrument, 0, 0)
}

// --- B: USDCx against Canton Coin, liquidated
step('Loan B: 100 USDCx against 1,000 CC, liquidated after a margin call')
{
  await usdc.mint(p.lender, 100)
  const s = await stream(p, 'Amulet', 0.15)
  const offer = await fundOffer(p, usdc, cc, s, `loan-b-${RUN}`, 1000)
  await expectBalance('lender', p.lender, usdc.instrument, 1005, 100)
  const lock = await amuletAllocationFactory()
  const loan = await acceptOffer(p, usdc, cc, s, offer, lock)
  info('1,000 CC locked by Amulet in a committed allocation that lender and borrower execute together')
  await expectBalance('borrower', p.borrower, cc.instrument, tapped.free - 1000, 1000, 1)
  await expectBalance('lender', p.lender, usdc.instrument, 1005, 0)
  await expectBalance('borrower', p.borrower, usdc.instrument, 100, 0)
  const stressed = await publish(p, s, 0.09)
  info('CC marked at 0.09: 100 of principal outstanding on 90 of collateral, LTV 111.1%')
  const called = createdIn(await submit([p.lender], exercise(T.TokenLoan, loan.contractId, 'IssueTokenMarginCall', { valuationCid: stressed })), T.TokenLoan)[0]
  info('margin call issued; waiting out the 60-second window')
  await sleep(62_000)
  const fresh = await publish(p, s, 0.09)
  const lockCid = called.createArgument.lockCid
  const receipt = await amuletAllocationFactory()
  const settlement = settlementInfo(p, called.createArgument.settlementAnchor, `loan-b-${RUN}/collateral`)
  const settle = await amuletSettlementFactory({
    settlement, transferLegs: [transferLeg(cc.instrument, 'collateral', p.borrower, p.lender, 1000)],
    allocations: [{ allocationCid: lockCid, extraTransferLegSides: [], nextIterationFunding: null }],
    actors: settlement.executors, extraArgs: { context: { values: {} }, meta: NO_META },
  })
  if (settle.factoryId !== cc.pinned.settlementFactory) throw new Error(`Scan's settlement factory ${settle.factoryId} is not the pinned one`)
  const closed = createdIn(await submit([p.lender], exercise(T.TokenLoan, called.contractId, 'LiquidateToken', {
    valuationCid: fresh, receiveArgs: receipt.args, settleArgs: settle.args,
  }), [...receipt.disclosed, ...settle.disclosed]), T.TokenLoanClosed)[0]
  info(`liquidated: ${closed.createArgument.reason} at ${closed.createArgument.liquidationUnitPrice}, ${closed.createArgument.collateralSeized} CC to the lender`)
  await expectBalance('lender', p.lender, cc.instrument, 1000, 0, 1)
  await expectBalance('borrower', p.borrower, cc.instrument, tapped.free - 1000, 0, 1)
  info('the borrower keeps the principal; the lender holds the collateral')
  await expectBalance('lender', p.lender, usdc.instrument, 1005, 0)
  await expectBalance('borrower', p.borrower, usdc.instrument, 100, 0)
}

// --- C: USDCx against Canton Coin, repaid
step('Loan C: 100 USDCx against 1,000 CC, repaid')
{
  const s = await stream(p, 'Amulet', 0.15)
  const offer = await fundOffer(p, usdc, cc, s, `loan-c-${RUN}`, 1000)
  await expectBalance('lender', p.lender, usdc.instrument, 905, 100)
  const loan = await acceptOffer(p, usdc, cc, s, offer, await amuletAllocationFactory())
  await expectBalance('borrower', p.borrower, cc.instrument, tapped.free - 2000, 1000, 1)
  await expectBalance('borrower', p.borrower, usdc.instrument, 200, 0)
  await usdc.mint(p.borrower, 5)
  const cancel = await amuletCancel(loan.createArgument.lockCid)
  const closed = createdIn(await submit([p.borrower], exercise(T.TokenLoan, loan.contractId, 'RepayToken', { ...(await payments(p, usdc)), cancelArgs: cancel.args }),
    [...usdc.disclosed, ...cancel.disclosed]), T.TokenLoanClosed)[0]
  info(`repaid: ${closed.createArgument.reason}; the lock is cancelled and the CC is the borrower's again`)
  await expectBalance('borrower', p.borrower, cc.instrument, tapped.free - 1000, 0, 1)
  await expectBalance('lender', p.lender, usdc.instrument, 1010, 0)
  await expectBalance('borrower', p.borrower, usdc.instrument, 100, 0)
}

step('Done: three loans settled through real registries')
info(`lender: ${JSON.stringify(await balance(p.lender, usdc.instrument))} USDCx, ${JSON.stringify(await balance(p.lender, cc.instrument))} CC`)
