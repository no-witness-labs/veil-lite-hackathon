import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  VerificationError, decodePreparedTransaction, fromBase64, hashPreparedTransaction, preparedTransactionSchema, toBase64,
  valueMatches, verifyPrepared,
} from '../wallet/localnet/verify.mjs'

// DevNet prepare responses (prepared, never executed) plus one synthetic transaction
// hashed by Canton's Python reference; see each file's `source`. Each `intent` is
// the full transaction tree the wallet expects.
const DIR = new URL('./fixtures/wallet-hashing/', import.meta.url)
const vectors = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/^vector-|\.json$/g, ''), JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))]))

const refused = (pattern) => (error) => error instanceof VerificationError && (pattern === undefined || pattern.test(error.message))
// A copy of the vector's intent, changed by `edit`.
const changed = (v, edit) => { const intent = structuredClone(v.intent); edit(intent); return intent }
const rootOf = (intent) => intent.roots[0].exercise
const withArgument = (v, change) => changed(v, (i) => Object.assign(rootOf(i).choiceArgument, change))

// --- a protobuf encoder for the verifier's own schema, to build what a dishonest participant could send
const varint = (n) => { let x = BigInt.asUintN(64, BigInt(n)); const o = []; do { let b = Number(x & 0x7fn); x >>= 7n; if (x) b |= 0x80; o.push(b) } while (x); return o }
const te = new TextEncoder()
function encode(obj, schema) {
  const out = []
  for (const no of Object.keys(schema.fields).map(Number).sort((a, b) => a - b)) {
    const [name, type, flag] = schema.fields[no]
    const val = obj[name]
    if (val === undefined) continue
    for (const item of flag === 'repeated' ? val : [val]) {
      if (typeof type === 'object') { const b = encode(item, type); out.push(...varint((no << 3) | 2), ...varint(b.length), ...b); continue }
      if (!flag && (item === '' || item === 0 || item === 0n || item === false || (item instanceof Uint8Array && item.length === 0))) continue
      switch (type) {
        case 'string': { const b = te.encode(item); out.push(...varint((no << 3) | 2), ...varint(b.length), ...b); break }
        case 'bytes': out.push(...varint((no << 3) | 2), ...varint(item.length), ...item); break
        case 'bool': out.push(...varint(no << 3), item ? 1 : 0); break
        case 'int32': case 'uint32': case 'uint64': out.push(...varint(no << 3), ...varint(item)); break
        case 'sint64': { const x = BigInt(item); out.push(...varint(no << 3), ...varint((x << 1n) ^ (x >> 63n))); break }
        case 'sfixed64': { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(item), true); out.push(...varint((no << 3) | 1), ...b); break }
        default: throw new Error(type)
      }
    }
  }
  return out
}
// The vector's transaction changed by `edit`, re-encoded with a correct hash, as a participant would return it.
async function tampered(v, edit) {
  const tx = decodePreparedTransaction(v.preparedTransaction)
  const node = (id) => tx.transaction.nodes.find((n) => n.node_id === id).v1
  edit(tx, node)
  const bytes = Uint8Array.from(encode(tx, preparedTransactionSchema))
  const hash = await hashPreparedTransaction(decodePreparedTransaction(bytes))
  return { ...v, preparedTransaction: toBase64(bytes), preparedTransactionHash: toBase64(hash) }
}
const seed = (n) => new Uint8Array(32).fill(n)

test('the fixtures cover the vectors this suite relies on', () => {
  assert.deepEqual(Object.keys(vectors).sort(), ['create-and-repay', 'create-loan', 'split', 'split-disclosed', 'synthetic-all-values'])
})

for (const [name, v] of Object.entries(vectors)) {
  test(`${name}: the recomputed V2 hash equals the participant's`, async () => {
    const hash = await hashPreparedTransaction(decodePreparedTransaction(v.preparedTransaction))
    assert.equal(toBase64(hash), v.preparedTransactionHash)
  })
  test(`${name}: verifies against its full-tree intent and returns the hash to sign`, async () => {
    const { hash, summary } = await verifyPrepared(v, v.intent)
    assert.equal(toBase64(hash), v.preparedTransactionHash)
    assert.equal(typeof summary, 'string')
  })
}

test('re-encoding a vector unchanged gives the same transaction and hash', async () => {
  for (const v of Object.values(vectors)) {
    const same = await tampered(v, () => {})
    assert.equal(same.preparedTransactionHash, v.preparedTransactionHash)
    await verifyPrepared(same, v.intent)
  }
})

