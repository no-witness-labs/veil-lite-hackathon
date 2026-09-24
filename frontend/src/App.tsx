import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { captureSession, clearSession, getSession, signIn, SessionError, type AuthSnapshot } from './auth'
import type { ActivityEntry, Contract, Draft, Role, Session, TxResult } from './types'
import {
  acceptOffer,
  COLLATERAL_ASSET,
  createOffer,
  getConfigIssue,
  getIssuer,
  getParties,
  issueMarginCall,
  LIQUIDATION_THRESHOLD_LTV,
  liquidateLoan,
  liquidateOverdueLoan,
  listActive,
  loadConfig,
  parseHoldings,
  publishValuation,
  repayLoan,
  resolveMarginCall,
  resetDemo,
  topUpCollateral,
  withdrawOffer,
} from './runtime'
import {
  ACCENT,
  DEFAULT_DRAFT,
  PARTY_NAMES,
  ROLE_DOT,
  ROLE_LABELS,
  currentDeal,
  valuationCandidates,
  valuationFor,
  statusOf,
} from './state'
import { RoleTabs } from './components/RoleTabs'
import { CreateOfferForm } from './components/CreateOfferForm'
import { DealCard } from './components/DealCard'
import { ExplainerSidebar } from './components/ExplainerSidebar'
import { ActivityFeed } from './components/ActivityFeed'
import { RawInspector } from './components/RawInspector'
import { PartyBar } from './components/PartyBar'
import { HoldingsPanel } from './components/HoldingsPanel'
import { ErrorBanner, OutsiderEmpty, ShockBanner, Waiting } from './components/EmptyStates'
import { ValuationPanel } from './components/ValuationPanel'
import { SignIn } from './components/SignIn'

