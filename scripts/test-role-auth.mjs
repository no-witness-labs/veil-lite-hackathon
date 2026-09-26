#!/usr/bin/env node
// Integration check against a fresh, bootstrapped sandbox and running Vite.
// This spends the canonical demo holdings; use the operator's Reset demo first
// when repeating it. Credentials are read from disk and never printed.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSign, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/local-auth.mjs', root)), 'issue'], { stdio: 'pipe' })
const tokens = JSON.parse(await readFile(new URL('.local/auth/tokens.json', root), 'utf8'))
const key = await readFile(new URL('.local/auth/private.pem', root), 'utf8')
const cfg = JSON.parse(await readFile(new URL('frontend/public/ledger-config.json', root), 'utf8'))
const web = process.env.VEIL_TEST_WEB_URL ?? 'http://127.0.0.1:5173'
const canton = process.env.VEIL_TEST_LEDGER_URL ?? 'http://127.0.0.1:6864'
const roles = ['lender', 'borrower', 'valuer', 'regulator', 'outsider', 'operator']
const party = cfg.parties
let checks = 0

function signedToken(change) {
  const claims = JSON.parse(Buffer.from(tokens.lender.split('.')[1], 'base64url'))
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...claims, ...change })).toString('base64url')
  const input = `${header}.${body}`
  const signer = createSign('RSA-SHA256')
  signer.update(input)
  return `${input}.${signer.sign(key).toString('base64url')}`
}

async function request(base, path, token, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

function passed(label) {
  checks += 1
  console.log(`PASS ${label}`)
}

async function denied(label, base, path, token, body, codes = [401, 403]) {
  const result = await request(base, path, token, body)
  assert.ok(codes.includes(result.status), `${label}: expected ${codes.join('/')}, got ${result.status}`)
  passed(label)
}

async function ok(base, path, role, body) {
  const result = await request(base, path, tokens[role], body)
  assert.equal(result.status, 200, `${role} ${path}: HTTP ${result.status}: ${JSON.stringify(result.data)}`)
  return result.data
}

const filter = (p, offset) => ({
  filter: { filtersByParty: { [p]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } } },
  verbose: false,
  activeAtOffset: offset,
})

async function contracts(role, base = web, view = party[role]) {
  const end = await ok(base, '/v2/state/ledger-end', role)
  const entries = await ok(base, '/v2/state/active-contracts', role, filter(view, end.offset))
  return entries.map((e) => e.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean)
}

const template = (name) => `#veil-lite:Veil:${name}`
const named = (list, name) => list.filter((c) => c.templateId.endsWith(`:Veil:${name}`))
const TBILL = 'Tokenized T-Bill'
const MMF = 'Tokenized MMF'
const ofAsset = (list, asset) => list.filter((c) => (c.createArgument.collateralAsset ?? c.createArgument.asset) === asset)
const amountOf = (c) => Number(c.createArgument.amount ?? c.createArgument.quantity)

// Seed wallets are large; carve an exact holding out of one, as the app does.
async function exactHolding(role, templateName, asset, amount) {
  const holdings = named(await contracts(role), templateName).filter((c) => asset === undefined || c.createArgument.asset === asset)
  const exact = holdings.find((c) => amountOf(c) === amount)
  if (exact) return exact
  const source = holdings.find((c) => amountOf(c) > amount)
  assert.ok(source, `no ${templateName} holding larger than ${amount}`)
  const [choice, field] = templateName === 'CashHolding' ? ['Split', 'splitAmount'] : ['SplitCollateral', 'splitQuantity']
  await ok(web, submitPath, role, commandBody(role, exercise(templateName, source.contractId, choice, { [field]: String(amount) })))
  const split = named(await contracts(role), templateName).find((c) => amountOf(c) === amount && (asset === undefined || c.createArgument.asset === asset))
  assert.ok(split)
  return split
}
function one(list, name) {
  const found = named(list, name)
  assert.equal(found.length, 1, `Expected one ${name}; reset the demo before repeating this check`)
  return found[0]
}

const commandBody = (role, command, extra = {}) => ({ commands: {
  commands: [command],
  commandId: `auth-check-${randomUUID()}`,
  userId: `veil-${role}`,
  actAs: [party[role]],
  ...extra,
} })
const exercise = (name, cid, choice, choiceArgument = {}) => ({ ExerciseCommand: {
  templateId: template(name), contractId: cid, choice, choiceArgument,
} })
const submitPath = '/v2/commands/submit-and-wait-for-transaction'

