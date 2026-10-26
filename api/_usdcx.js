const { authenticate, AuthError, knownParties, respondError } = require('./_auth')
const { parseJsonBody, requestBody } = require('./_ledger')
const { LedgerCallError, ledgerAccess, ledgerClient } = require('./_nodeLedger')
const { noteRole, sendError, sendJson } = require('./_http')

// Demo USDCx. The hosted demo lends a stand-in for USDCx: Splice's reference
// Token Standard V2 token (splice-test-token-v2, vendored unchanged), issued
// by the demo issuer. That token has no off-ledger registry service, so this
// module serves what one would: the factory (TokenRules is both the allocation
// and the settlement factory), the choice context, and disclosures of the
// rules and of the holdings an allocation locked, which an executor who does
// not own them needs to settle or cancel it. Nothing here submits for the
// caller; minting is the wallet top-up's (api/_holdings.js).

const TOKEN_PACKAGE = '#splice-test-token-v2'
const RULES_TEMPLATE = `${TOKEN_PACKAGE}:Splice.Testing.Tokens.TestTokenV2:TokenRules`
const TOKEN_TEMPLATE = `${TOKEN_PACKAGE}:Splice.Testing.Tokens.TestTokenV2.Holding:Token`
const ALLOCATION_INTERFACE = '#splice-api-token-allocation-v2:Splice.Api.Token.AllocationV2:Allocation'
const USDCX_ID = 'USDCx'
const MAX_ALLOCATIONS = 2
const TRANSACTING_ROLES = new Set(['lender', 'borrower', 'operator'])

const disclosure = (ce) => ({ templateId: ce.templateId, contractId: ce.contractId, createdEventBlob: ce.createdEventBlob, synchronizerId: ce.synchronizerId })
const viewOf = (ce) => ce.interfaceViews?.[0]?.viewValue

/** The issuer's TokenRules, created on first use. When two requests race to
 * create it, the oldest is used from then on. */
async function tokenRules(ledger, issuer) {
  const find = async () => (await ledger.events(issuer, { templateId: RULES_TEMPLATE }))
    .filter((ce) => ce.createArgument?.admin === issuer)
    .sort((a, b) => Number(a.offset ?? 0) - Number(b.offset ?? 0))[0]
  const existing = await find()
  if (existing) return existing
  await ledger.submit([issuer], [ledger.create(RULES_TEMPLATE, { admin: issuer })], 'usdcx-rules')
  const created = await find()
  if (!created) throw new LedgerCallError(502, 'REGISTRY_ERROR', 'The demo USDCx rules were created but could not be read back.')
  return created
}

/** Every account in the demo is the owner's own, so no account configuration
 * is ever passed. */
function choiceContextData(rulesCid) {
  return { values: { 'testTokenV2/accountConfigs': { tag: 'AV_List', value: [] }, 'testTokenV2/tokenRules': { tag: 'AV_ContractId', value: rulesCid } } }
}

/** The holdings each allocation locked, disclosed, for a caller who executes
 * or authorized it; any other allocation is refused. */
async function lockedHoldings(ledger, issuer, allocationCids, party) {
  if (allocationCids.length === 0) return []
  const allocations = await ledger.events(issuer, { interfaceId: ALLOCATION_INTERFACE })
  const wanted = new Set()
  for (const cid of allocationCids) {
    const view = viewOf(allocations.find((ce) => ce.contractId === cid) ?? {})
    if (!view) throw new AuthError(404, 'ALLOCATION_NOT_FOUND')
    const involved = [...(view.settlement?.executors ?? []), view.allocation?.authorizer?.owner]
    if (party !== null && !involved.includes(party)) throw new AuthError(403, 'PARTY_FORBIDDEN')
    for (const holding of view.holdingCids ?? []) wanted.add(holding)
  }
  return (await ledger.events(issuer, { templateId: TOKEN_TEMPLATE })).filter((ce) => wanted.has(ce.contractId)).map(disclosure)
}

/** Factory and choice context for one demo USDCx call, in the registry API's
 * shape, plus disclosures of the holdings locked by `allocationCids`. */
async function usdcxContext(ledger, issuer, allocationCids = [], party = null) {
  const rules = await tokenRules(ledger, issuer)
  return {
    admin: issuer,
    instrumentId: USDCX_ID,
    factoryId: rules.contractId,
    choiceContext: {
      choiceContextData: choiceContextData(rules.contractId),
      disclosedContracts: [disclosure(rules), ...(await lockedHoldings(ledger, issuer, allocationCids, party))],
    },
  }
}

/** One demo USDCx holding, created with issuer and owner authority. */
function mintCommand(ledger, issuer, owner, amount) {
  return ledger.create(TOKEN_TEMPLATE, {
    holding: { account: { owner, provider: null, id: '' }, instrumentId: { admin: issuer, id: USDCX_ID }, amount, lock: null, meta: { values: {} } },
  })
}

function roleParty(role, config) {
  return role === 'operator' ? null : config.parties[role]
}

function validBody(body) {
  const keys = Object.keys(body)
  if (keys.some((key) => key !== 'allocationCids')) throw new AuthError(400, 'REQUEST_INVALID')
  const cids = body.allocationCids ?? []
  if (!Array.isArray(cids) || cids.length > MAX_ALLOCATIONS || cids.some((cid) => typeof cid !== 'string' || !/^[0-9a-f]{20,200}$/.test(cid))) {
    throw new AuthError(400, 'REQUEST_INVALID')
  }
  return [...new Set(cids)]
}

/** POST /api/registry/usdcx/context {allocationCids?}. The caller has
 * already been routed here by api/_registry.js. */
async function usdcxContextRequest(req, res, env) {
  try {
    if (String(req.method || 'GET').toUpperCase() !== 'POST') throw new AuthError(405, 'METHOD_NOT_ALLOWED')
    const auth = authenticate(req, env)
    noteRole(res, auth.role)
    if (!TRANSACTING_ROLES.has(auth.role)) throw new AuthError(403, 'ROLE_FORBIDDEN')
    const allocationCids = validBody(parseJsonBody(await requestBody(req)))
    const config = knownParties(env)
    const access = await ledgerAccess(env)
    const ledger = ledgerClient(env, access, {})
    res.setHeader('Cache-Control', 'no-store')
    sendJson(res, 200, await usdcxContext(ledger, config.issuer, allocationCids, roleParty(auth.role, config)))
  } catch (error) {
    if (error instanceof LedgerCallError) {
      sendError(res, error.status, error.code, error.message === error.code ? undefined : error.message)
      return
    }
    if (error instanceof AuthError) {
      respondError(res, error)
      return
    }
    sendError(res, 502, 'REGISTRY_ERROR')
  }
}

module.exports = { TOKEN_TEMPLATE, USDCX_ID, mintCommand, tokenRules, usdcxContext, usdcxContextRequest }
