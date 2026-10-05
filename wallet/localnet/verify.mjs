// Verify a Canton prepared transaction before the wallet signs it.
//
// The participant answers /v2/interactive-submission/prepare with the
// transaction (base64 protobuf `PreparedTransaction`) and its hash. Signing that
// hash blindly would let a dishonest participant get any transaction signed, so
// verifyPrepared():
//   1. decodes the protobuf (a strict decoder for just the messages involved),
//   2. recomputes the hash with hashing scheme V2 and refuses any other scheme
//      or a returned hash that differs,
//   3. checks the whole transaction tree, node for node, against the intent:
//      the transaction the wallet itself expects, with pinned package ids, and
//   4. returns a one-line summary of what is being signed.
//
// The V2 encoding follows Canton's reference implementation
// (daml_transaction_hashing_v2.py, external_signing_hashing_algorithm.rst):
// https://github.com/digital-asset/canton, community/app/src/pack/examples/08-interactive-submission.
// No dependencies: Uint8Array/DataView, and WebCrypto (or node:crypto) for SHA-256,
// so the same file runs in a browser.

export class VerificationError extends Error {
  constructor(message) { super(message); this.name = 'VerificationError' }
}
const refuse = (message) => { throw new VerificationError(message) }

// --- SHA-256 shim
async function sha256(bytes) {
  if (globalThis.crypto?.subtle) return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  const { createHash } = await import('node:crypto')
  return new Uint8Array(createHash('sha256').update(bytes).digest())
}

// --- base64 (atob/btoa exist in browsers and Node >= 16)
export function fromBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) refuse('not base64')
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}
export function toBase64(bytes) {
  let raw = ''
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw)
}

// --- protobuf wire format: a strict, schema-driven decoder
//
// Refuses anything a lenient parser would silently accept and that could make
// the wallet and the participant read different transactions: unknown fields,
// a non-repeated field given twice, two members of one oneof, wrong wire types,
// invalid UTF-8, and trailing or truncated bytes.

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const utf8Encode = new TextEncoder()

function readVarint(buf, pos) {
  let result = 0n
  for (let i = 0; i < 10; i += 1) {
    if (pos.at >= buf.length) refuse('protobuf: truncated varint')
    const b = buf[pos.at++]
    result |= BigInt(b & 0x7f) << BigInt(7 * i)
    if ((b & 0x80) === 0) return result
  }
  return refuse('protobuf: varint too long')
}

const scalar = {
  string: { wire: 2, read: (b) => { try { return utf8.decode(b) } catch { return refuse('protobuf: invalid UTF-8 in a string') } }, empty: '' },
  bytes: { wire: 2, read: (b) => b, empty: new Uint8Array(0) },
  bool: { wire: 0, read: (v) => v !== 0n, empty: false },
  int32: { wire: 0, read: (v) => Number(BigInt.asIntN(32, v)), empty: 0 },
  uint32: { wire: 0, read: (v) => Number(BigInt.asUintN(32, v)), empty: 0 },
  uint64: { wire: 0, read: (v) => BigInt.asUintN(64, v), empty: 0n },
  sint64: { wire: 0, read: (v) => { const u = BigInt.asUintN(64, v); return BigInt.asIntN(64, (u >> 1n) ^ -(u & 1n)) }, empty: 0n },
  sfixed64: { wire: 1, read: (b) => new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true), empty: 0n },
}

// Schema: field number -> [name, type, flags]. type is a scalar name or a schema
// object; flags: 'repeated', 'optional' (proto3 explicit presence), or a oneof name.
function decode(buf, schema, what) {
  const out = {}
  const seen = new Set()
  const oneofs = {}
  const pos = { at: 0 }
  while (pos.at < buf.length) {
    const key = readVarint(buf, pos)
    const no = Number(key >> 3n)
    const wire = Number(key & 7n)
    const field = schema.fields[no]
    if (!field) refuse(`protobuf: unknown field ${no} in ${what}`)
    const [name, type, flag] = field
    const isMessage = typeof type === 'object'
    const expectedWire = isMessage ? 2 : scalar[type].wire
    if (wire !== expectedWire) refuse(`protobuf: field ${what}.${name} has wire type ${wire}, expected ${expectedWire}`)
    let raw
    if (wire === 0) raw = readVarint(buf, pos)
    else if (wire === 1) {
      if (pos.at + 8 > buf.length) refuse('protobuf: truncated fixed64')
      raw = buf.subarray(pos.at, pos.at + 8); pos.at += 8
    } else {
      const len = readVarint(buf, pos)
      if (len > BigInt(buf.length - pos.at)) refuse(`protobuf: truncated field ${what}.${name}`)
      raw = buf.subarray(pos.at, pos.at + Number(len)); pos.at += Number(len)
    }
    const value = isMessage ? decode(raw, type, `${what}.${name}`) : scalar[type].read(raw)
    if (flag === 'repeated') { (out[name] ??= []).push(value); continue }
    if (seen.has(no)) refuse(`protobuf: field ${what}.${name} given more than once`)
    seen.add(no)
    if (flag && flag !== 'optional') {
      if (oneofs[flag]) refuse(`protobuf: ${what} sets both ${oneofs[flag]} and ${name} of oneof ${flag}`)
      oneofs[flag] = name
    }
    out[name] = value
  }
  // Defaults for absent fields: repeated -> [], plain scalars -> zero value.
  // Messages, `optional` scalars and oneof members stay undefined (not present).
  for (const [name, type, flag] of Object.values(schema.fields)) {
    if (flag === 'repeated') out[name] ??= []
    else if (!flag && typeof type !== 'object' && !(name in out)) out[name] = scalar[type].empty
  }
  for (const group of schema.oneofs ?? []) out[group] = oneofs[group]
  return out
}

