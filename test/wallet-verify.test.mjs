import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  VerificationError, decodePreparedTransaction, fromBase64, hashPreparedTransaction, toBase64, verifyPrepared,
} from '../wallet/localnet/verify.mjs'

// DevNet prepare responses (prepared, never executed) plus one synthetic transaction
// hashed by Canton's Python reference; see each file's `source`.
const DIR = new URL('./fixtures/wallet-hashing/', import.meta.url)
const vectors = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/^vector-|\.json$/g, ''), JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))]))
const single = ['split', 'split-disclosed', 'create-loan', 'synthetic-all-values']

const refused = (pattern) => (error) => error instanceof VerificationError && (pattern === undefined || pattern.test(error.message))
const withIntent = (v, change) => ({ ...v.intent, ...change })
const withExercise = (v, change) => ({ ...v.intent, exercise: { ...v.intent.exercise, ...change } })
const withArgument = (v, change) => withExercise(v, { choiceArgument: { ...v.intent.exercise.choiceArgument, ...change } })

test('the fixtures cover the vectors this suite relies on', () => {
  assert.deepEqual(Object.keys(vectors).sort(), ['create-and-repay', 'create-loan', 'split', 'split-disclosed', 'synthetic-all-values'])
})

for (const [name, v] of Object.entries(vectors)) {
  test(`${name}: the recomputed V2 hash equals the participant's`, async () => {
    const hash = await hashPreparedTransaction(decodePreparedTransaction(v.preparedTransaction))
    assert.equal(toBase64(hash), v.preparedTransactionHash)
  })
}

for (const name of single) {
  test(`${name}: verifies against its intent and returns the hash to sign`, async () => {
    const v = vectors[name]
    const { hash, summary } = await verifyPrepared(v, v.intent)
    assert.equal(toBase64(hash), v.preparedTransactionHash)
    assert.equal(typeof summary, 'string')
  })
}

test('the summary says what is signed: root action, archived and created contracts, amounts', async () => {
  const { summary } = await verifyPrepared(vectors.split, vectors.split.intent)
  const cid = vectors.split.intent.exercise.contractId.slice(0, 10)
  assert.equal(summary, `Veil:CashHolding.Split {splitAmount 1} on ${cid}… as 8e0db906-veil-lender; archives CashHolding ${cid}…; `
    + 'creates CashHolding(owner 8e0db906-veil-lender, amount 1), CashHolding(owner 8e0db906-veil-lender, amount 29)')
  const loan = await verifyPrepared(vectors['create-loan'], vectors['create-loan'].intent)
  assert.match(loan.summary, /^create Veil:Loan as .*; archives nothing; creates Loan\(principal 100, amountRepaid 30\)$/)
})

test('a create-and-exercise has two root actions and is refused for a single-action intent', async () => {
  const v = vectors['create-and-repay']
  await assert.rejects(verifyPrepared(v, v.intent), refused(/2 root actions, expected 1/))
})

test('flipping any byte of the prepared transaction changes its hash or fails to decode, except inside the unhashed event blobs', async () => {
  for (const [name, v] of Object.entries(vectors)) {
    const bytes = fromBase64(v.preparedTransaction)
    // V2 does not hash an input contract's event_blob; Canton authenticates the contract itself.
    const unhashed = decodePreparedTransaction(bytes).metadata.input_contracts.map(({ event_blob: b }) => [b.byteOffset, b.byteOffset + b.length])
    const inBlob = (i) => unhashed.some(([from, to]) => i >= from && i < to)
    let blobBytes = 0
    let rehashed = 0
    for (let i = 0; i < bytes.length; i += 1) {
      const flipped = bytes.slice()
      flipped[i] ^= 0x01
      let hash
      try {
        hash = toBase64(await hashPreparedTransaction(decodePreparedTransaction(flipped)))
      } catch (error) {
        assert.ok(error instanceof VerificationError, `${name}: byte ${i} threw ${error}`)
        assert.ok(!inBlob(i), `${name}: byte ${i} is in an event blob but was refused`)
        continue
      }
      if (inBlob(i)) { blobBytes += 1; assert.equal(hash, v.preparedTransactionHash); continue }
      rehashed += 1
      assert.notEqual(hash, v.preparedTransactionHash, `${name}: byte ${i} of ${bytes.length} did not change the hash`)
    }
    assert.equal(blobBytes, unhashed.reduce((n, [from, to]) => n + to - from, 0))
    assert.ok(rehashed > bytes.length / 2, `${name}: most flips should decode and rehash`)
  }
})

