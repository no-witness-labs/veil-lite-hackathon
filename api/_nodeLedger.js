const crypto = require('node:crypto')
const { AuthError, packageRef, privateKeyFromEnv, ROLE_SUBJECTS } = require('./_auth')
const { ledgerTarget } = require('./_ledger')
const { upstreamConfig, upstreamToken } = require('./_upstream')
const { registryTarget } = require('./_registry')
const { mintRoleToken } = require('./demo-login')
const { isTimeout, readCapped, ResponseTooLargeError, sanitizeLedgerError, upstreamFetch } = require('./_http')

// The server's own ledger access, used by the desk service and the demo USDCx
// registry. Unlike the browser proxy it acts with the node credential for
// several demo parties at once, so only server code builds its commands.

const MAX_ACS_BYTES = 16 * 1_048_576
const REGISTRY_TIMEOUT_MS = 10_000
/** The demo USDCx holding template (splice-test-token-v2, api/_usdcx.js). */
const TOKEN_TEMPLATE = ':Splice.Testing.Tokens.TestTokenV2.Holding:Token'

class LedgerCallError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.name = 'LedgerCallError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}

/** Veil template name, 'Token' for a demo USDCx holding, otherwise null. */
function templateName(templateId) {
  const id = String(templateId)
  if (id.endsWith(TOKEN_TEMPLATE)) return 'Token'
  const parts = id.split(':')
  return parts.length >= 3 && parts[parts.length - 2] === 'Veil' ? parts[parts.length - 1] : null
}

/** Normalize ACS entries to {contractId, template, offset, args}; Veil
 * templates and demo USDCx holdings only. */
function normalizeActive(entries) {
  const out = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const ce = entry?.contractEntry?.JsActiveContract?.createdEvent
    if (!ce || typeof ce.contractId !== 'string') continue
    const template = templateName(ce.templateId)
    if (!template) continue
    out.push({ contractId: ce.contractId, template, offset: ce.offset ?? 0, args: ce.createArgument ?? {} })
  }
  return out
}

async function ledgerAccess(env) {
  const shared = upstreamConfig(env)
  if (shared) return { bearer: await upstreamToken(shared), userId: shared.ledgerUserId, shared }
  // Local sandbox: the proxy forwards each caller's own role token, but the
  // server needs several parties' authority together, which only the operator
  // user holds. Mint a short-lived operator token for this request.
  const privateKeyPem = privateKeyFromEnv(env)
  if (!privateKeyPem) throw new AuthError(503, 'DESK_UNAVAILABLE')
  return { bearer: mintRoleToken('operator', privateKeyPem, env), userId: ROLE_SUBJECTS.operator, shared: null }
}

function ledgerClient(env, access, ctx) {
  const target = ledgerTarget(env)
  const pkg = packageRef(env)
  const template = (name) => `${pkg}:Veil:${name}`

  async function call(method, path, body) {
    let response
    let raw
    try {
      response = await upstreamFetch(`${target}${path}`, {
        method,
        headers: { Authorization: `Bearer ${access.bearer}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      raw = await readCapped(response, MAX_ACS_BYTES)
    } catch (error) {
      if (error instanceof ResponseTooLargeError) throw new LedgerCallError(502, 'PROXY_ERROR', 'The ledger returned an oversized response.')
      if (isTimeout(error)) throw new LedgerCallError(504, 'LEDGER_TIMEOUT')
      throw new LedgerCallError(502, 'PROXY_ERROR')
    }
    if (!response.ok) {
      const { code, message, errorId, category } = sanitizeLedgerError(response.status, raw)
      ctx.ledgerCode = code
      throw new LedgerCallError(response.status, code, message, { ...(errorId ? { errorId } : {}), ...(category !== undefined ? { category } : {}) })
    }
    try {
      return JSON.parse(raw.toString('utf8') || '{}')
    } catch {
      throw new LedgerCallError(502, 'PROXY_ERROR')
    }
  }

  async function acs(party, filter) {
    const end = await call('GET', '/v2/state/ledger-end')
    return call('POST', '/v2/state/active-contracts', {
      eventFormat: { filtersByParty: { [party]: { cumulative: [{ identifierFilter: filter }] } }, verbose: false },
      activeAtOffset: end.offset,
    })
  }

  const active = async (party) => normalizeActive(await acs(party, { WildcardFilter: { value: { includeCreatedEventBlob: false } } }))

  /** Created events (with blobs, and interface views for an interface
   * filter) of one template or interface, as `party` sees them. */
  async function events(party, { templateId, interfaceId }) {
    const filter = templateId
      ? { TemplateFilter: { value: { templateId, includeCreatedEventBlob: true } } }
      : { InterfaceFilter: { value: { interfaceId, includeInterfaceView: true, includeCreatedEventBlob: true } } }
    const entries = await acs(party, filter)
    return (Array.isArray(entries) ? entries : [])
      .map((entry) => entry?.contractEntry?.JsActiveContract)
      .filter((c) => c && typeof c.createdEvent?.contractId === 'string')
      .map((c) => ({ ...c.createdEvent, synchronizerId: c.synchronizerId }))
  }

  async function submit(actAs, commands, prefix, disclosedContracts) {
    const result = await call('POST', '/v2/commands/submit-and-wait-for-transaction', {
      commands: {
        commands,
        commandId: `desk-${prefix}-${crypto.randomUUID()}`,
        actAs,
        userId: access.userId,
        ...(disclosedContracts && disclosedContracts.length > 0
          ? { disclosedContracts: disclosedContracts.map(({ templateId, contractId, createdEventBlob, synchronizerId }) => ({ templateId, contractId, createdEventBlob, synchronizerId })) }
          : {}),
      },
    })
    return result?.transaction ?? {}
  }

  /** A Canton Coin registry call through the validator's scan proxy. */
  async function amulet(path, body) {
    const base = registryTarget(env)
    if (!base || !access.shared) throw new LedgerCallError(503, 'REGISTRY_UNAVAILABLE', 'A Canton Coin loan needs the token registry, which is not configured here.')
    let response
    let raw
    try {
      response = await upstreamFetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access.bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }, REGISTRY_TIMEOUT_MS)
      raw = await readCapped(response, 1_048_576)
    } catch (error) {
      if (isTimeout(error)) throw new LedgerCallError(504, 'REGISTRY_TIMEOUT')
      throw new LedgerCallError(502, 'REGISTRY_PROXY_ERROR')
    }
    if (!response.ok) throw new LedgerCallError(502, 'REGISTRY_PROXY_ERROR', `The token registry returned HTTP ${response.status}.`)
    try {
      return JSON.parse(raw.toString('utf8'))
    } catch {
      throw new LedgerCallError(502, 'REGISTRY_PROXY_ERROR')
    }
  }

  const exercise = (name, contractId, choice, choiceArgument = {}) => ({ ExerciseCommand: { templateId: template(name), contractId, choice, choiceArgument } })
  const createAndExercise = (name, createArguments, choice, choiceArgument) => ({ CreateAndExerciseCommand: { templateId: template(name), createArguments, choice, choiceArgument } })
  const create = (name, createArguments) => ({ CreateCommand: { templateId: name.includes(':') ? name : template(name), createArguments } })

  return { active, events, submit, amulet, exercise, createAndExercise, create }
}

module.exports = { LedgerCallError, ledgerAccess, ledgerClient, normalizeActive, templateName }