const message = (fields, oneofs) => ({ fields, oneofs })
// com.daml.ledger.api.v2.value
const Identifier = message({ 1: ['package_id', 'string'], 2: ['module_name', 'string'], 3: ['entity_name', 'string'] })
const Empty = message({})
const Value = message({}, ['sum'])
const RecordField = message({ 1: ['label', 'string'], 2: ['value', Value] })
const Record = message({ 1: ['record_id', Identifier], 2: ['fields', RecordField, 'repeated'] })
const Variant = message({ 1: ['variant_id', Identifier], 2: ['constructor', 'string'], 3: ['value', Value] })
const Enum = message({ 1: ['enum_id', Identifier], 2: ['constructor', 'string'] })
const List = message({ 1: ['elements', Value, 'repeated'] })
const Optional = message({ 1: ['value', Value] })
const TextMap = message({ 1: ['entries', message({ 1: ['key', 'string'], 2: ['value', Value] }), 'repeated'] })
const GenMap = message({ 1: ['entries', message({ 1: ['key', Value], 2: ['value', Value] }), 'repeated'] })
Object.assign(Value.fields, {
  1: ['unit', Empty, 'sum'], 2: ['bool', 'bool', 'sum'], 3: ['int64', 'sint64', 'sum'], 4: ['date', 'int32', 'sum'],
  5: ['timestamp', 'sfixed64', 'sum'], 6: ['numeric', 'string', 'sum'], 7: ['party', 'string', 'sum'], 8: ['text', 'string', 'sum'],
  9: ['contract_id', 'string', 'sum'], 10: ['optional', Optional, 'sum'], 11: ['list', List, 'sum'], 12: ['text_map', TextMap, 'sum'],
  13: ['gen_map', GenMap, 'sum'], 14: ['record', Record, 'sum'], 15: ['variant', Variant, 'sum'], 16: ['enum', Enum, 'sum'],
})
// com.daml.ledger.api.v2.interactive (common data and transaction.v1 nodes)
const GlobalKey = message({ 1: ['template_id', Identifier], 2: ['package_name', 'string'], 3: ['key', Value], 4: ['hash', 'bytes'] })
const GlobalKeyWithMaintainers = message({ 1: ['key', GlobalKey], 2: ['maintainers', 'string', 'repeated'] })
const Create = message({
  1: ['lf_version', 'string'], 2: ['contract_id', 'string'], 3: ['package_name', 'string'], 4: ['template_id', Identifier],
  5: ['argument', Value], 6: ['signatories', 'string', 'repeated'], 7: ['stakeholders', 'string', 'repeated'], 8: ['key', GlobalKeyWithMaintainers],
})
const Fetch = message({
  1: ['lf_version', 'string'], 2: ['contract_id', 'string'], 3: ['package_name', 'string'], 4: ['template_id', Identifier],
  5: ['signatories', 'string', 'repeated'], 6: ['stakeholders', 'string', 'repeated'], 7: ['acting_parties', 'string', 'repeated'],
  8: ['interface_id', Identifier], 9: ['key', GlobalKeyWithMaintainers], 10: ['by_key', 'bool'],
})
const Exercise = message({
  1: ['lf_version', 'string'], 2: ['contract_id', 'string'], 3: ['package_name', 'string'], 4: ['template_id', Identifier],
  5: ['signatories', 'string', 'repeated'], 6: ['stakeholders', 'string', 'repeated'], 7: ['acting_parties', 'string', 'repeated'],
  8: ['interface_id', Identifier], 9: ['choice_id', 'string'], 10: ['chosen_value', Value], 11: ['consuming', 'bool'],
  12: ['children', 'string', 'repeated'], 13: ['exercise_result', Value], 14: ['choice_observers', 'string', 'repeated'],
  15: ['key', GlobalKeyWithMaintainers], 16: ['by_key', 'bool'],
})
const Rollback = message({ 1: ['children', 'string', 'repeated'] })
const QueryByKey = message({
  1: ['lf_version', 'string'], 2: ['package_name', 'string'], 3: ['template_id', Identifier], 4: ['exhaustive', 'bool'],
  5: ['key', GlobalKeyWithMaintainers], 6: ['result', 'string', 'repeated'],
})
const NodeV1 = message({ 1: ['create', Create, 'node_type'], 2: ['fetch', Fetch, 'node_type'], 3: ['exercise', Exercise, 'node_type'], 4: ['rollback', Rollback, 'node_type'], 5: ['query_by_key', QueryByKey, 'node_type'] }, ['node_type'])
// com.daml.ledger.api.v2.interactive.PreparedTransaction
const DamlTransaction = message({
  1: ['version', 'string'], 2: ['roots', 'string', 'repeated'],
  3: ['nodes', message({ 1: ['node_id', 'string'], 1000: ['v1', NodeV1, 'versioned_node'] }, ['versioned_node']), 'repeated'],
  4: ['node_seeds', message({ 1: ['node_id', 'int32'], 2: ['seed', 'bytes'] }), 'repeated'],
})
const Metadata = message({
  2: ['submitter_info', message({ 1: ['act_as', 'string', 'repeated'], 2: ['command_id', 'string'] })],
  3: ['synchronizer_id', 'string'], 4: ['mediator_group', 'uint32'], 5: ['transaction_uuid', 'string'], 6: ['preparation_time', 'uint64'],
  7: ['input_contracts', message({ 1: ['v1', Create, 'contract'], 1000: ['created_at', 'uint64'], 1002: ['event_blob', 'bytes'] }, ['contract']), 'repeated'],
  8: ['global_key_mapping', message({ 1: ['key', GlobalKey], 2: ['value', Value, 'optional'] }), 'repeated'],
  9: ['min_ledger_effective_time', 'uint64', 'optional'], 10: ['max_ledger_effective_time', 'uint64', 'optional'],
  11: ['max_record_time', 'uint64', 'optional'],
})
const PreparedTransaction = message({ 1: ['transaction', DamlTransaction], 2: ['metadata', Metadata] })
/** The decoder's schema, for tests that build prepared transactions. */
export const preparedTransactionSchema = PreparedTransaction