test('a flipped byte outside the event blobs is refused before signing', async () => {
  const v = vectors.split
  const bytes = fromBase64(v.preparedTransaction)
  const [blob] = decodePreparedTransaction(bytes).metadata.input_contracts.map(({ event_blob: b }) => [b.byteOffset, b.byteOffset + b.length])
  for (let i = 0; i < bytes.length; i += 1) {
    if (i >= blob[0] && i < blob[1]) continue
    const flipped = bytes.slice()
    flipped[i] ^= 0x01
    await assert.rejects(verifyPrepared({ ...v, preparedTransaction: toBase64(flipped) }, v.intent), refused(), `byte ${i}`)
  }
})

test('a returned hash that is not the transaction\'s is refused', async () => {
  const v = vectors.split
  const wrong = fromBase64(v.preparedTransactionHash)
  wrong[31] ^= 0x01
  await assert.rejects(verifyPrepared({ ...v, preparedTransactionHash: toBase64(wrong) }, v.intent), refused(/is not the hash of the prepared transaction/))
  await assert.rejects(verifyPrepared({ ...v, preparedTransactionHash: vectors['split-disclosed'].preparedTransactionHash }, v.intent), refused(/is not the hash/))
  await assert.rejects(verifyPrepared({ ...v, preparedTransactionHash: '' }, v.intent), refused(/is not the hash/))
  await assert.rejects(verifyPrepared({ ...v, preparedTransactionHash: undefined }, v.intent), refused())
  // Another vector's transaction under this vector's hash.
  await assert.rejects(verifyPrepared({ ...v, preparedTransaction: vectors['split-disclosed'].preparedTransaction }, v.intent), refused(/is not the hash/))
})

test('any hashing scheme other than V2 is refused', async () => {
  const v = vectors.split
  for (const scheme of ['HASHING_SCHEME_VERSION_V3', 'HASHING_SCHEME_VERSION_UNSPECIFIED', 2, undefined]) {
    await assert.rejects(verifyPrepared({ ...v, hashingSchemeVersion: scheme }, v.intent), refused(/is not V2/), String(scheme))
  }
})

test('a transaction that is not what the wallet meant is refused', async () => {
  const v = vectors.split
  const { lender, borrower } = { lender: v.intent.actAs[0], borrower: v.intent.actAs[0].replace('veil-lender', 'veil-borrower') }
  const other = `00${'ab'.repeat(32)}`
  const cases = [
    ['another choice', withExercise(v, { choice: 'MakeOffer' }), /root choice is Split, expected MakeOffer/],
    ['another contract', withExercise(v, { contractId: other }), /on contract .* expected/],
    ['another amount', withArgument(v, { splitAmount: '2.0' }), /choice argument splitAmount differs/],
    ['an argument the choice lacks', withArgument(v, { paymentCid: other }), /choice argument paymentCid differs/],
    ['an extra submitter', withIntent(v, { actAs: [lender, borrower] }), /submitters are/],
    ['another submitter', withIntent(v, { actAs: [borrower] }), /submitters are/],
    ['no submitter', withIntent(v, { actAs: [] }), /names no submitter/],
    ['another template', withExercise(v, { templateId: '#veil-lite:Veil:CollateralHolding' }), /root exercise is on Veil:CashHolding/],
    ['another package', withExercise(v, { templateId: '#veil-wallet:Veil:CashHolding' }), /root exercise is on/],
    ['another package id', withExercise(v, { templateId: `${'00'.repeat(32)}:Veil:CashHolding` }), /root exercise is on/],
    ['a create', { actAs: [lender], create: { templateId: '#veil-lite:Veil:CashHolding', createArguments: {} } }, /root action is exercise, expected a create/],
    ['no action', { actAs: [lender] }, /neither an exercise nor a create/],
  ]
  for (const [what, intent, pattern] of cases) await assert.rejects(verifyPrepared(v, intent), refused(pattern), what)
  // Decimal strings compare by value, as Daml does.
  for (const amount of ['1', '1.0000000000', '01.0']) await verifyPrepared(v, withArgument(v, { splitAmount: amount }))
})

