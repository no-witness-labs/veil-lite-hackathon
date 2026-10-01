// Self-custody borrower on Canton LocalNet. The wallet's Ed25519 key is made
// here and never leaves this process, as it would stay in a browser: the
// participant prepares each transaction, the wallet checks it (verify.mjs) and
// signs its hash, and the participant executes it. Every borrower step is
// signed by the wallet alone.
//
// Needs a LocalNet whose participant 1 JSON API is on :3975 with auth off (e.g.
// BitSafe DecMan's hackathon LocalNet) and the DARs built:
//   dpm build && (cd wallet && dpm build)
// Usage: CANTON_TOKEN=<localnet token> node wallet/localnet/demo.mjs
import { generateKeyPairSync, sign as edSign, createPublicKey, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { VerificationError, toBase64, verifyPrepared } from './verify.mjs'

const J = process.env.JSON_API ?? 'http://localhost:3975'
const TOKEN = process.env.CANTON_TOKEN
if (!TOKEN) throw new Error('set CANTON_TOKEN to the LocalNet ledger API token')
const USER = process.env.LEDGER_USER ?? 'ledger-api-user'
const REPO = new URL('../..', import.meta.url).pathname
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const TB = 'Tokenized T-Bill / MMF'
const RUN = Date.now()
// VEIL_DEMO_STEP=1 pauses before each step until a line arrives on stdin, for
// presenting or recording the demo at a human pace.
const lines = process.env.VEIL_DEMO_STEP ? (await import('node:readline')).createInterface({ input: process.stdin })[Symbol.asyncIterator]() : null
const step = async (t) => { console.log(`\n==> ${t}`); if (lines) await lines.next() }
const info = (t) => console.log(`    ${t}`)
const short = (p) => String(p).split('::')[0]

async function call(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(J + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data).slice(0, 400)}`)
  return data
}
const created = (tx, entity) => (tx.events ?? []).map((e) => e.CreatedEvent).find((e) => e?.templateId.endsWith(`:${entity}`))

async function localParty(hint) {
  const party = (await call('/v2/parties', { partyIdHint: `${hint}-${RUN}`, identityProviderId: '', localMetadata: { annotations: {} } })).partyDetails.party
  await call(`/v2/users/${USER}/rights`, { userId: USER, identityProviderId: '', rights: [{ kind: { CanActAs: { value: { party } } } }, { kind: { CanReadAs: { value: { party } } } }] })
  return party
}
async function submitLocal(actAs, command) {
  const r = await call('/v2/commands/submit-and-wait-for-transaction', { commands: { commands: [command], commandId: `wallet-demo-${randomUUID()}`, userId: USER, actAs, readAs: actAs } })
  return r.transaction
}

// --- the wallet: key pair, external party, and signing
await step('The wallet makes its own key and becomes a Canton party')
const { privateKey } = generateKeyPairSync('ed25519')
const publicKey = Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url').toString('base64')
const signature = (hashB64, signedBy) => ({ format: 'SIGNATURE_FORMAT_CONCAT', signature: edSign(null, Buffer.from(hashB64, 'base64'), privateKey).toString('base64'), signedBy, signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519' })
const synchronizer = (await call('/v2/state/connected-synchronizers')).connectedSynchronizers[0].synchronizerId
const topology = await call('/v2/parties/external/generate-topology', { synchronizer, partyHint: `veil-wallet-${RUN}`, publicKey: { format: 'CRYPTO_KEY_FORMAT_RAW', keyData: publicKey, keySpec: 'SIGNING_KEY_SPEC_EC_CURVE25519' } })
const WALLET = (await call('/v2/parties/external/allocate', { synchronizer, onboardingTransactions: topology.topologyTransactions.map((transaction) => ({ transaction })), multiHashSignatures: [signature(topology.multiHash, topology.publicKeyFingerprint)], identityProviderId: '', userId: USER, waitForAllocation: true })).partyId
const FINGERPRINT = topology.publicKeyFingerprint
info(`wallet party ${short(WALLET)} (key fingerprint ${FINGERPRINT.slice(0, 16)}…); the private key never left this process`)
let signed = 0
// The wallet signs only after verify.mjs has decoded the prepared transaction,
// recomputed its V2 hash, and matched it to the intent: this exercise, on this
// contract, with these arguments, submitted by the wallet alone. On any
// mismatch it refuses, and the demo stops.
async function walletSigns(what, command) {
  const intent = { actAs: [WALLET], exercise: command.ExerciseCommand }
  const prepared = await call('/v2/interactive-submission/prepare', { userId: USER, commandId: `wallet-${randomUUID()}`, commands: [command], actAs: [WALLET], readAs: [WALLET], disclosedContracts: [], synchronizerId: synchronizer, packageIdSelectionPreference: [] })
  let verified
  try {
    verified = await verifyPrepared(prepared, intent)
  } catch (error) {
    if (error instanceof VerificationError) info(`wallet REFUSED to sign "${what}": ${error.message}`)
    throw error
  }
  info(`wallet verified: ${verified.summary}`)
  const result = await call('/v2/interactive-submission/executeAndWaitForTransaction', {
    preparedTransaction: prepared.preparedTransaction,
    partySignatures: { signatures: [{ party: WALLET, signatures: [signature(toBase64(verified.hash), FINGERPRINT)] }] },
    submissionId: randomUUID(), userId: USER, hashingSchemeVersion: prepared.hashingSchemeVersion, deduplicationPeriod: { Empty: {} },
  })
  signed += 1
  info(`wallet signed: ${what}  (hash ${prepared.preparedTransactionHash.slice(0, 12)}…, recomputed and matched, ${prepared.hashingSchemeVersion})`)
  return result.transaction
}
const exercise = (entity, contractId, choice, choiceArgument) => ({ ExerciseCommand: { templateId: entity, contractId, choice, choiceArgument } })

await step('Installing veil-wallet on participant 1')
const dar = readFileSync(`${REPO}wallet/.daml/dist/veil-wallet-0.1.0.dar`)
const up = await fetch(`${J}/v2/packages`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: dar })
if (!up.ok) throw new Error(`DAR upload → ${up.status} ${await up.text()}`)
info('uploaded and vetted')

await step('Issuer, lender, valuer and regulator (ordinary parties on participant 1)')
const [ISSUER, LENDER, VALUER, REGULATOR] = await Promise.all(['veil-issuer', 'veil-lender', 'veil-valuer', 'veil-regulator'].map(localParty))
info(`lender ${short(LENDER)} · valuer ${short(VALUER)}`)

await step('The issuer grants the wallet 150 T-Bill units and 105 cash; the wallet accepts')
const cg = created(await submitLocal([ISSUER], { CreateCommand: { templateId: '#veil-wallet:Veil.Wallet.Onboarding:CollateralGrant', createArguments: { issuer: ISSUER, owner: WALLET, asset: TB, quantity: '150.0' } } }), 'CollateralGrant').contractId
const kg = created(await submitLocal([ISSUER], { CreateCommand: { templateId: '#veil-wallet:Veil.Wallet.Onboarding:CashGrant', createArguments: { issuer: ISSUER, owner: WALLET, amount: '105.0' } } }), 'CashGrant').contractId
const collateral = created(await walletSigns('accept 150 T-Bill units', exercise('#veil-wallet:Veil.Wallet.Onboarding:CollateralGrant', cg, 'CollateralGrant_Accept', {})), 'CollateralHolding').contractId
const ownCash = created(await walletSigns('accept 105 cash', exercise('#veil-wallet:Veil.Wallet.Onboarding:CashGrant', kg, 'CashGrant_Accept', {})), 'CashHolding').contractId

await step('Lender and valuer invite the wallet to a T-Bill price stream at 1.00; the wallet accepts')
const invite = created(await submitLocal([LENDER, VALUER], { CreateCommand: { templateId: '#veil-wallet:Veil.Wallet.Onboarding:StreamInvite', createArguments: { valuationAgent: VALUER, lender: LENDER, borrower: WALLET, regulator: REGULATOR, collateralAsset: TB, initialPrice: '1.0' } } }), 'StreamInvite').contractId
const mark = created(await walletSigns('join the price stream', exercise('#veil-wallet:Veil.Wallet.Onboarding:StreamInvite', invite, 'StreamInvite_Accept', {})), 'CollateralValuation').contractId

await step('The lender funds an offer of 100; the wallet accepts, locking its 150 units')
const lenderCash = created(await submitLocal([ISSUER, LENDER], { CreateCommand: { templateId: '#veil-lite:Veil:CashHolding', createArguments: { issuer: ISSUER, owner: LENDER, amount: '100.0' } } }), 'CashHolding').contractId
const maturity = new Date(Date.now() + 30 * 864e5).toISOString()
const offer = created(await submitLocal([LENDER], exercise('#veil-lite:Veil:CashHolding', lenderCash, 'MakeOffer', { borrower: WALLET, regulator: REGULATOR, valuationAgent: VALUER, valuationCid: mark, principal: '100.0', interest: '5.0', collateralAsset: TB, collateralQuantity: '150.0', maturity, liquidationThresholdLtv: '90.0', marginCallWindowSeconds: '60', expiresAt: null })), 'LoanOffer').contractId
const acceptTx = await walletSigns('accept the loan (100 against 150 units)', exercise('#veil-lite:Veil:LoanOffer', offer, 'Accept', { collateralCid: collateral, valuationCid: mark }))
let loan = created(acceptTx, 'Loan').contractId
const principal = created(acceptTx, 'CashHolding').contractId

await step('The valuer drops the price to 0.62 (LTV 107.5%); the lender issues a margin call')
const stressed = created(await submitLocal([VALUER], exercise('#veil-lite:Veil:CollateralValuation', mark, 'Publish', { unitPrice: '0.62' })), 'CollateralValuation').contractId
loan = created(await submitLocal([LENDER], exercise('#veil-lite:Veil:Loan', loan, 'IssueMarginCall', { valuationCid: stressed })), 'Loan').contractId
info('margin call open')

await step('The wallet cures the call by paying down 30')
const split = await walletSigns('split 30 from the principal', exercise('#veil-lite:Veil:CashHolding', principal, 'Split', { splitAmount: '30.0' }))
const [thirty, seventy] = (split.events ?? []).map((e) => e.CreatedEvent).filter((e) => e?.templateId.endsWith(':CashHolding')).sort((a, b) => Number(a.createArgument.amount) - Number(b.createArgument.amount)).map((e) => e.contractId)
const curedTx = await walletSigns('pay down 30', exercise('#veil-lite:Veil:Loan', loan, 'PartialRepay', { paymentCid: thirty, valuationCid: stressed }))
loan = created(curedTx, 'Loan')
info(`margin call after pay-down: ${loan.createArgument.marginCall === null ? 'cleared' : 'still open'}`)

await step('The wallet repays the remaining 75 and gets its collateral back')
loan = created(await walletSigns('pay down 70', exercise('#veil-lite:Veil:Loan', loan.contractId, 'PartialRepay', { paymentCid: seventy, valuationCid: stressed })), 'Loan').contractId
const splitOwn = (await walletSigns('split 5 from its own cash', exercise('#veil-lite:Veil:CashHolding', ownCash, 'Split', { splitAmount: '5.0' }))).events.map((e) => e.CreatedEvent).filter((e) => e?.templateId.endsWith(':CashHolding'))
const five = splitOwn.find((e) => e.createArgument.amount === '5.0000000000').contractId
const hundred = splitOwn.find((e) => e.createArgument.amount === '100.0000000000').contractId
const closed = created(await walletSigns('repay the last 5', exercise('#veil-lite:Veil:Loan', loan, 'Repay', { repaymentCid: five })), 'LoanClosed')
info(`loan closed: ${closed.createArgument.reason}, collateral released: ${closed.createArgument.collateralReleased}`)

await step('Without the key, the participant cannot act for the wallet')
// Target the wallet's live 100 cash, so the only reason to refuse is the missing signature.
const REFUSAL = /cannot submit as the given submitter|did not provide an external signature/i
let refusal = null
try {
  await submitLocal([WALLET], exercise('#veil-lite:Veil:CashHolding', hundred, 'Split', { splitAmount: '1.0' }))
} catch (error) {
  refusal = String(error.message)
}
if (refusal === null) throw new Error('a plain submission as the wallet succeeded without its signature')
if (!REFUSAL.test(refusal)) throw new Error(`refused for another reason: ${refusal.slice(0, 300)}`)
info(`plain submission as the wallet, on its live 100 cash, refused: ${refusal.match(REFUSAL)[0]}`)

await step('Summary')
info(`${signed} transactions signed by the wallet's own key; none by the participant on its behalf`)
if (lines) process.exit(0)