/** Decode a `PreparedTransaction` (bytes or base64) into plain objects. */
export function decodePreparedTransaction(input) {
  const bytes = typeof input === 'string' ? fromBase64(input) : input
  const tx = decode(bytes, PreparedTransaction, 'PreparedTransaction')
  if (!tx.transaction) refuse('prepared transaction has no transaction')
  if (!tx.metadata) refuse('prepared transaction has no metadata')
  return tx
}

// --- hashing scheme V2

const PURPOSE = Uint8Array.of(0x00, 0x00, 0x00, 0x30)
const HASHING_SCHEME_V2 = 0x02
const NODE_ENCODING_V1 = 0x01
const METADATA_ENCODING_V1 = 0x01
const EMPTY_IDENTIFIER = { package_id: '', module_name: '', entity_name: '' }

class Bytes {
  constructor() { this.parts = []; this.length = 0 }
  push(bytes) { this.parts.push(bytes); this.length += bytes.length; return this }
  byte(b) { return this.push(Uint8Array.of(b)) }
  int32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n); return this.push(b) }
  uint32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return this.push(b) }
  int64(n) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, n)); return this.push(b) }
  bool(v) { return this.byte(v ? 1 : 0) }
  bytes(b) { return this.int32(b.length).push(b) }
  string(s) { return this.bytes(utf8Encode.encode(s)) }
  hex(s) {
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(s)) refuse(`contract id is not hex: ${s.slice(0, 20)}`)
    const b = new Uint8Array(s.length / 2)
    for (let i = 0; i < b.length; i += 1) b[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16)
    return this.bytes(b)
  }
  strings(list) { this.int32(list.length); for (const s of list) this.string(s); return this }
  optional(v, encode) { if (v === undefined) return this.byte(0); this.byte(1); encode(v); return this }
  identifier(id) {
    this.string(id.package_id)
    this.strings(id.module_name.split('.'))
    return this.strings(id.entity_name.split('.'))
  }
  value(v) {
    switch (v.sum) {
      case 'unit': return this.byte(0x00)
      case 'bool': return this.byte(0x01).bool(v.bool)
      case 'int64': return this.byte(0x02).int64(v.int64)
      case 'numeric': return this.byte(0x03).string(v.numeric)
      case 'timestamp': return this.byte(0x04).int64(v.timestamp)
      case 'date': return this.byte(0x05).int32(v.date)
      case 'party': return this.byte(0x06).string(v.party)
      case 'text': return this.byte(0x07).string(v.text)
      case 'contract_id': return this.byte(0x08).hex(v.contract_id)
      case 'optional': return this.byte(0x09).optional(v.optional.value, (x) => this.value(x))
      case 'list': this.byte(0x0a).int32(v.list.elements.length); for (const e of v.list.elements) this.value(e); return this
      case 'text_map': this.byte(0x0b).int32(v.text_map.entries.length); for (const e of v.text_map.entries) this.string(e.key).value(need(e.value, 'text map value')); return this
      case 'record':
        this.byte(0x0c).optional(v.record.record_id, (id) => this.identifier(id)).int32(v.record.fields.length)
        // A record field label is always encoded as a defined optional, even when empty.
        for (const f of v.record.fields) this.byte(1).string(f.label).value(need(f.value, `record field ${f.label}`))
        return this
      case 'variant': return this.byte(0x0d).optional(v.variant.variant_id, (id) => this.identifier(id)).string(v.variant.constructor).value(need(v.variant.value, 'variant value'))
      case 'enum': return this.byte(0x0e).optional(v.enum.enum_id, (id) => this.identifier(id)).string(v.enum.constructor)
      case 'gen_map': this.byte(0x0f).int32(v.gen_map.entries.length); for (const e of v.gen_map.entries) this.value(need(e.key, 'map key')).value(need(e.value, 'map value')); return this
      default: return refuse('a Daml value has no type')
    }
  }
  concat() {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const p of this.parts) { out.set(p, at); at += p.length }
    return out
  }
}
const need = (v, what) => v ?? refuse(`${what} is missing`)