for (const base of [web, canton]) {
  const boundary = base === web ? 'server' : 'direct Canton'
  await denied(`${boundary}: missing token`, base, '/v2/state/ledger-end')
  for (const [label, token] of [
    ['expired token', signedToken({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ['wrong audience', signedToken({ aud: 'https://wrong.invalid' })],
    ['invalid signature', `${tokens.lender.slice(0, tokens.lender.lastIndexOf('.') + 1)}AAAA`],
  ]) await denied(`${boundary}: ${label}`, base, '/v2/state/ledger-end', token)

  const end = await ok(base, '/v2/state/ledger-end', 'lender')
  for (const role of roles.filter((r) => r !== 'operator')) {
    const foreign = role === 'borrower' ? party.lender : party.borrower
    await denied(`${boundary}: ${role} cannot read another party`, base, '/v2/state/active-contracts', tokens[role], filter(foreign, end.offset))
  }
  await denied(`${boundary}: lender cannot read all parties`, base, '/v2/state/active-contracts', tokens.lender, {
    filter: { filtersByParty: {}, filtersForAnyParty: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } },
    verbose: false, activeAtOffset: end.offset,
  }, [400, 401, 403])

  const cashCreate = { CreateCommand: { templateId: template('CashHolding'), createArguments: {
    issuer: cfg.issuer, owner: party.lender, amount: '999',
  } } }
  await denied(`${boundary}: lender cannot mint with issuer authority`, base, submitPath, tokens.lender,
    commandBody('lender', cashCreate, { actAs: [party.lender, cfg.issuer] }))
  await denied(`${boundary}: borrower cannot impersonate lender`, base, submitPath, tokens.borrower,
    commandBody('borrower', cashCreate, { actAs: [party.lender] }))
  await denied(`${boundary}: lender cannot add borrower readAs`, base, submitPath, tokens.lender,
    commandBody('lender', cashCreate, { readAs: [party.borrower] }))
  for (const role of ['regulator', 'outsider']) {
    await denied(`${boundary}: ${role} cannot submit`, base, submitPath, tokens[role], commandBody(role, cashCreate))
  }
  await denied(`${boundary}: operator is not a participant administrator`, base, '/v2/users', tokens.operator, undefined,
    base === web ? [403, 404, 405] : [401, 403])
}

for (const role of roles) {
  const session = await ok(web, '/api/session', role)
  assert.equal(session.role, role)
  assert.equal(session.userId, `veil-${role}`)
  assert.ok(session.expiresAt > Date.now() / 1000)
  passed(`session identifies ${role}`)
}

await denied('bootstrap administrator cannot sign in to the app', web, '/api/session', tokens.participant_admin)
for (const file of ['tokens.json', 'private.pem', 'headers/participant_admin.txt']) {
  const path = new URL(`.local/auth/${file}`, root).pathname
  const response = await request(web, `/@fs${path}`)
  assert.ok([403, 404].includes(response.status), `Vite must deny private file ${file}`)
}
passed('Vite cannot serve the credential directory')

const priorMark = one(ofAsset(await contracts('valuer'), TBILL), 'CollateralValuation')
await ok(web, submitPath, 'valuer', commandBody('valuer', exercise('CollateralValuation', priorMark.contractId, 'Publish', { unitPrice: '1' })))
const initial = await contracts('lender')
const cash = one(initial, 'CashHolding')
const mark = one(ofAsset(initial, TBILL), 'CollateralValuation')
await ok(web, submitPath, 'lender', commandBody('lender', exercise('CashHolding', cash.contractId, 'MakeOffer', {
  borrower: party.borrower, regulator: party.regulator, valuationAgent: party.valuer,
  valuationCid: mark.contractId, principal: '100', interest: '5',
  collateralAsset: 'Tokenized T-Bill', collateralQuantity: '150',
  maturity: new Date(Date.now() + 86_400_000).toISOString(), liquidationThresholdLtv: '90', marginCallWindowSeconds: '60',
})))
passed('lender creates a funded offer using only its own token')

const borrowerView = await contracts('borrower')
const offer = one(borrowerView, 'LoanOffer')
const collateral = await exactHolding('borrower', 'CollateralHolding', TBILL, 150)
await ok(web, submitPath, 'borrower', commandBody('borrower', exercise('LoanOffer', offer.contractId, 'Accept', {
  collateralCid: collateral.contractId, valuationCid: mark.contractId,
})))
passed('borrower accepts using its own token')

assert.equal(named(await contracts('regulator'), 'Loan').length, 1)
assert.equal(named(await contracts('valuer'), 'Loan').length, 0)
assert.deepEqual(await contracts('outsider'), [])
passed('regulator sees loan, valuer does not, outsider sees no contracts')

for (const base of [web, canton]) {
  const loan = one(await contracts('lender'), 'Loan')
  await denied(`${base === web ? 'server' : 'direct Canton'}: borrower cannot perform cooperative reset`, base, submitPath, tokens.borrower,
    commandBody('borrower', exercise('Loan', loan.contractId, 'Archive'), { actAs: [cfg.issuer, party.lender, party.borrower] }))
}

await ok(web, submitPath, 'valuer', commandBody('valuer', exercise('CollateralValuation', mark.contractId, 'Publish', { unitPrice: '0.62' })))
const stressed = await contracts('lender')
const stressedMark = one(ofAsset(stressed, TBILL), 'CollateralValuation')
await ok(web, submitPath, 'lender', commandBody('lender', exercise('Loan', one(stressed, 'Loan').contractId, 'IssueMarginCall', { valuationCid: stressedMark.contractId })))
const called = await contracts('borrower')
const reserve = await exactHolding('borrower', 'CollateralHolding', TBILL, 50)
await ok(web, submitPath, 'borrower', commandBody('borrower', exercise('Loan', one(called, 'Loan').contractId, 'TopUpCollateral', {
  collateralCid: reserve.contractId, topUpQuantity: '50', valuationCid: stressedMark.contractId,
})))
passed('valuer publishes, lender calls margin, borrower cures with independent tokens')

// Substitution: the borrower escrows its MMF holding; the lender, which cannot
// see that wallet, approves the request against a fresh MMF mark.
const beforeSwap = await contracts('borrower')
const mmfHolding = await exactHolding('borrower', 'CollateralHolding', MMF, 160)
const mmfMarkBefore = one(ofAsset(beforeSwap, MMF), 'CollateralValuation')
await ok(web, submitPath, 'borrower', commandBody('borrower', exercise('CollateralHolding', mmfHolding.contractId, 'ProposeSubstitution', {
  lender: party.lender, regulator: party.regulator, valuationAgent: party.valuer,
  releaseAsset: TBILL, releaseQuantity: '200', newValuationStreamId: mmfMarkBefore.createArgument.streamId,
})))
assert.equal(named(await contracts('lender'), 'CollateralHolding').length, 0)
assert.equal(named(await contracts('valuer'), 'SubstitutionRequest').length, 0)
await ok(web, submitPath, 'valuer', commandBody('valuer', exercise('CollateralValuation', mmfMarkBefore.contractId, 'Publish', { unitPrice: '1' })))
const swapView = await contracts('lender')
await ok(web, submitPath, 'lender', commandBody('lender', exercise('Loan', one(swapView, 'Loan').contractId, 'ApplySubstitution', {
  requestCid: one(swapView, 'SubstitutionRequest').contractId,
  newValuationCid: one(ofAsset(swapView, MMF), 'CollateralValuation').contractId,
})))
const swapped = one(await contracts('regulator'), 'Loan')
assert.equal(swapped.createArgument.collateralAsset, MMF)
assert.equal(Number(swapped.createArgument.collateralQuantity), 160)
passed('borrower proposes and lender approves a collateral substitution with independent tokens')

// Partial repayment: 30 settles the 5 interest and 25 principal; the lender
// receives it and the final repayment is the remaining 75.
const payment = await exactHolding('borrower', 'CashHolding', undefined, 30)
const splitView = await contracts('borrower')
await ok(web, submitPath, 'borrower', commandBody('borrower', exercise('Loan', one(splitView, 'Loan').contractId, 'PartialRepay', { paymentCid: payment.contractId, valuationCid: null })))
const paidDown = one(await contracts('regulator'), 'Loan')
assert.equal(Number(paidDown.createArgument.amountRepaid), 30)
passed('borrower pays down part of the balance with its own token')

const repayment = await exactHolding('borrower', 'CashHolding', undefined, 75)
const cured = await contracts('borrower')
await ok(web, submitPath, 'borrower', commandBody('borrower', exercise('Loan', one(cured, 'Loan').contractId, 'Repay', { repaymentCid: repayment.contractId })))
const lenderFinal = await contracts('lender')
const borrowerFinal = await contracts('borrower')
assert.deepEqual(named(lenderFinal, 'CashHolding').map(amountOf).sort((a, b) => a - b), [30, 75, 9900])
// Released T-Bills (150 + 50) and returned MMF (160) sit beside the untouched remainders.
assert.deepEqual(ofAsset(named(borrowerFinal, 'CollateralHolding'), TBILL).map(amountOf).sort((a, b) => a - b), [200, 4950, 14850])
assert.deepEqual(ofAsset(named(borrowerFinal, 'CollateralHolding'), MMF).map(amountOf).sort((a, b) => a - b), [160, 15840])
assert.equal(named(borrowerFinal, 'CashHolding').map(amountOf).reduce((a, b) => a + b, 0), 10500 - 105 + 100)
assert.equal(named(await contracts('regulator'), 'LoanClosed').length, 1)
assert.deepEqual(await contracts('outsider'), [])
passed('repayment preserves expected holdings and role visibility')
console.log(`${checks} authenticated integration checks passed.`)
