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
import { generateKeyPairSync, sign as edSign, createHash, createPublicKey, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
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
// recomputed its V2 hash, and matched it to the intent: the whole transaction
// the wallet expects, node for node (this exercise, on this contract, with
// these arguments, and exactly these fetches, archives and creates below it),
// in the pinned packages, submitted by the wallet alone. On any mismatch it
// refuses, and the demo stops. The expected tree is built here from what the
// wallet is doing, never from the prepared transaction.
async function walletSigns(what, entity, contractId, choice, choiceArgument, children) {
  const command = { ExerciseCommand: { templateId: commandTemplate(entity), contractId, choice, choiceArgument } }
  const intent = { actAs: [WALLET], packages: PACKAGES, roots: [exerciseOf(entity, contractId, choice, choiceArgument, [WALLET], children)] }
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

// --- the packages the wallet trusts, read from the DAR it installs
//
// A .dalf is a DamlLf Archive { payload = 3, hash = 4 }; the package id is the
// SHA-256 of the payload, recomputed here, and the payload's LF 2 package
// metadata names the package. veil-wallet is the DAR's main package; veil-lite
// is the version veil-wallet was compiled against, bundled in the same DAR and
// installed by the same upload. Its contracts are the ones veil-wallet's
// choices create, so every command below names these exact package ids.
function protoFields(buf) {
  const out = []
  let at = 0
  const varint = () => {
    let r = 0n
    for (let shift = 0n; ; shift += 7n) {
      if (at >= buf.length) throw new Error('dalf: truncated varint')
      const b = buf[at++]
      r |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) return r
    }
  }
  while (at < buf.length) {
    const key = Number(varint())
    const wire = key & 7
    if (wire === 0) out.push([key >> 3, varint()])
    else if (wire === 2) {
      const n = Number(varint())
      if (at + n > buf.length) throw new Error('dalf: truncated field')
      out.push([key >> 3, buf.subarray(at, at + n)])
      at += n
    } else if (wire === 1 || wire === 5) at += wire === 1 ? 8 : 4
    else throw new Error(`dalf: wire type ${wire}`)
  }
  return out
}
const field = (fields, no) => fields.find(([n]) => n === no)?.[1]
function unzip(buf) {
  let end = buf.length - 22
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error('the DAR is not a zip file')
  const files = new Map()
  let at = buf.readUInt32LE(end + 16)
  for (let i = buf.readUInt16LE(end + 10); i > 0; i -= 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('the DAR has a bad zip directory')
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLength = buf.readUInt16LE(at + 28)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength)
    const local = buf.readUInt32LE(at + 42)
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
    if (method !== 0 && method !== 8) throw new Error(`the DAR entry ${name} uses zip method ${method}`)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    files.set(name, method === 8 ? inflateRawSync(raw) : raw)
  }
  return files
}
function dalfPackage(bytes, path) {
  const archive = protoFields(bytes)
  if ((field(archive, 1) ?? 0n) !== 0n) throw new Error(`${path} is not hashed with SHA-256`)
  const payload = field(archive, 3)
  if (!payload) throw new Error(`${path} has no payload`)
  const id = createHash('sha256').update(payload).digest('hex')
  if (Buffer.from(field(archive, 4) ?? []).toString() !== id) throw new Error(`${path}: the package id is not the hash of its payload`)
  const lf2 = field(protoFields(payload), 4)
  if (!lf2) throw new Error(`${path} is not a Daml-LF 2 package`)
  const pkg = protoFields(lf2)
  const strings = pkg.filter(([n]) => n === 2).map(([, s]) => Buffer.from(s).toString())
  const metadata = protoFields(field(pkg, 4) ?? Buffer.alloc(0))
  const name = strings[Number(field(metadata, 1) ?? -1)]
  if (!name) throw new Error(`${path} has no package name`)
  return { id, name, version: strings[Number(field(metadata, 2) ?? -1)] }
}
function walletPackages(darBytes) {
  const files = unzip(darBytes)
  const manifest = Buffer.from(files.get('META-INF/MANIFEST.MF') ?? []).toString().replace(/\r?\n /g, '')
  const mainPath = /^Main-Dalf: (.+)$/m.exec(manifest)?.[1]?.trim()
  if (!mainPath || !files.has(mainPath)) throw new Error('the DAR names no main package')
  const main = dalfPackage(files.get(mainPath), mainPath)
  if (main.name !== 'veil-wallet') throw new Error(`the DAR's main package is ${main.name}, not veil-wallet`)
  const lite = [...files].filter(([path]) => path.endsWith('.dalf')).map(([path, bytes]) => dalfPackage(bytes, path)).filter((p) => p.name === 'veil-lite')
  if (lite.length !== 1) throw new Error(`the DAR holds ${lite.length} veil-lite packages, expected 1`)
  return { main, lite: lite[0] }
}