// V2 does not hash contract keys; Canton only supports them with V3.
function noKey(node, what) {
  if (node.key !== undefined || node.by_key) refuse(`${what} uses a contract key, which hashing scheme V2 does not cover`)
}

/**
 * Index the transaction's nodes and seeds, refusing structures the reference
 * implementation would hash ambiguously or not at all: duplicate node ids or
 * seeds, missing children, shared or cyclic subtrees, and nodes or seeds that
 * no root reaches.
 */
function indexTransaction(transaction) {
  const nodes = new Map()
  for (const node of transaction.nodes) {
    if (nodes.has(node.node_id)) refuse(`node id ${node.node_id} appears twice`)
    if (!node.v1) refuse(`node ${node.node_id} has an unsupported node version`)
    if (!node.v1.node_type) refuse(`node ${node.node_id} has no node type`)
    if (node.v1.node_type === 'query_by_key') refuse('a QueryByKey node is not hashed by scheme V2')
    nodes.set(node.node_id, node.v1)
  }
  const seeds = new Map()
  for (const s of transaction.node_seeds) {
    const id = String(s.node_id)
    if (seeds.has(id)) refuse(`node seed ${id} appears twice`)
    if (!nodes.has(id)) refuse(`node seed ${id} names no node`)
    seeds.set(id, s.seed)
  }
  const reached = new Set()
  const visit = (id) => {
    if (!nodes.has(id)) refuse(`node ${id} is referenced but missing`)
    if (reached.has(id)) refuse(`node ${id} is referenced twice`)
    reached.add(id)
    const node = nodes.get(id)
    for (const child of node[node.node_type].children ?? []) visit(child)
  }
  if (transaction.roots.length === 0) refuse('the transaction has no root node')
  transaction.roots.forEach(visit)
  if (reached.size !== nodes.size) refuse('the transaction has nodes no root reaches')
  return { nodes, seeds }
}

async function hashNode(id, index) {
  const node = index.nodes.get(id)
  const seed = index.seeds.get(id)
  const b = new Bytes().byte(NODE_ENCODING_V1)
  switch (node.node_type) {
    case 'create': {
      const c = node.create
      noKey(c, 'a create node')
      b.string(c.lf_version).byte(0x00).optional(seed, (s) => b.push(s))
      encodeCreateBody(b, c)
      break
    }
    case 'exercise': {
      const e = node.exercise
      noKey(e, 'an exercise node')
      if (seed === undefined) refuse(`exercise node ${id} has no seed`)
      b.string(e.lf_version).byte(0x01).push(seed)
        .hex(e.contract_id).string(e.package_name).identifier(e.template_id ?? EMPTY_IDENTIFIER)
        .strings(e.signatories).strings(e.stakeholders).strings(e.acting_parties)
        .optional(e.interface_id, (i) => b.identifier(i))
        .string(e.choice_id).value(need(e.chosen_value, 'choice argument')).bool(e.consuming)
        .optional(e.exercise_result, (r) => b.value(r))
        .strings(e.choice_observers)
        .int32(e.children.length)
      for (const child of e.children) b.push(await hashNode(child, index))
      break
    }
    case 'fetch': {
      const f = node.fetch
      noKey(f, 'a fetch node')
      b.string(f.lf_version).byte(0x02)
        .hex(f.contract_id).string(f.package_name).identifier(f.template_id ?? EMPTY_IDENTIFIER)
        .strings(f.signatories).strings(f.stakeholders)
        .optional(f.interface_id, (i) => b.identifier(i))
        .strings(f.acting_parties)
      break
    }
    case 'rollback': {
      b.byte(0x03).int32(node.rollback.children.length)
      for (const child of node.rollback.children) b.push(await hashNode(child, index))
      break
    }
    default: refuse(`unsupported node type ${node.node_type}`)
  }
  return sha256(b.concat())
}

function encodeCreateBody(b, c) {
  return b.hex(c.contract_id).string(c.package_name).identifier(c.template_id ?? EMPTY_IDENTIFIER)
    .value(need(c.argument, 'create argument')).strings(c.signatories).strings(c.stakeholders)
}

async function hashMetadata(m) {
  const submitter = m.submitter_info ?? { act_as: [], command_id: '' }
  const b = new Bytes()
  b.byte(METADATA_ENCODING_V1)
    .strings(submitter.act_as).string(submitter.command_id)
    .string(m.transaction_uuid).uint32(m.mediator_group).string(m.synchronizer_id)
    .optional(m.min_ledger_effective_time, (t) => b.int64(t))
    .optional(m.max_ledger_effective_time, (t) => b.int64(t))
    .int64(m.preparation_time)
    .int32(m.input_contracts.length)
  for (const input of m.input_contracts) {
    if (!input.v1) refuse('an input contract has no create node')
    noKey(input.v1, 'an input contract')
    // An input contract is hashed as a create node without a seed.
    const node = new Bytes().byte(NODE_ENCODING_V1).string(input.v1.lf_version).byte(0x00).byte(0)
    encodeCreateBody(node, input.v1)
    b.int64(input.created_at).push(await sha256(node.concat()))
  }
  return sha256(new Bytes().push(PURPOSE).push(b.concat()).concat())
}