test('a create that is not what the wallet meant is refused', async () => {
  const v = vectors['create-loan']
  const create = (change) => ({ ...v.intent, create: { ...v.intent.create, ...change } })
  const args = (change) => create({ createArguments: { ...v.intent.create.createArguments, ...change } })
  const cases = [
    ['another template', create({ templateId: '#veil-lite:Veil:LoanOffer' }), /root create is of Veil:Loan/],
    ['another principal', args({ principal: '1000.0' }), /create argument principal differs/],
    ['no repayment', args({ amountRepaid: null }), /amountRepaid differs/],
    ['another margin deadline', args({ marginCall: { deadline: '2026-10-01T02:00:00Z' } }), /marginCall differs/],
    ['another window', args({ marginCallWindowSeconds: '60' }), /marginCallWindowSeconds differs/],
    ['an exercise', { actAs: v.intent.actAs, exercise: { templateId: '#veil-lite:Veil:Loan', contractId: '00', choice: 'Repay' } }, /root action is create, expected an exercise/],
  ]
  for (const [what, intent, pattern] of cases) await assert.rejects(verifyPrepared(v, intent), refused(pattern), what)
})

test('every Daml value type is compared with the intent', async () => {
  const v = vectors['synthetic-all-values']
  const changes = {
    amount: '12.6', count: '42', big: '1', day: '2025-10-01', before1970: '1969-12-31T23:59:58.765434Z', at: '2026-10-01T09:20:17.904788Z',
    flag: true, nothing: { x: 1 }, note: 'hello', empty: ' ', to: v.intent.actAs[0], ref: `00${'08'.repeat(32)}`, none: 'x', someNone: null,
    someRec: { x: '2' }, items: ['1'], noItems: ['1'], side: { tag: 'Sell', value: { limit: '3' } }, sideNoId: { tag: 'Buy', value: {} },
    color: 'Blue', colorNoId: 'Red', labels: { a: '1', b: '3' }, weights: [[v.intent.actAs[0], '2'], [v.intent.exercise.choiceArgument.to, '1']],
    noIdRecord: { '': 'labelled' },
  }
  assert.deepEqual(Object.keys(changes).sort(), Object.keys(v.intent.exercise.choiceArgument).sort())
  for (const [label, value] of Object.entries(changes)) {
    await assert.rejects(verifyPrepared(v, withArgument(v, { [label]: value })), refused(new RegExp(`choice argument ${label} differs`)), label)
  }
})

test('the decoder refuses what a lenient protobuf parser would accept', async () => {
  const v = vectors.split
  const bytes = fromBase64(v.preparedTransaction)
  const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]))
  const tries = [
    ['an unknown field', cat(bytes, [0x18, 0x01]), /unknown field 3/],
    ['the metadata given twice', cat(bytes, [0x12, 0x00]), /metadata given more than once/],
    ['a truncated message', bytes.subarray(0, bytes.length - 1), /truncated/],
    ['a wrong wire type', cat(bytes, [0x10, 0x00]), /wire type 0, expected 2/],
  ]
  for (const [what, b, pattern] of tries) {
    await assert.rejects(verifyPrepared({ ...v, preparedTransaction: toBase64(b) }, v.intent), refused(pattern), what)
  }
  await assert.rejects(verifyPrepared({ ...v, preparedTransaction: 'not base64!' }, v.intent), refused(/not base64/))
})