// Templates by package; commands name the pinned package id, intents the package name.
const TEMPLATES = {
  CashGrant: 'veil-wallet:Veil.Wallet.Onboarding', CollateralGrant: 'veil-wallet:Veil.Wallet.Onboarding', StreamInvite: 'veil-wallet:Veil.Wallet.Onboarding',
  CashHolding: 'veil-lite:Veil', CollateralHolding: 'veil-lite:Veil', ValuationStream: 'veil-lite:Veil', CollateralValuation: 'veil-lite:Veil',
  LoanOffer: 'veil-lite:Veil', Loan: 'veil-lite:Veil', LoanClosed: 'veil-lite:Veil',
}
let PACKAGES
const commandTemplate = (entity) => { const [pkg, module] = TEMPLATES[entity].split(':'); return `${PACKAGES[pkg]}:${module}:${entity}` }
const intentTemplate = (entity) => `#${TEMPLATES[entity]}:${entity}`
const exercise = (entity, contractId, choice, choiceArgument) => ({ ExerciseCommand: { templateId: commandTemplate(entity), contractId, choice, choiceArgument } })

// --- the transaction tree each wallet step must produce (see verify.mjs for the format)
const ANY_TIME = { $any: 'timestamp' } // a ledger time the wallet cannot know in advance
const exerciseOf = (entity, contractId, choice, choiceArgument, actingParties, children) => ({ exercise: { templateId: intentTemplate(entity), contractId, choice, choiceArgument, consuming: true, actingParties, children } })
const archiveOf = (entity, contractId, signatories) => exerciseOf(entity, contractId, 'Archive', {}, signatories, [])
const fetchOf = (entity, contractId, actingParties) => ({ fetch: { templateId: intentTemplate(entity), contractId, actingParties } })
const createOf = (entity, createArguments, signatories, observers = [], label) => ({ create: { templateId: intentTemplate(entity), createArguments, signatories, stakeholders: [...new Set([...signatories, ...observers])], ...(label ? { label } : {}) } })

await step('Installing veil-wallet on participant 1')
const dar = readFileSync(`${REPO}wallet/.daml/dist/veil-wallet-0.1.0.dar`)
const { main: walletPkg, lite: litePkg } = walletPackages(dar)
PACKAGES = { 'veil-wallet': walletPkg.id, 'veil-lite': litePkg.id }
const up = await fetch(`${J}/v2/packages`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: dar })
if (!up.ok) throw new Error(`DAR upload → ${up.status} ${await up.text()}`)
const listed = new Set((await call('/v2/packages')).packageIds)
for (const [name, id] of Object.entries(PACKAGES)) if (!listed.has(id)) throw new Error(`${name} ${id} is not on the participant after the upload`)
info(`uploaded and vetted; the wallet pins veil-wallet ${walletPkg.version} ${walletPkg.id.slice(0, 12)}… and veil-lite ${litePkg.version} ${litePkg.id.slice(0, 12)}…`)

await step('Issuer, lender, valuer and regulator (ordinary parties on participant 1)')
const [ISSUER, LENDER, VALUER, REGULATOR] = await Promise.all(['veil-issuer', 'veil-lender', 'veil-valuer', 'veil-regulator'].map(localParty))
info(`lender ${short(LENDER)} · valuer ${short(VALUER)}`)
const cashOf = (owner, amount) => createOf('CashHolding', { issuer: ISSUER, owner, amount }, [ISSUER, owner])
const collateralOf = (owner, quantity) => createOf('CollateralHolding', { issuer: ISSUER, owner, asset: TB, quantity }, [ISSUER, owner])
// A Loan or LoanOffer choice fetches and archives with its authorizers (issuer,
// lender, wallet) that are stakeholders of the contract: here issuer and wallet.
const fetchCash = (cid) => fetchOf('CashHolding', cid, [ISSUER, WALLET])
const archiveCash = (cid) => archiveOf('CashHolding', cid, [ISSUER, WALLET])