export default function App() {
  const initialSession = getSession()
  const initialRole: Role = initialSession?.role === 'operator' || !initialSession ? 'lender' : initialSession.role
  const [session, setSession] = useState<Session | null>(initialSession)
  const [role, setRole] = useState<Role>(initialRole)
  const [contracts, setContracts] = useState<Contract[]>([])
  const [raw, setRaw] = useState<unknown[]>([])
  const [offset, setOffset] = useState(0)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [draft, setDraft] = useState<Draft>({ ...DEFAULT_DRAFT })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [configOk, setConfigOk] = useState<boolean | null>(null)
  const [configIssue, setConfigIssue] = useState<string | null>(null)
  const refreshGeneration = useRef(0)
  const authGeneration = useRef(0)
  const activeRole = useRef<Role>(initialRole)

  const clearLedgerState = useCallback(() => {
    setContracts([])
    setRaw([])
    setOffset(0)
    setActivity([])
    setDraft({ ...DEFAULT_DRAFT })
    setError(null)
    setLoading(false)
  }, [])

  const signOut = useCallback((message: string | null = null) => {
    authGeneration.current += 1
    refreshGeneration.current += 1
    clearSession()
    setSession(null)
    activeRole.current = 'lender'
    setRole('lender')
    setBusy(false)
    setAuthBusy(false)
    setToken('')
    setAuthError(message)
    clearLedgerState()
  }, [clearLedgerState])

  const errorStatus = (value: unknown): number | undefined => {
    if (value instanceof SessionError) return value.status
    if (value && typeof value === 'object' && 'status' in value) {
      const status = (value as { status?: unknown }).status
      return typeof status === 'number' ? status : undefined
    }
    return undefined
  }

  const errorMessage = (value: unknown): string => value instanceof Error ? value.message : String(value)

  const refresh = useCallback(async (forRole: Role, expectedAuthGeneration = authGeneration.current, snapshot?: AuthSnapshot) => {
    const generation = ++refreshGeneration.current
    setLoading(true)
    try {
      const state = await listActive(forRole, snapshot ?? captureSession())
      if (expectedAuthGeneration !== authGeneration.current || generation !== refreshGeneration.current || forRole !== activeRole.current) return
      setContracts(state.contracts)
      setRaw(state.raw)
      setOffset(state.offset)
    } catch (e) {
      if (expectedAuthGeneration !== authGeneration.current || generation !== refreshGeneration.current || forRole !== activeRole.current) return
      if (errorStatus(e) === 401) {
        signOut('Your role session expired or was rejected. Sign in again with a fresh token.')
        return
      }
      setError(errorMessage(e))
    } finally {
      if (expectedAuthGeneration === authGeneration.current && generation === refreshGeneration.current) setLoading(false)
    }
  }, [signOut])

  const submitSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (authBusy) return
    const candidate = token
    setToken('')
    setAuthBusy(true)
    setAuthError(null)
    try {
      const nextSession = await signIn(candidate)
      authGeneration.current += 1
      refreshGeneration.current += 1
      const nextRole: Role = nextSession.role === 'operator' ? 'lender' : nextSession.role
      activeRole.current = nextRole
      setSession(nextSession)
      setRole(nextRole)
      clearLedgerState()
    } catch (e) {
      setAuthError(errorMessage(e))
    } finally {
      setToken('')
      setAuthBusy(false)
    }
  }

  useEffect(() => {
    void loadConfig().then((ok) => {
      setConfigOk(ok)
      setConfigIssue(getConfigIssue())
    })
  }, [])

  useEffect(() => {
    if (session && configOk === true) void refresh(role)
  }, [role, configOk, session, refresh])

  useEffect(() => {
    if (!session) return
    const delay = Math.max(0, session.expiresAt * 1000 - Date.now())
    const timer = window.setTimeout(() => signOut('Your role session expired. Sign in again with a fresh token.'), delay)
    return () => window.clearTimeout(timer)
  }, [session, signOut])

  // Run a ledger action and record its committed transaction.
  const act = async (label: string, actor: string, fn: (snapshot: AuthSnapshot) => Promise<TxResult>) => {
    if (!session) return
    const expectedAuthGeneration = authGeneration.current
    const expectedRole = activeRole.current
    let snapshot: AuthSnapshot
    try {
      snapshot = captureSession()
    } catch (e) {
      if (errorStatus(e) === 401) signOut('Your role session expired or was rejected. Sign in again with a fresh token.')
      else setError(errorMessage(e))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await fn(snapshot)
      if (expectedAuthGeneration !== authGeneration.current || expectedRole !== activeRole.current) return
      setActivity((a) => [{ key: result.updateId || `tx-${a.length}`, action: label, actor, result }, ...a])
      await refresh(expectedRole, expectedAuthGeneration, snapshot)
    } catch (e) {
      if (expectedAuthGeneration !== authGeneration.current || expectedRole !== activeRole.current) return
      if (errorStatus(e) === 401) {
        signOut('Your role session expired or was rejected. Sign in again with a fresh token.')
        return
      }
      setError(errorMessage(e))
    } finally {
      if (expectedAuthGeneration === authGeneration.current && expectedRole === activeRole.current) setBusy(false)
    }
  }

  const deal = currentDeal(contracts, getIssuer())
  const status = statusOf(deal)
  const holdings = parseHoldings(contracts)
  const valuation = valuationFor(contracts, deal)
  const dealValuations = valuationCandidates(contracts, deal)
  const parties = getParties()
  const availableValuations = valuationCandidates(contracts).filter((mark) =>
    mark.valuationAgent === parties.valuer
      && mark.lender === parties.lender
      && mark.borrower === parties.borrower
      && mark.regulator === parties.regulator
      && mark.collateralAsset === COLLATERAL_ASSET
  )

  const isOutsider = role === 'outsider'
  const isValuer = role === 'valuer'
  const hasDeal = status !== 'none'
  const showCreateForm = !isOutsider && role === 'lender' && status === 'none'
  const showWaiting = !isOutsider && !isValuer && (role === 'borrower' || role === 'regulator') && status === 'none'
  const showDealCard = !isOutsider && !isValuer && hasDeal && !!deal
  const collateralCandidates = holdings
    .filter((holding) => holding.kind === 'collateral' && holding.asset === COLLATERAL_ASSET)
    .map((holding) => holding.amount)
    .filter((amount) => amount > 0)
    .sort((a, b) => a - b)
  const liquidationThreshold = deal ? Number(deal.args.liquidationThresholdLtv) : Number.NaN
  const markedLtv = deal && valuation ? Number(deal.args.principal) / (Number(deal.args.collateralQuantity) * valuation.unitPrice) * 100 : 0
  const showShockBanner = !isOutsider && !isValuer && status === 'active' && Number.isFinite(liquidationThreshold) && Boolean(valuation && markedLtv >= liquidationThreshold)
  const availableTopUp = deal && valuation && Number.isFinite(liquidationThreshold)
    ? collateralCandidates.find((amount) => Number(deal.args.principal) / ((Number(deal.args.collateralQuantity) + amount) * valuation.unitPrice) * 100 < liquidationThreshold) ?? 0
    : collateralCandidates[0] ?? 0

  const onReset = async () => {
    if (session?.role !== 'operator' || configOk !== true || busy) return
    const expectedAuthGeneration = authGeneration.current
    const expectedRole = activeRole.current
    let snapshot: AuthSnapshot
    try {
      snapshot = captureSession()
    } catch (e) {
      if (errorStatus(e) === 401) signOut('Your role session expired or was rejected. Sign in again with a fresh token.')
      else setError(errorMessage(e))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await resetDemo(snapshot)
      if (expectedAuthGeneration !== authGeneration.current || expectedRole !== activeRole.current) return
      setActivity([])
      setDraft({ ...DEFAULT_DRAFT })
      await refresh(expectedRole, expectedAuthGeneration, snapshot)
    } catch (e) {
      if (expectedAuthGeneration !== authGeneration.current || expectedRole !== activeRole.current) return
      if (errorStatus(e) === 401) {
        signOut('Your role session expired or was rejected. Sign in again with a fresh token.')
        return
      }
      setError(errorMessage(e))
    } finally {
      if (expectedAuthGeneration === authGeneration.current && expectedRole === activeRole.current) setBusy(false)
    }
  }

  const selectRole = (nextRole: Role) => {
    if (session?.role !== 'operator' || nextRole === role || busy) return
    // Clear the previous party's snapshot before the async query starts. The
    // generation guard above prevents a slow old response from repopulating it.
    refreshGeneration.current += 1
    activeRole.current = nextRole
    setRole(nextRole)
    setContracts([])
    setRaw([])
    setOffset(0)
    setError(null)
  }

  if (!session) return <SignIn token={token} error={authError} busy={authBusy} onTokenChange={setToken} onSubmit={submitSignIn} />

  const isOperator = session.role === 'operator'

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 64 }}>
      {/* HEADER */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,0.92)', backdropFilter: 'saturate(1.4) blur(10px)', borderBottom: '1px solid #e6e8ec' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px', height: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 14, height: 14, background: ACCENT, borderRadius: 3, transform: 'rotate(45deg)' }} />
            <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em', color: '#14171f' }}>Veil</div>
            <div style={{ marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9aa1ad', border: '1px solid #e6e8ec', borderRadius: 999, padding: '4px 9px' }}>
              Canton · Demo
            </div>
            {isOperator && (
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a5d10', background: '#fdf3e0', border: '1px solid #f2d79d', borderRadius: 999, padding: '4px 9px' }}>
                Demo operator
              </div>
            )}
          </div>

          {isOperator && <RoleTabs role={role} onSelect={selectRole} disabled={busy} />}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9aa1ad' }}>Viewing as</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end', marginTop: 2 }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: ROLE_DOT[role] }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f' }}>{ROLE_LABELS[role]}</div>
              </div>
            </div>
            {isOperator && (
              <button
                onClick={onReset}
                disabled={busy || configOk !== true}
                style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#5b6472', fontSize: 12, fontWeight: 500, padding: '9px 14px', borderRadius: 8, cursor: busy ? 'wait' : configOk === true ? 'pointer' : 'not-allowed' }}
              >
                Reset demo
              </button>
            )}
            <button
              onClick={() => { if (!busy && !loading) void refresh(role) }}
              disabled={busy || loading || configOk !== true}
              style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#5b6472', fontSize: 12, fontWeight: 500, padding: '9px 14px', borderRadius: 8, cursor: busy || loading ? 'wait' : 'pointer' }}
            >
              Refresh
            </button>
            <button
              onClick={() => signOut()}
              disabled={busy}
              style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#5b6472', fontSize: 12, fontWeight: 500, padding: '9px 14px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
            >
              Sign out
            </button>
          </div>
        </div>
        {configOk === true && <PartyBar active={role} />}
      </div>

      {/* BODY */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 32 }}>
        {configOk !== true ? (
          <div style={{ background: '#fff', border: '1px solid #e6e8ec', borderRadius: 14, padding: '56px 40px', textAlign: 'center', boxShadow: '0 1px 2px rgba(20,23,31,0.04)' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#14171f', marginBottom: 10 }}>
              {configOk === null ? 'Connecting to Canton…' : 'Ledger not ready'}
            </div>
            <div style={{ fontSize: 14, color: '#5b6472', lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
              {configOk === null ? (
                'Loading ledger configuration.'
              ) : (
                <>
                  {configIssue ?? 'No valid ledger configuration found. Start the sandbox or configure the DevNet deployment first.'}
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: '#14171f', background: '#f7f8fa', borderRadius: 8, padding: '10px 14px', marginTop: 14 }}>
                    ./scripts/start-sandbox.sh
                  </div>
                  For DevNet/Vercel, see <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>docs/DEVNET.md</span>.
                </>
              )}
            </div>
          </div>
        ) : (
        <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .18s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 358px', gap: 28, alignItems: 'start' }}>
            {/* LEFT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
              {showShockBanner && valuation && <ShockBanner unitPrice={valuation.unitPrice} observedAt={valuation.observedAt} valuationAgent={valuation.valuationAgent} />}
              {isOutsider && <OutsiderEmpty />}
              {isValuer && (
                <ValuationPanel
                  contracts={contracts}
                  latest={valuation}
                  onPublish={(price) => act(`Publish valuation ${price.toFixed(2)}`, PARTY_NAMES.valuer, (snapshot) => publishValuation(price, snapshot))}
                  busy={busy}
                />
              )}
              {showCreateForm && (
                <CreateOfferForm
                  draft={draft}
                  valuations={availableValuations}
                  liquidationThresholdLtv={LIQUIDATION_THRESHOLD_LTV}
                  onChange={(field, value) => setDraft((d) => ({ ...d, [field]: value }) as Draft)}
                  onSubmit={() => act('Create offer', PARTY_NAMES.lender, (snapshot) => createOffer(draft, snapshot))}
                  busy={busy}
                />
              )}
              {showWaiting && <Waiting role={role} />}
              {showDealCard && deal && (
                <DealCard
                  role={role}
                  status={status}
                  deal={deal}
                  valuation={valuation}
                  valuationCandidates={dealValuations}
                  availableTopUp={availableTopUp}
                  busy={busy}
                  actions={{
                    onWithdraw: () => act('Withdraw offer', PARTY_NAMES.lender, (snapshot) => withdrawOffer(deal.contractId, snapshot)),
                    onAccept: () => act('Accept offer', PARTY_NAMES.borrower, (snapshot) => acceptOffer(deal.contractId, snapshot)),
                    onRepay: () =>
                      act('Repay loan', PARTY_NAMES.borrower, (snapshot) =>
                        repayLoan(deal.contractId, Number(deal.args.principal) + Number(deal.args.interest), snapshot),
                      ),
                    onLiquidate: () =>
                      act('Liquidate collateral', PARTY_NAMES.lender, (snapshot) => {
                        if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh mark before liquidating.')
                        return liquidateLoan(deal.contractId, valuation.contractId, snapshot)
                      }),
                    onLiquidateOverdue: () =>
                      act('Liquidate after maturity', PARTY_NAMES.lender, (snapshot) => liquidateOverdueLoan(deal.contractId, snapshot)),
                    onIssueMarginCall: () =>
                      act('Issue margin call', PARTY_NAMES.lender, (snapshot) => {
                        if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh breached mark first.')
                        return issueMarginCall(deal.contractId, valuation.contractId, snapshot)
                      }),
                    onTopUp: (quantity) =>
                      act(`Top up collateral · ${quantity} units`, PARTY_NAMES.borrower, (snapshot) => {
                        if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh mark before topping up.')
                        return topUpCollateral(deal.contractId, quantity, valuation.contractId, snapshot)
                      }),
                    onResolveMarginCall: () =>
                      act('Resolve margin call', PARTY_NAMES.borrower, (snapshot) => {
                        if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh healthy mark first.')
                        return resolveMarginCall(deal.contractId, valuation.contractId, snapshot)
                      }),
                  }}
                />
              )}

              {!isOutsider && !isValuer && <HoldingsPanel role={role} holdings={holdings} />}
              {!isOutsider && !isValuer && <ActivityFeed entries={activity} />}
              <RawInspector role={role} raw={raw} offset={offset} />
            </div>

            {/* RIGHT */}
            <ExplainerSidebar role={role} />
          </div>
        </div>
        )}
      </div>

      {/* a tiny footer note so judges know the privacy is real */}
      <div style={{ maxWidth: 1200, margin: '8px auto 0', padding: '0 32px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#bcc2cb' }}>
        Viewing as {PARTY_NAMES[role]} · live Canton ledger · {raw.length} visible contract{raw.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}