test('the summary says what is signed: root action, archived and created contracts, amounts', async () => {
  const { summary } = await verifyPrepared(vectors.split, vectors.split.intent)
  const cid = rootOf(vectors.split.intent).contractId.slice(0, 10)
  assert.equal(summary, `Veil:CashHolding.Split {splitAmount 1} on ${cid}… as 8e0db906-veil-lender; archives CashHolding ${cid}…; `
    + 'creates CashHolding(owner 8e0db906-veil-lender, amount 1), CashHolding(owner 8e0db906-veil-lender, amount 29)')
  const loan = await verifyPrepared(vectors['create-loan'], vectors['create-loan'].intent)
  assert.match(loan.summary, /^create Veil:Loan as .*; archives nothing; creates Loan\(principal 100, amountRepaid 30\)$/)
})

test('a create-and-exercise has two root actions and is refused for an intent naming one', async () => {
  const v = vectors['create-and-repay']
  const onlyCreate = changed(v, (i) => { i.roots = [i.roots[0]] })
  await assert.rejects(verifyPrepared(v, onlyCreate), refused(/2 root actions, expected 1/))
  const swapped = changed(v, (i) => { i.roots.reverse() })
  await assert.rejects(verifyPrepared(v, swapped), refused(/node 0 is a create, expected an exercise/))
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
  const root = (change) => changed(v, (i) => Object.assign(rootOf(i), change))
  const cases = [
    ['another choice', root({ choice: 'MakeOffer' }), /exercises Veil:CashHolding.Split, expected MakeOffer/],
    ['another contract', root({ contractId: other }), /is on contract .* expected/],
    ['another amount', withArgument(v, { splitAmount: '2.0' }), /choice argument splitAmount differs/],
    ['an argument the choice lacks', withArgument(v, { paymentCid: other }), /choice argument paymentCid differs/],
    ['non-consuming', root({ consuming: false }), /is consuming, expected non-consuming/],
    ['other acting parties', root({ actingParties: [lender, borrower] }), /acting parties are \[8e0db906-veil-lender\]/],
    ['choice observers', root({ choiceObservers: [borrower] }), /choice observers are \[\]/],
    ['an interface', root({ interfaceId: '#veil-lite:Veil:Holding' }), /goes through no interface, expected #veil-lite:Veil:Holding/],
    ['an extra submitter', changed(v, (i) => { i.actAs = [lender, borrower] }), /submitters are/],
    ['another submitter', changed(v, (i) => { i.actAs = [borrower] }), /submitters are/],
    ['no submitter', changed(v, (i) => { i.actAs = [] }), /names no submitter/],
    ['another template', root({ templateId: '#veil-lite:Veil:CollateralHolding' }), /is on veil-lite:Veil:CashHolding, expected #veil-lite:Veil:CollateralHolding/],
    ['another package', root({ templateId: '#veil-wallet:Veil:CashHolding' }), /is on veil-lite:Veil:CashHolding, expected #veil-wallet/],
    ['a create', changed(v, (i) => { i.roots = [{ create: { templateId: '#veil-lite:Veil:CashHolding', createArguments: {}, signatories: [lender], stakeholders: [lender] } }] }), /node 0 is an exercise, expected a create/],
    ['no action', changed(v, (i) => { i.roots = [] }), /names no root action/],
    ['one created contract fewer', changed(v, (i) => { rootOf(i).children.pop() }), /has 2 child nodes, expected 1/],
    ['another created amount', changed(v, (i) => { rootOf(i).children[1].create.createArguments.amount = '28.0' }), /node 2 \(create Veil:CashHolding\) create argument amount differs/],
  ]
  for (const [what, intent, pattern] of cases) await assert.rejects(verifyPrepared(v, intent), refused(pattern), what)
  // Decimal strings compare by value, as Daml does.
  for (const amount of ['1', '1.0000000000', '01.0']) await verifyPrepared(v, withArgument(v, { splitAmount: amount }))
})

test('a create that is not what the wallet meant is refused', async () => {
  const v = vectors['create-loan']
  const create = (change) => changed(v, (i) => Object.assign(i.roots[0].create, change))
  const args = (change) => changed(v, (i) => Object.assign(i.roots[0].create.createArguments, change))
  const lender = v.intent.actAs[2]
  const cases = [
    ['another template', create({ templateId: '#veil-lite:Veil:LoanOffer' }), /is on veil-lite:Veil:Loan, expected #veil-lite:Veil:LoanOffer/],
    ['another principal', args({ principal: '1000.0' }), /create argument principal differs/],
    ['no repayment', args({ amountRepaid: null }), /amountRepaid differs/],
    ['another margin deadline', args({ marginCall: { ...v.intent.roots[0].create.createArguments.marginCall, deadline: '2026-10-01T02:00:00Z' } }), /marginCall differs/],
    ['a margin call missing a field', args({ marginCall: { issuedAt: '2026-10-01T00:00:00Z', deadline: '2026-10-01T01:00:00Z' } }), /marginCall differs/],
    ['another window', args({ marginCallWindowSeconds: '60' }), /marginCallWindowSeconds differs/],
    ['a field left out', changed(v, (i) => { delete i.roots[0].create.createArguments.issuer }), /create argument issuer differs/],
    ['other signatories', create({ signatories: [lender] }), /signatories are/],
    ['other stakeholders', create({ stakeholders: [lender] }), /stakeholders are/],
    ['an exercise', changed(v, (i) => { i.roots = [{ exercise: { templateId: '#veil-lite:Veil:Loan', contractId: '00', choice: 'Repay', choiceArgument: {}, consuming: true, actingParties: [lender], children: [] } }] }), /node 0 is a create, expected an exercise of #veil-lite:Veil:Loan Repay/],
  ]
  for (const [what, intent, pattern] of cases) await assert.rejects(verifyPrepared(v, intent), refused(pattern), what)
})

test('every Daml value type is compared with the intent', async () => {
  const v = vectors['synthetic-all-values']
  const changes = {
    amount: '12.6', count: '42', big: '1', day: '2025-10-01', before1970: '1969-12-31T23:59:58.765434Z', at: '2026-10-01T09:20:17.904788Z',
    flag: true, nothing: { x: 1 }, note: 'hello', empty: ' ', to: v.intent.actAs[0], ref: `00${'08'.repeat(32)}`, none: 'x', someNone: null,
    someRec: { x: '2' }, items: ['1'], noItems: ['1'], side: { tag: 'Sell', value: { limit: '3' } }, sideNoId: { tag: 'Buy', value: {} },
    color: 'Blue', colorNoId: 'Red', labels: { a: '1', b: '3' }, weights: [[v.intent.actAs[0], '2'], [rootOf(v.intent).choiceArgument.to, '1']],
    noIdRecord: { '': 'labelled' },
  }
  assert.deepEqual(Object.keys(changes).sort(), Object.keys(rootOf(v.intent).choiceArgument).sort())
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

// --- audited bypasses: each was accepted before the whole tree was checked, and must now be refused

test('bypass 1: extra nodes under a matching root are refused', async () => {
  const v = vectors.split
  const signer = v.intent.actAs[0]
  const attacker = signer.replace('veil-lender', 'veil-attacker')
  const victim = `00${'cd'.repeat(32)}`
  const steal = (create) => {
    create.contract_id = `00${'ef'.repeat(32)}`
    create.argument.record.fields.find((f) => f.label === 'owner').value.party = attacker
    create.argument.record.fields.find((f) => f.label === 'amount').value.numeric = '1000000.0000000000'
    create.stakeholders = [create.signatories[0], attacker]
  }
  const archiveOf = (exercise, cid) => Object.assign(structuredClone(exercise), {
    contract_id: cid, choice_id: 'Archive', consuming: true, children: [], exercise_result: { sum: 'unit', unit: {} },
    chosen_value: { sum: 'record', record: { record_id: { package_id: exercise.template_id.package_id, module_name: 'DA.Internal.Template', entity_name: 'Archive' }, fields: [] } },
  })
  // The audited proof: archive another wallet-owned contract and create 1000000 for an attacker.
  const extra = await tampered(v, (tx, node) => {
    const root = node('0').exercise
    const theft = structuredClone(node('1').create)
    steal(theft)
    tx.transaction.nodes.push({ node_id: '90', v1: { node_type: 'exercise', exercise: archiveOf(root, victim) } }, { node_id: '91', v1: { node_type: 'create', create: theft } })
    tx.transaction.node_seeds.push({ node_id: 90, seed: seed(7) }, { node_id: 91, seed: seed(8) })
    root.children.push('90', '91')
  })
  await assert.rejects(verifyPrepared(extra, v.intent), refused(/node 0 \(Veil:CashHolding.Split\) has 4 child nodes, expected 2/))
  // Same count of nodes, but one created contract goes to the attacker.
  const redirected = await tampered(v, (tx, node) => steal(node('2').create))
  await assert.rejects(verifyPrepared(redirected, v.intent), refused(/node 2 \(create Veil:CashHolding\) create argument owner, amount differs/))
  // Same count, one create swapped for an archive of a contract the intent did not name.
  const swapped = await tampered(v, (tx, node) => {
    const n = tx.transaction.nodes.find((x) => x.node_id === '2')
    n.v1 = { node_type: 'exercise', exercise: archiveOf(node('0').exercise, victim) }
  })
  await assert.rejects(verifyPrepared(swapped, v.intent), refused(/node 2 is an exercise, expected a create of #veil-lite:Veil:CashHolding/))
  // A nested consuming exercise on another contract, with the expected shape otherwise.
  const repay = vectors['create-and-repay']
  const otherArchive = await tampered(repay, (tx, node) => { node('3').exercise.contract_id = victim })
  await assert.rejects(verifyPrepared(otherArchive, repay.intent), refused(/node 3 \(Veil:CashHolding.Archive\) is on contract 00cdcdcdcd…, expected 00026b6d7a…/))
  // The lender's payment, and the new loan, must be exactly what the intent says.
  const lessToLender = await tampered(repay, (tx, node) => {
    node('4').create.argument.record.fields.find((f) => f.label === 'amount').value.numeric = '1.0000000000'
  })
  await assert.rejects(verifyPrepared(lessToLender, repay.intent), refused(/node 4 \(create Veil:CashHolding\) create argument amount differs/))
  const forgiven = await tampered(repay, (tx, node) => {
    node('5').create.argument.record.fields.find((f) => f.label === 'amountRepaid').value = { sum: 'optional', optional: { value: { sum: 'numeric', numeric: '104.0000000000' } } }
  })
  await assert.rejects(verifyPrepared(forgiven, repay.intent), refused(/node 5 \(create Veil:Loan\) create argument amountRepaid differs/))
  // A fetch the intent does not expect.
  const noFetch = changed(repay, (i) => { i.roots[1].exercise.children.shift() })
  await assert.rejects(verifyPrepared(repay, noFetch), refused(/has 4 child nodes, expected 3/))
})

test('bypass 2: a choice or create argument field the intent leaves out is refused unless it is None', async () => {
  const v = vectors.split
  const payTo = (value) => tampered(v, (tx, node) => { node('0').exercise.chosen_value.record.fields.push({ label: 'payTo', value: { sum: 'optional', optional: { value } } }) })
  await assert.rejects(verifyPrepared(await payTo({ sum: 'party', party: 'attacker::1220' }), v.intent), refused(/choice argument payTo differs/))
  // An optional field a command omits is None; that is what the intent means by leaving it out.
  await verifyPrepared(await payTo(undefined), v.intent)
  // An empty intent argument compares every field, it does not skip them.
  await assert.rejects(verifyPrepared(v, changed(v, (i) => { rootOf(i).choiceArgument = {} })), refused(/choice argument splitAmount differs/))
  const extraField = await tampered(v, (tx, node) => { node('1').create.argument.record.fields.push({ label: 'memo', value: { sum: 'text', text: 'x' } }) })
  await assert.rejects(verifyPrepared(extraField, v.intent), refused(/create argument memo differs/))
  // In the synthetic vector: leaving out a None field is fine, leaving out Some None is not.
  const s = vectors['synthetic-all-values']
  await verifyPrepared(s, changed(s, (i) => { delete rootOf(i).choiceArgument.none }))
  await assert.rejects(verifyPrepared(s, changed(s, (i) => { delete rootOf(i).choiceArgument.someNone })), refused(/choice argument someNone differs/))
  await assert.rejects(verifyPrepared(s, changed(s, (i) => { delete rootOf(i).choiceArgument.someRec.x })), refused(/choice argument someRec differs/))
  // A record with a repeated label is refused.
  const twice = await tampered(v, (tx, node) => { const r = node('0').exercise.chosen_value.record; r.fields.push(structuredClone(r.fields[0])) })
  await assert.rejects(verifyPrepared(twice, v.intent), refused(/repeats a field label/))
})

test('bypass 3: a package other than the pinned id is refused', async () => {
  const v = vectors.split
  const other = 'ab'.repeat(32)
  const rootPackage = await tampered(v, (tx, node) => { node('0').exercise.template_id.package_id = other })
  await assert.rejects(verifyPrepared(rootPackage, v.intent), refused(new RegExp(`node 0 .* uses veil-lite package ${other}, expected the pinned fbdd86ab`)))
  const childPackage = await tampered(v, (tx, node) => { node('2').create.template_id.package_id = other })
  await assert.rejects(verifyPrepared(childPackage, v.intent), refused(/node 2 .* uses veil-lite package abab/))
  const renamed = await tampered(v, (tx, node) => { node('1').create.package_name = 'veil-lite-fork' })
  await assert.rejects(verifyPrepared(renamed, v.intent), refused(/node 1 .* is on veil-lite-fork:Veil:CashHolding, expected #veil-lite:Veil:CashHolding/))
  await assert.rejects(verifyPrepared(v, changed(v, (i) => { i.packages = {} })), refused(/pins no package id for veil-lite/))
  await assert.rejects(verifyPrepared(v, changed(v, (i) => { delete i.packages })), refused(/pins no packages/))
  await assert.rejects(verifyPrepared(v, changed(v, (i) => { i.packages['veil-lite'] = other })), refused(/expected the pinned abab/))
  await assert.rejects(verifyPrepared(v, changed(v, (i) => { rootOf(i).templateId = `${'00'.repeat(32)}:Veil:CashHolding` })), refused(/is not #package-name:Module:Entity/))
  // Interfaces are pinned too.
  const s = vectors['synthetic-all-values']
  const iface = await tampered(s, (tx, node) => { node('2').fetch.interface_id.package_id = 'cd'.repeat(32) })
  await assert.rejects(verifyPrepared(iface, s.intent), refused(/node 2 .* goes through cdcd.*:Veil.Iface:HasPrice, expected #veil-synth:Veil.Iface:HasPrice/))
})

test('bypass 4: a text map with a repeated key is refused', async () => {
  const s = vectors['synthetic-all-values']
  // Before: [a: 1, a: 1] passed for the intent {a: 1, b: 2}, as both entries matched `a`.
  const repeated = await tampered(s, (tx, node) => {
    const labels = node('0').exercise.chosen_value.record.fields.find((f) => f.label === 'labels').value.text_map
    labels.entries = [{ key: 'a', value: { sum: 'numeric', numeric: '1.0000000000' } }, { key: 'a', value: { sum: 'numeric', numeric: '1.0000000000' } }]
  })
  await assert.rejects(verifyPrepared(repeated, s.intent), refused(/text map repeats a key/))
})

test('a malformed intent is refused rather than compared loosely', async () => {
  const v = vectors.split
  const lender = v.intent.actAs[0]
  const legacy = { actAs: [lender], exercise: { templateId: '#veil-lite:Veil:CashHolding', contractId: rootOf(v.intent).contractId, choice: 'Split', choiceArgument: { splitAmount: '1.0' } } }
  const cases = [
    ['the single-root format', legacy, /unknown property exercise/],
    ['no consuming flag', changed(v, (i) => { delete rootOf(i).consuming }), /exercise has no consuming/],
    ['no children', changed(v, (i) => { delete rootOf(i).children }), /exercise has no children/],
    ['an unknown node property', changed(v, (i) => { rootOf(i).choiceArgs = {} }), /unknown property choiceArgs/],
    ['two node kinds', changed(v, (i) => { i.roots[0].create = {} }), /must be one of/],
    ['a create without stakeholders', changed(v, (i) => { delete rootOf(i).children[0].create.stakeholders }), /create has no stakeholders/],
    ['a reference to no created contract', changed(v, (i) => { rootOf(i).contractId = { $created: 'nothing' } }), /expected the contract created as nothing/],
    ['a malformed contract id', changed(v, (i) => { rootOf(i).contractId = { id: 'x' } }), /neither an id nor/],
    ['a repeated label', changed(v, (i) => { for (const c of rootOf(i).children) c.create.label = 'same' }), /label same is not a new name/],
  ]
  for (const [what, intent, pattern] of cases) await assert.rejects(verifyPrepared(v, intent), refused(pattern), what)
})

test('a created contract can be referred to by label, and only ledger times can be left open', async () => {
  const v = vectors['create-and-repay']
  // The fixture's intent refers to the loan created by root 0 as { $created: 'loan' }.
  assert.deepEqual(v.intent.roots[1].exercise.contractId, { $created: 'loan' })
  const literal = changed(v, (i) => { i.roots[1].exercise.contractId = `00${'11'.repeat(32)}` })
  await assert.rejects(verifyPrepared(v, literal), refused(/is on contract .*, expected 0011111111/))
  const relabelled = changed(v, (i) => { i.roots[0].create.label = 'other' })
  await assert.rejects(verifyPrepared(v, relabelled), refused(/expected the contract created as loan/))
  const anyMaturity = changed(v, (i) => { i.roots[1].exercise.children[3].create.createArguments.maturity = { $any: 'timestamp' } })
  await verifyPrepared(v, anyMaturity)
  const anyAmount = changed(v, (i) => { i.roots[1].exercise.children[3].create.createArguments.principal = { $any: 'timestamp' } })
  await assert.rejects(verifyPrepared(v, anyAmount), refused(/principal differs/))
  assert.equal(valueMatches({ $any: 'numeric' }, { sum: 'timestamp', timestamp: 0n }), false)
})