/** The V2 hash of a decoded `PreparedTransaction`, as Canton computes it. */
export async function hashPreparedTransaction(tx) {
  // global_key_mapping is deprecated, always empty, and not hashed.
  if (tx.metadata.global_key_mapping.length > 0) refuse('metadata carries a global key mapping, which V2 does not hash')
  const index = indexTransaction(tx.transaction)
  const t = new Bytes().push(PURPOSE).string(tx.transaction.version).int32(tx.transaction.roots.length)
  for (const root of tx.transaction.roots) t.push(await hashNode(root, index))
  const transactionHash = await sha256(t.concat())
  const metadataHash = await hashMetadata(tx.metadata)
  return sha256(new Bytes().push(PURPOSE).byte(HASHING_SCHEME_V2).push(transactionHash).push(metadataHash).concat())
}

// --- the wallet's intent
//
// The intent is the whole transaction the wallet expects, built by the wallet
// from what it is about to do, never from the prepared transaction:
//
//   intent = { actAs: [party], packages: { 'package-name': 'package id', ... }, roots: [node, ...] }
//   node   = { exercise: { templateId, contractId, choice, choiceArgument, consuming, actingParties,
//                          children: [node, ...], interfaceId?, choiceObservers? } }
//          | { create: { templateId, createArguments, signatories, stakeholders, label? } }
//          | { fetch: { templateId, contractId, actingParties, interfaceId? } }
//          | { rollback: { children: [node, ...] } }
//
// Template and interface ids are `#package-name:Module:Entity`, and every
// package a node names must be pinned to one package id in `packages`. The
// transaction's tree must equal the intent's node for node, in order: no node
// more, none less, none different. An archive is an exercise of `Archive`
// with argument {}. A create may carry a `label`; a later contract id
// (an exercised contract or a value) can then be `{ $created: label }`, the
// id that create got. A ledger time the wallet cannot know in advance can be
// `{ $any: 'timestamp' }`, which matches any timestamp and nothing else.

const INTENT_NODES = {
  exercise: { required: ['templateId', 'contractId', 'choice', 'choiceArgument', 'consuming', 'actingParties', 'children'], optional: ['interfaceId', 'choiceObservers'] },
  create: { required: ['templateId', 'createArguments', 'signatories', 'stakeholders'], optional: ['label'] },
  fetch: { required: ['templateId', 'contractId', 'actingParties'], optional: ['interfaceId'] },
  rollback: { required: ['children'], optional: [] },
}
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

// An intent the wallet wrote wrongly must fail, never silently compare less.
function intentNode(expected, where) {
  const kinds = isObject(expected) ? Object.keys(expected) : []
  if (kinds.length !== 1 || !Object.hasOwn(INTENT_NODES, kinds[0])) refuse(`intent: ${where} must be one of ${Object.keys(INTENT_NODES).join(', ')}`)
  const [kind] = kinds
  const spec = expected[kind]
  if (!isObject(spec)) refuse(`intent: ${where} ${kind} is not an object`)
  const { required, optional } = INTENT_NODES[kind]
  for (const key of required) if (spec[key] === undefined) refuse(`intent: ${where} ${kind} has no ${key}`)
  for (const key of Object.keys(spec)) if (!required.includes(key) && !optional.includes(key)) refuse(`intent: ${where} ${kind} has unknown property ${key}`)
  return [kind, spec]
}

/** Parse an intent template or interface id: `#package-name:Module:Entity`. */
function parseTemplateId(templateId) {
  const parts = String(templateId).split(':')
  if (parts.length !== 3 || parts.some((p) => p === '') || !parts[0].startsWith('#') || parts[0].length === 1) {
    refuse(`intent: template id ${templateId} is not #package-name:Module:Entity`)
  }
  return { packageName: parts[0].slice(1), module: parts[1], entity: parts[2] }
}
function pinnedPackage(ctx, name) {
  const id = Object.hasOwn(ctx.packages, name) ? ctx.packages[name] : undefined
  if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) refuse(`intent pins no package id for ${name}`)
  return id
}
function checkTemplate(at, node, templateId, ctx) {
  const want = parseTemplateId(templateId)
  const id = node.template_id ?? EMPTY_IDENTIFIER
  if (node.package_name !== want.packageName || id.module_name !== want.module || id.entity_name !== want.entity) {
    refuse(`${at} is on ${node.package_name}:${templateName(node)}, expected ${templateId}`)
  }
  const pinned = pinnedPackage(ctx, want.packageName)
  if (id.package_id !== pinned) refuse(`${at} uses ${want.packageName} package ${id.package_id}, expected the pinned ${pinned}`)
}
function checkInterface(at, node, interfaceId, ctx) {
  const id = node.interface_id
  if (interfaceId === undefined) {
    if (id !== undefined) refuse(`${at} goes through interface ${id.module_name}:${id.entity_name}, which the intent does not name`)
    return
  }
  const want = parseTemplateId(interfaceId)
  if (id === undefined || id.module_name !== want.module || id.entity_name !== want.entity || id.package_id !== pinnedPackage(ctx, want.packageName)) {
    refuse(`${at} goes through ${id ? `${id.package_id}:${id.module_name}:${id.entity_name}` : 'no interface'}, expected ${interfaceId}`)
  }
}
// Party lists are sets: equal members, no duplicates on either side.
function checkParties(at, what, actual, expected) {
  if (!Array.isArray(expected) || expected.some((p) => typeof p !== 'string')) refuse(`intent: ${at} ${what} is not a list of parties`)
  const have = new Set(actual)
  const want = new Set(expected)
  if (have.size !== actual.length || want.size !== expected.length || have.size !== want.size || ![...want].every((p) => have.has(p))) {
    refuse(`${at} ${what} are [${actual.map(shortParty).join(', ')}], expected [${expected.map(shortParty).join(', ')}]`)
  }
}
function contractIdMatches(expected, actual, created) {
  if (typeof expected === 'string') return expected === actual
  if (isObject(expected) && Object.keys(expected).length === 1 && typeof expected.$created === 'string') {
    return created.has(expected.$created) && created.get(expected.$created) === actual
  }
  return refuse(`intent: contract id ${JSON.stringify(expected)} is neither an id nor { $created: label }`)
}
const cidText = (c) => (typeof c === 'string' ? shortCid(c) : `the contract created as ${c.$created}`)

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/
function normalizeDecimal(s) {
  const m = DECIMAL.exec(String(s))
  if (!m) return undefined
  const whole = m[2].replace(/^0+(?=\d)/, '')
  const frac = (m[3] ?? '').replace(/0+$/, '')
  const zero = /^0*$/.test(whole + frac)
  return `${zero ? '' : m[1]}${whole}${frac ? `.${frac}` : ''}`
}
const microsOf = (iso) => {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/.exec(String(iso))
  if (!m) return undefined
  return BigInt(Date.parse(`${m[1]}Z`)) * 1000n + BigInt((m[2] ?? '').padEnd(6, '0'))
}
const isAnyTimestamp = (x) => isObject(x) && Object.keys(x).length === 1 && x.$any === 'timestamp'