await step('The issuer grants the wallet 150 T-Bill units and 105 cash; the wallet accepts')
const cg = created(await submitLocal([ISSUER], { CreateCommand: { templateId: commandTemplate('CollateralGrant'), createArguments: { issuer: ISSUER, owner: WALLET, asset: TB, quantity: '150.0' } } }), 'CollateralGrant').contractId
const kg = created(await submitLocal([ISSUER], { CreateCommand: { templateId: commandTemplate('CashGrant'), createArguments: { issuer: ISSUER, owner: WALLET, amount: '105.0' } } }), 'CashGrant').contractId
const collateral = created(await walletSigns('accept 150 T-Bill units', 'CollateralGrant', cg, 'CollateralGrant_Accept', {}, [collateralOf(WALLET, '150.0')]), 'CollateralHolding').contractId
const ownCash = created(await walletSigns('accept 105 cash', 'CashGrant', kg, 'CashGrant_Accept', {}, [cashOf(WALLET, '105.0')]), 'CashHolding').contractId

await step('Lender and valuer invite the wallet to a T-Bill price stream at 1.00; the wallet accepts')
const invite = created(await submitLocal([LENDER, VALUER], { CreateCommand: { templateId: commandTemplate('StreamInvite'), createArguments: { valuationAgent: VALUER, lender: LENDER, borrower: WALLET, regulator: REGULATOR, collateralAsset: TB, initialPrice: '1.0' } } }), 'StreamInvite').contractId
const counterparties = [VALUER, LENDER, WALLET]
const streamFields = { valuationAgent: VALUER, lender: LENDER, borrower: WALLET, regulator: REGULATOR, collateralAsset: TB }
const firstMark = created(await walletSigns('join the price stream', 'StreamInvite', invite, 'StreamInvite_Accept', {}, [
  createOf('ValuationStream', streamFields, counterparties, [REGULATOR], 'stream'),
  exerciseOf('ValuationStream', { $created: 'stream' }, 'PublishInitial', { unitPrice: '1.0' }, [VALUER], [
    createOf('CollateralValuation', { ...streamFields, streamId: { $created: 'stream' }, unitPrice: '1.0', observedAt: ANY_TIME }, counterparties, [REGULATOR]),
  ]),
]), 'CollateralValuation')
const mark = firstMark.contractId
// PublishInitial archives the stream in the same transaction; its id lives on in the mark.
const STREAM = firstMark.createArgument.streamId

await step('The lender funds an offer of 100; the wallet accepts, locking its 150 units')
const lenderCash = created(await submitLocal([ISSUER, LENDER], { CreateCommand: { templateId: commandTemplate('CashHolding'), createArguments: { issuer: ISSUER, owner: LENDER, amount: '100.0' } } }), 'CashHolding').contractId
const maturity = new Date(Date.now() + 30 * 864e5).toISOString()
const offer = created(await submitLocal([LENDER], exercise('CashHolding', lenderCash, 'MakeOffer', { borrower: WALLET, regulator: REGULATOR, valuationAgent: VALUER, valuationCid: mark, principal: '100.0', interest: '5.0', collateralAsset: TB, collateralQuantity: '150.0', maturity, liquidationThresholdLtv: '90.0', marginCallWindowSeconds: '60', expiresAt: null })), 'LoanOffer').contractId
const terms = { issuer: ISSUER, lender: LENDER, borrower: WALLET, regulator: REGULATOR, valuationAgent: VALUER, valuationStreamId: STREAM, principal: '100.0', interest: '5.0', collateralAsset: TB, collateralQuantity: '150.0', maturity }
const loanSignatories = [ISSUER, LENDER, WALLET]
const loanOf = (amountRepaid) => createOf('Loan', { ...terms, liquidationThresholdLtv: '90.0', marginCallWindowSeconds: '60', marginCall: null, collateralLocked: true, amountRepaid }, loanSignatories, [REGULATOR])
const acceptTx = await walletSigns('accept the loan (100 against 150 units)', 'LoanOffer', offer, 'Accept', { collateralCid: collateral, valuationCid: mark }, [
  fetchOf('CollateralValuation', mark, [LENDER, WALLET]),
  fetchOf('CollateralHolding', collateral, [ISSUER, WALLET]),
  archiveOf('CollateralHolding', collateral, [ISSUER, WALLET]),
  cashOf(WALLET, '100.0'),
  loanOf(null),
])
let loan = created(acceptTx, 'Loan').contractId
const principal = created(acceptTx, 'CashHolding').contractId