/**
 * Does the decoded Daml value equal what the wallet asked for? `expected` uses
 * the JSON Ledger API encoding the command was written in: numbers as decimal
 * strings, times as ISO strings, optionals as null or the value, records as
 * objects, lists as arrays, variants as {tag, value}, enums as the
 * constructor, text maps as objects, generic maps as [key, value] pairs.
 *
 * Records compare exactly: every field the intent names must be equal (a
 * field Canton left out, as it does trailing None fields, counts as None),
 * and a field the intent leaves out must be an Optional that is None. That is
 * what the JSON Ledger API gives a command that omits an optional field, and
 * with the package id pinned no other field can exist. Anything else the
 * intent leaves out is a mismatch. A record or text map with a
 * repeated label or key is refused. `created` maps create labels to contract
 * ids for `{ $created: label }`.
 */
export function valueMatches(expected, v, created = new Map()) {
  switch (v.sum) {
    case 'unit': return isObject(expected) && Object.keys(expected).length === 0
    case 'bool': return expected === v.bool
    case 'int64': return /^-?\d+$/.test(String(expected)) && BigInt(String(expected)) === v.int64
    case 'numeric': return normalizeDecimal(expected) !== undefined && normalizeDecimal(expected) === normalizeDecimal(v.numeric)
    case 'timestamp': return isAnyTimestamp(expected) || microsOf(expected) === v.timestamp
    case 'date': return typeof expected === 'string' && Date.parse(`${expected}T00:00:00Z`) / 864e5 === v.date
    case 'party': return expected === v.party
    case 'text': return expected === v.text
    case 'contract_id': return (typeof expected === 'string' || isObject(expected)) && contractIdMatches(expected, v.contract_id, created)
    case 'optional': {
      const inner = v.optional.value
      if (inner === undefined) return expected === null
      // Some of an optional is written as a list: [] for Some None, [x] for Some (Some x).
      if (inner.sum === 'optional') {
        return Array.isArray(expected) && (inner.optional.value === undefined ? expected.length === 0 : expected.length === 1 && valueMatches(expected[0], inner.optional.value, created))
      }
      return expected !== null && expected !== undefined && valueMatches(expected, inner, created)
    }
    case 'list': return Array.isArray(expected) && expected.length === v.list.elements.length && expected.every((e, i) => valueMatches(e, v.list.elements[i], created))
    case 'record': return isObject(expected) && recordDiff(expected, v.record, created).length === 0
    case 'variant': return isObject(expected) && Object.keys(expected).every((k) => k === 'tag' || k === 'value')
      && expected.tag === v.variant.constructor && valueMatches(expected.value, v.variant.value, created)
    case 'enum': return expected === v.enum.constructor
    case 'text_map': {
      const keys = new Set(v.text_map.entries.map((e) => e.key))
      if (keys.size !== v.text_map.entries.length) refuse('a text map repeats a key')
      return isObject(expected) && Object.keys(expected).length === keys.size
        && v.text_map.entries.every((e) => Object.hasOwn(expected, e.key) && valueMatches(expected[e.key], e.value, created))
    }
    case 'gen_map': return Array.isArray(expected) && expected.length === v.gen_map.entries.length
      && v.gen_map.entries.every((e, i) => Array.isArray(expected[i]) && expected[i].length === 2 && valueMatches(expected[i][0], e.key, created) && valueMatches(expected[i][1], e.value, created))
    default: return false
  }
}
/** The labels on which `record` and `expected` disagree, by the rule above. */
function recordDiff(expected, record, created) {
  const byLabel = new Map(record.fields.map((f) => [f.label, f.value]))
  if (byLabel.size !== record.fields.length) refuse('a record repeats a field label')
  // Canton drops trailing None fields, so an absent field is None.
  const differs = Object.entries(expected).filter(([label, want]) => (byLabel.has(label) ? !valueMatches(want, byLabel.get(label), created) : want !== null)).map(([label]) => label)
  const unnamed = record.fields.filter((f) => !Object.hasOwn(expected, f.label) && !(f.value.sum === 'optional' && f.value.optional.value === undefined)).map((f) => f.label)
  return [...differs, ...unnamed]
}
function checkArgument(at, what, expected, v, created) {
  if (!isObject(expected)) refuse(`intent: ${at} ${what} is not an object`)
  if (v?.sum !== 'record') refuse(`${at} ${what} is not a record`)
  const bad = recordDiff(expected, v.record, created)
  if (bad.length > 0) refuse(`${at} ${what} ${bad.join(', ')} differs from the intent (${argText(v)})`)
}

function checkChildren(at, ids, expected, ctx) {
  if (!Array.isArray(expected)) refuse(`intent: ${at} children is not a list`)
  if (ids.length !== expected.length) refuse(`${at} has ${ids.length} child nodes, expected ${expected.length}`)
  ids.forEach((id, i) => checkNode(id, expected[i], ctx))
}

const article = (word) => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
function checkNode(id, expected, ctx) {
  const node = ctx.nodes.get(id)
  const at = `node ${id}`
  const [kind, spec] = intentNode(expected, at)
  if (node.node_type !== kind) refuse(`${at} is ${article(node.node_type)}, expected ${article(kind)}${spec.templateId ? ` of ${spec.templateId}` : ''}${spec.choice ? ` ${spec.choice}` : ''}`)
  switch (kind) {
    case 'exercise': {
      const e = node.exercise
      const where = `${at} (${templateName(e)}.${e.choice_id})`
      checkTemplate(where, e, spec.templateId, ctx)
      checkInterface(where, e, spec.interfaceId, ctx)
      if (e.choice_id !== spec.choice) refuse(`${at} exercises ${templateName(e)}.${e.choice_id}, expected ${spec.choice}`)
      if (!contractIdMatches(spec.contractId, e.contract_id, ctx.created)) refuse(`${where} is on contract ${shortCid(e.contract_id)}, expected ${cidText(spec.contractId)}`)
      if (typeof spec.consuming !== 'boolean') refuse(`intent: ${at} consuming is not a boolean`)
      if (e.consuming !== spec.consuming) refuse(`${where} is ${e.consuming ? 'consuming' : 'non-consuming'}, expected ${spec.consuming ? 'consuming' : 'non-consuming'}`)
      checkParties(where, 'acting parties', e.acting_parties, spec.actingParties)
      checkParties(where, 'choice observers', e.choice_observers, spec.choiceObservers ?? [])
      checkArgument(where, 'choice argument', spec.choiceArgument, e.chosen_value, ctx.created)
      checkChildren(where, e.children, spec.children, ctx)
      break
    }
    case 'create': {
      const c = node.create
      const where = `${at} (create ${templateName(c)})`
      checkTemplate(where, c, spec.templateId, ctx)
      checkArgument(where, 'create argument', spec.createArguments, c.argument, ctx.created)
      checkParties(where, 'signatories', c.signatories, spec.signatories)
      checkParties(where, 'stakeholders', c.stakeholders, spec.stakeholders)
      if (spec.label !== undefined) {
        if (typeof spec.label !== 'string' || ctx.created.has(spec.label)) refuse(`intent: create label ${spec.label} is not a new name`)
        ctx.created.set(spec.label, c.contract_id)
      }
      break
    }
    case 'fetch': {
      const f = node.fetch
      const where = `${at} (fetch ${templateName(f)})`
      checkTemplate(where, f, spec.templateId, ctx)
      checkInterface(where, f, spec.interfaceId, ctx)
      if (!contractIdMatches(spec.contractId, f.contract_id, ctx.created)) refuse(`${where} is of contract ${shortCid(f.contract_id)}, expected ${cidText(spec.contractId)}`)
      checkParties(where, 'acting parties', f.acting_parties, spec.actingParties)
      break
    }
    default: // rollback
      checkChildren(at, node.rollback.children, spec.children, ctx)
  }
}

/**
 * Refuse unless the transaction is exactly the one the intent describes: the
 * submitters are exactly `actAs`, and the tree from its roots down equals the
 * intent's, node for node (see the format above).
 */
export function checkIntent(tx, intent) {
  if (!isObject(intent)) refuse('there is no intent')
  for (const key of Object.keys(intent)) if (!['actAs', 'packages', 'roots'].includes(key)) refuse(`intent has unknown property ${key}`)
  const actAs = tx.metadata.submitter_info?.act_as ?? []
  const want = intent.actAs ?? []
  if (!Array.isArray(want) || want.length === 0) refuse('intent names no submitter')
  if (actAs.length !== want.length || new Set(actAs).size !== actAs.length || !want.every((p) => actAs.includes(p))) {
    refuse(`submitters are [${actAs.map(shortParty).join(', ')}], expected [${want.map(shortParty).join(', ')}]`)
  }
  if (!isObject(intent.packages)) refuse('intent pins no packages')
  if (!Array.isArray(intent.roots) || intent.roots.length === 0) refuse('intent names no root action')
  const { nodes } = indexTransaction(tx.transaction)
  const roots = tx.transaction.roots
  if (roots.length !== intent.roots.length) refuse(`the transaction has ${roots.length} root actions, expected ${intent.roots.length}`)
  const ctx = { nodes, packages: intent.packages, created: new Map() }
  roots.forEach((id, i) => checkNode(id, intent.roots[i], ctx))
}