await step('The valuer drops the price to 0.62 (LTV 107.5%); the lender issues a margin call')
const stressed = created(await submitLocal([VALUER], exercise('CollateralValuation', mark, 'Publish', { unitPrice: '0.62' })), 'CollateralValuation').contractId
loan = created(await submitLocal([LENDER], exercise('Loan', loan, 'IssueMarginCall', { valuationCid: stressed })), 'Loan').contractId
info('margin call open')

await step('The wallet cures the call by paying down 30')
const split = await walletSigns('split 30 from the principal', 'CashHolding', principal, 'Split', { splitAmount: '30.0' }, [cashOf(WALLET, '30.0'), cashOf(WALLET, '70.0')])
const [thirty, seventy] = (split.events ?? []).map((e) => e.CreatedEvent).filter((e) => e?.templateId.endsWith(':CashHolding')).sort((a, b) => Number(a.createArgument.amount) - Number(b.createArgument.amount)).map((e) => e.contractId)
// With the call open, PartialRepay also checks the fresh mark; the cure clears the call.
const curedTx = await walletSigns('pay down 30', 'Loan', loan, 'PartialRepay', { paymentCid: thirty, valuationCid: stressed }, [
  fetchCash(thirty), fetchOf('CollateralValuation', stressed, [LENDER, WALLET]), archiveCash(thirty), cashOf(LENDER, '30.0'), loanOf('30.0'),
])
loan = created(curedTx, 'Loan')
info(`margin call after pay-down: ${loan.createArgument.marginCall === null ? 'cleared' : 'still open'}`)

await step('The wallet repays the remaining 75 and gets its collateral back')
loan = created(await walletSigns('pay down 70', 'Loan', loan.contractId, 'PartialRepay', { paymentCid: seventy, valuationCid: stressed }, [
  fetchCash(seventy), archiveCash(seventy), cashOf(LENDER, '70.0'), loanOf('100.0'),
]), 'Loan').contractId
const splitOwn = (await walletSigns('split 5 from its own cash', 'CashHolding', ownCash, 'Split', { splitAmount: '5.0' }, [cashOf(WALLET, '5.0'), cashOf(WALLET, '100.0')])).events.map((e) => e.CreatedEvent).filter((e) => e?.templateId.endsWith(':CashHolding'))
const five = splitOwn.find((e) => e.createArgument.amount === '5.0000000000').contractId
const hundred = splitOwn.find((e) => e.createArgument.amount === '100.0000000000').contractId
const closed = created(await walletSigns('repay the last 5', 'Loan', loan, 'Repay', { repaymentCid: five }, [
  fetchCash(five), archiveCash(five), cashOf(LENDER, '5.0'), collateralOf(WALLET, '150.0'),
  createOf('LoanClosed', { ...terms, reason: 'Repaid', collateralReleased: true, amountRepaid: '105.0', closedAt: ANY_TIME, liquidationUnitPrice: null, collateralSeized: null, collateralReturned: '150.0' }, loanSignatories, [REGULATOR]),
]), 'LoanClosed')
info(`loan closed: ${closed.createArgument.reason}, collateral released: ${closed.createArgument.collateralReleased}`)

await step('Without the key, the participant cannot act for the wallet')
// Target the wallet's live 100 cash, so the only reason to refuse is the missing signature.
const REFUSAL = /cannot submit as the given submitter|did not provide an external signature/i
let refusal = null
try {
  await submitLocal([WALLET], exercise('CashHolding', hundred, 'Split', { splitAmount: '1.0' }))
} catch (error) {
  refusal = String(error.message)
}
if (refusal === null) throw new Error('a plain submission as the wallet succeeded without its signature')
if (!REFUSAL.test(refusal)) throw new Error(`refused for another reason: ${refusal.slice(0, 300)}`)
info(`plain submission as the wallet, on its live 100 cash, refused: ${refusal.match(REFUSAL)[0]}`)

await step('Summary')
info(`${signed} transactions signed by the wallet's own key; none by the participant on its behalf`)
if (lines) process.exit(0)