// --- summary

const shortParty = (p) => String(p).split('::')[0]
const shortCid = (c) => `${String(c).slice(0, 10)}…`
const templateName = (n) => `${n.template_id?.module_name}:${n.template_id?.entity_name}`
function valueText(v) {
  switch (v?.sum) {
    case 'unit': return '()'
    case 'bool': return String(v.bool)
    case 'int64': return String(v.int64)
    case 'numeric': return normalizeDecimal(v.numeric) ?? v.numeric
    case 'timestamp': return new Date(Math.floor(Number(v.timestamp) / 1000)).toISOString()
    case 'date': return new Date(v.date * 864e5).toISOString().slice(0, 10)
    case 'party': return shortParty(v.party)
    case 'text': return JSON.stringify(v.text)
    case 'contract_id': return shortCid(v.contract_id)
    case 'optional': {
      const inner = v.optional.value
      if (inner === undefined) return 'None'
      return inner.sum === 'optional' ? `Some ${valueText(inner)}` : valueText(inner)
    }
    case 'list': return `[${v.list.elements.map(valueText).join(', ')}]`
    case 'record': return `{${v.record.fields.map((f) => `${f.label} ${valueText(f.value)}`).join(', ')}}`
    case 'variant': return `${v.variant.constructor} ${valueText(v.variant.value)}`
    case 'enum': return v.enum.constructor
    case 'text_map': return `{${v.text_map.entries.map((e) => `${JSON.stringify(e.key)}: ${valueText(e.value)}`).join(', ')}}`
    case 'gen_map': return `{${v.gen_map.entries.map((e) => `${valueText(e.key)}: ${valueText(e.value)}`).join(', ')}}`
    default: return `<${v?.sum ?? 'none'}>`
  }
}
const argText = (v) => (v?.sum === 'record' && v.record.fields.length === 0 ? '{}' : valueText(v))
// Amount-like fields shown for created contracts.
const AMOUNT_FIELDS = ['amount', 'quantity', 'principal', 'unitPrice', 'amountRepaid']
function createdText(c) {
  const fields = c.argument?.sum === 'record' ? c.argument.record.fields : []
  const owner = fields.find((f) => f.label === 'owner' && f.value.sum === 'party')
  const shown = fields.filter((f) => AMOUNT_FIELDS.includes(f.label) && (f.value.sum === 'numeric' || (f.value.sum === 'optional' && f.value.optional.value?.sum === 'numeric')))
  const parts = [...(owner ? [`owner ${valueText(owner.value)}`] : []), ...shown.map((f) => `${f.label} ${valueText(f.value)}`)]
  return `${c.template_id?.entity_name}${parts.length ? `(${parts.join(', ')})` : ''}`
}

/** One line describing what the transaction does, for the wallet to show. */
export function summarize(tx) {
  const { nodes } = indexTransaction(tx.transaction)
  const created = []
  const archived = []
  const walk = (id) => {
    const node = nodes.get(id)
    if (node.node_type === 'create') created.push(createdText(node.create))
    if (node.node_type === 'exercise') {
      if (node.exercise.consuming) archived.push(`${node.exercise.template_id?.entity_name} ${shortCid(node.exercise.contract_id)}`)
      node.exercise.children.forEach(walk)
    }
    if (node.node_type === 'rollback') node.rollback.children.forEach(walk)
  }
  tx.transaction.roots.forEach(walk)
  const rootText = tx.transaction.roots.map((id) => {
    const node = nodes.get(id)
    if (node.node_type === 'exercise') {
      const e = node.exercise
      return `${templateName(e)}.${e.choice_id} ${argText(e.chosen_value)} on ${shortCid(e.contract_id)}`
    }
    if (node.node_type === 'create') return `create ${templateName(node.create)}`
    return node.node_type
  }).join(' + ')
  const actAs = (tx.metadata.submitter_info?.act_as ?? []).map(shortParty).join(', ')
  return `${rootText} as ${actAs}; archives ${archived.join(', ') || 'nothing'}; creates ${created.join(', ') || 'nothing'}`
}

// --- all together

export const HASHING_SCHEME_V2_NAME = 'HASHING_SCHEME_VERSION_V2'

/**
 * Verify a prepare response against the wallet's intent. Returns the hash to
 * sign (recomputed here, equal to the returned one) and a summary line; throws
 * VerificationError otherwise.
 */
export async function verifyPrepared(prepared, intent) {
  if (prepared?.hashingSchemeVersion !== HASHING_SCHEME_V2_NAME) refuse(`hashing scheme ${prepared?.hashingSchemeVersion} is not V2`)
  const tx = decodePreparedTransaction(prepared.preparedTransaction)
  const hash = await hashPreparedTransaction(tx)
  const returned = fromBase64(prepared.preparedTransactionHash ?? '')
  if (returned.length !== hash.length || !returned.every((b, i) => b === hash[i])) {
    refuse(`the returned hash ${prepared.preparedTransactionHash} is not the hash of the prepared transaction (${toBase64(hash)})`)
  }
  checkIntent(tx, intent)
  return { hash, summary: summarize(tx), transaction: tx }
}
