import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { captureSession, clearSession, demoLoginInfo, getSession, signIn, signInWithPasscode, SessionError, type AuthSnapshot, type DemoLoginInfo } from './auth'
import type { ActivityEntry, Contract, Draft, Role, Session, SessionRole, TxResult } from './types'
import {
  acceptOffer,
  applySubstitution,
  cancelSubstitution,
  partialRepay,
  COLLATERAL_ASSETS,
  proposeSubstitution,
  rejectSubstitution,
  COLLATERAL_ASSET,
  createOffer,
  getConfigIssue,
  getIssuer,
  getParties,
  issueMarginCall,
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
  DEFAULT_DRAFT,
  PARTY_NAMES,
  UNIT_CASH,
  balanceOf,
  currentDeal,
  fmtTimestamp,
  marginCallOf,
  repaidOf,
  substitutionRequestFor,
  isRole,
  valuationCandidates,
  valuationFor,
  statusOf,
} from './state'
import { Banner } from './ui/primitives'
import { useTheme } from './theme/useTheme'
import { TopBar } from './components/TopBar'
import { Hero } from './components/Hero'
import { SectionTabs, isSectionKey, type SectionDef, type SectionKey } from './components/SectionTabs'
import { PartyStrip } from './components/PartyStrip'
import { OfferTicket } from './components/OfferTicket'
import { PositionPanel } from './components/PositionPanel'
import { ValuationPanel } from './components/ValuationPanel'
import { SubstitutionPanel } from './components/SubstitutionPanel'
import { PaydownPanel } from './components/PaydownPanel'
import { DisclosureMatrix } from './components/DisclosureMatrix'
import { PositionsTable } from './components/PositionsTable'
import { ActivityLog } from './components/ActivityLog'
import { LedgerInspector } from './components/LedgerInspector'
import { ViewpointRail } from './components/ViewpointRail'
import { ConnectionGate, OutsiderEmpty, Waiting } from './components/EmptyStates'
import { SignIn } from './components/SignIn'

/** Sections are linkable (`?section=disclosure`), so a walkthrough can jump
 * straight to the disclosure matrix or the raw ledger response. */
function urlSection(): SectionKey {
  const param = new URLSearchParams(window.location.search).get('section')
  return isSectionKey(param) ? param : 'position'
}

/** The viewpoint a session opens on. A party token is bound to its own role;
 * only the demo operator may pick one, and may deep-link it with `?role=`. */
function roleForSession(sessionRole: SessionRole | undefined): Role {
  if (sessionRole && sessionRole !== 'operator') return sessionRole
  const param = new URLSearchParams(window.location.search).get('role')
  return sessionRole === 'operator' && isRole(param) ? param : 'lender'
}

/** Mirror a viewpoint or section change into the URL without a navigation.
 * `null` removes the parameter. Never carries anything but these two keys. */
function syncUrl(key: 'role' | 'section', value: string | null) {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  window.history.replaceState(null, '', url)
}

export default function App() {
  const initialSession = getSession()
  const initialRole = roleForSession(initialSession?.role)
  const [session, setSession] = useState<Session | null>(initialSession)
  const [role, setRole] = useState<Role>(initialRole)
  const [section, setSection] = useState<SectionKey>(urlSection)
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
  const [demoLogin, setDemoLogin] = useState<DemoLoginInfo>({ enabled: false, open: false, operator: false })
  const { theme, toggle: toggleTheme } = useTheme()
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
    // The next session starts on its own position, not wherever this one left off.
    setSection('position')
    syncUrl('section', null)
    syncUrl('role', null)
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
        signOut('Your role session expired or was rejected. Sign in again.')
        return
      }
      setError(errorMessage(e))
    } finally {
      if (expectedAuthGeneration === authGeneration.current && generation === refreshGeneration.current) setLoading(false)
    }
  }, [signOut])

  const submitSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const candidate = token
    setToken('')
    void completeSignIn(() => signIn(candidate))
  }

  const submitPasscode = (sessionRole: SessionRole, passcode: string) => {
    void completeSignIn(() => signInWithPasscode(sessionRole, passcode, !demoLogin.open || sessionRole === 'operator'))
  }

  const completeSignIn = async (attempt: () => Promise<Session>) => {
    if (authBusy) return
    setAuthBusy(true)
    setAuthError(null)
    try {
      const nextSession = await attempt()
      authGeneration.current += 1
      refreshGeneration.current += 1
      const nextRole = roleForSession(nextSession.role)
      activeRole.current = nextRole
      setSession(nextSession)
      setRole(nextRole)
      setSection(urlSection())
      clearLedgerState()
    } catch (e) {
      setAuthError(errorMessage(e))
    } finally {
      setToken('')
      setAuthBusy(false)
    }
  }

  useEffect(() => {
    void demoLoginInfo().then(setDemoLogin)
  }, [])

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
    const timer = window.setTimeout(() => signOut('Your role session expired. Sign in again.'), delay)
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
      if (errorStatus(e) === 401) signOut('Your role session expired or was rejected. Sign in again.')
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
        signOut('Your role session expired or was rejected. Sign in again.')
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
  const showPosition = !isOutsider && !isValuer && hasDeal && !!deal
  const dealAsset = deal?.args.collateralAsset ?? COLLATERAL_ASSET
  const collateralCandidates = holdings
    .filter((holding) => holding.kind === 'collateral' && holding.asset === dealAsset)
    .map((holding) => holding.amount)
    .filter((amount) => amount > 0)
    .sort((a, b) => a - b)
  const liquidationThreshold = deal ? Number(deal.args.liquidationThresholdLtv) : Number.NaN
  const balance = balanceOf(Number(deal?.args.principal), Number(deal?.args.interest), repaidOf(deal))
  const markedLtv = deal && valuation ? balance.outstandingPrincipal / (Number(deal.args.collateralQuantity) * valuation.unitPrice) * 100 : 0
  const showShockBanner = !isOutsider && !isValuer && status === 'active' && Number.isFinite(liquidationThreshold) && Boolean(valuation && markedLtv >= liquidationThreshold)
  const substitution = substitutionRequestFor(contracts, deal)
  const replacementHolding = holdings
    .filter((holding) => holding.kind === 'collateral' && holding.asset !== dealAsset
      && (COLLATERAL_ASSETS as readonly string[]).includes(holding.asset ?? ''))
    .sort((a, b) => b.amount - a.amount)[0]
  const replacementMarks = substitution
    ? valuationCandidates(contracts).filter((mark) => mark.streamId === substitution.args.newValuationStreamId)
    : []
  // The largest single reserve holding: a top-up of any size up to this is
  // carved out of it privately before the loan sees it.
  const availableTopUp = collateralCandidates.length > 0 ? collateralCandidates[collateralCandidates.length - 1] : 0

  const onReset = async () => {
    if (session?.role !== 'operator' || configOk !== true || busy) return
    const expectedAuthGeneration = authGeneration.current
    const expectedRole = activeRole.current
    let snapshot: AuthSnapshot
    try {
      snapshot = captureSession()
    } catch (e) {
      if (errorStatus(e) === 401) signOut('Your role session expired or was rejected. Sign in again.')
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
        signOut('Your role session expired or was rejected. Sign in again.')
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
    syncUrl('role', nextRole)
    setContracts([])
    setRaw([])
    setOffset(0)
    setError(null)
  }

  const selectSection = (next: SectionKey) => {
    setSection(next)
    syncUrl('section', next)
  }

  if (!session) {
    return (
      <SignIn
        token={token}
        error={authError}
        busy={authBusy}
        onTokenChange={setToken}
        onSubmit={submitSignIn}
        demoLogin={demoLogin}
        onPasscodeSubmit={submitPasscode}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    )
  }

  const isOperator = session.role === 'operator'
  // Holdings and the session log are hidden from the valuer and the outsider:
  // neither is a stakeholder on a wallet, and the log is a demo-operator aid.
  const privateSections = !isOutsider && !isValuer
  const sections: SectionDef[] = [
    { key: 'position', label: isValuer ? 'Valuation' : 'Position' },
    { key: 'disclosure', label: 'Disclosure' },
    ...(privateSections
      ? [
          { key: 'holdings' as const, label: 'Holdings', count: holdings.length },
          { key: 'activity' as const, label: 'Activity', count: activity.length },
        ]
      : []),
    { key: 'ledger', label: 'Raw ledger', count: raw.length },
  ]
  const activeSection: SectionKey = sections.some((s) => s.key === section) ? section : 'position'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        role={role}
        isOperator={isOperator}
        onRoleChange={selectRole}
        onReset={onReset}
        onRefresh={() => { if (!busy && !loading) void refresh(role) }}
        onSignOut={() => signOut()}
        busy={busy}
        loading={loading}
        connected={configOk === true}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {configOk === true && <Hero />}

      {configOk === true && <SectionTabs active={activeSection} onSelect={selectSection} sections={sections} />}

      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 'var(--shell-max)',
          margin: '0 auto',
          padding: 'var(--space-7) var(--shell-gutter) var(--space-10)',
        }}
      >
        {configOk !== true ? (
          <ConnectionGate connecting={configOk === null} issue={configIssue} />
        ) : (
          <div
            className="v-shell"
            style={{
              opacity: loading ? 0.65 : 1,
              transition: 'opacity var(--duration) var(--ease)',
            }}
          >
            <div style={{ display: 'grid', gap: 'var(--space-6)', minWidth: 0 }}>
              {error && (
                <Banner tone="danger" title="Ledger error." onDismiss={() => setError(null)}>
                  {error}
                </Banner>
              )}

              {activeSection === 'position' && (
                <>
                  {showShockBanner && valuation && (
                    <Banner tone="danger" title={`Ledger-attested mark: ${valuation.unitPrice.toFixed(2)} ${UNIT_CASH}/unit.`}>
                      LTV at this mark exceeds the facility’s {liquidationThreshold}% threshold. Observed{' '}
                      {fmtTimestamp(valuation.observedAt)}
                      {valuation.valuationAgent ? ` by ${valuation.valuationAgent.split('::')[0]}.` : '.'}
                    </Banner>
                  )}
                  {isOutsider && <OutsiderEmpty />}
                  {isValuer && (
                    <ValuationPanel
                      contracts={contracts}
                      assets={COLLATERAL_ASSETS}
                      onPublish={(price, asset) => act(`Publish ${asset} valuation ${price.toFixed(2)}`, PARTY_NAMES.valuer, (snapshot) => publishValuation(price, asset, snapshot))}
                      busy={busy}
                    />
                  )}
                  {showCreateForm && (
                    <OfferTicket
                      draft={draft}
                      valuations={availableValuations}
                      availableCash={holdings.filter((holding) => holding.kind === 'cash').reduce((sum, holding) => sum + holding.amount, 0)}
                      onChange={(field, value) => setDraft((d) => ({ ...d, [field]: value }) as Draft)}
                      onSubmit={() => act('Create offer', PARTY_NAMES.lender, (snapshot) => createOffer(draft, snapshot))}
                      busy={busy}
                    />
                  )}
                  {showWaiting && <Waiting role={role} />}
                  {showPosition && deal && (
                    <PositionPanel
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
                            repayLoan(deal.contractId, balance.outstandingDue, snapshot),
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
                            return topUpCollateral(deal.contractId, dealAsset, quantity, valuation.contractId, snapshot)
                          }),
                        onResolveMarginCall: () =>
                          act('Resolve margin call', PARTY_NAMES.borrower, (snapshot) => {
                            if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh healthy mark first.')
                            return resolveMarginCall(deal.contractId, valuation.contractId, snapshot)
                          }),
                      }}
                    />
                  )}
                  {showPosition && deal && status === 'active' && role === 'borrower' && (
                    <PaydownPanel
                      loan={deal}
                      valuation={valuation}
                      availableCash={holdings.filter((holding) => holding.kind === 'cash').reduce((sum, holding) => sum + holding.amount, 0)}
                      busy={busy}
                      onPayDown={(amount) =>
                        act(`Pay down ${amount}`, PARTY_NAMES.borrower, (snapshot) =>
                          partialRepay(deal.contractId, amount, marginCallOf(deal) ? valuation?.contractId ?? null : null, snapshot),
                        )}
                    />
                  )}
                  {showPosition && deal && status === 'active' && (
                    <SubstitutionPanel
                      role={role}
                      loan={deal}
                      request={substitution}
                      replacement={replacementHolding}
                      replacementMarks={replacementMarks}
                      busy={busy}
                      actions={{
                        onPropose: (asset, quantity) =>
                          act(`Propose substitution · ${quantity} ${asset}`, PARTY_NAMES.borrower, (snapshot) => proposeSubstitution(deal, asset, quantity, snapshot)),
                        onApply: () =>
                          act('Approve collateral substitution', PARTY_NAMES.lender, (snapshot) => {
                            if (!substitution || replacementMarks.length !== 1) throw new Error('Publish a fresh mark for the replacement asset first.')
                            return applySubstitution(deal.contractId, substitution.contractId, replacementMarks[0].contractId, snapshot)
                          }),
                        onReject: () =>
                          act('Reject collateral substitution', PARTY_NAMES.lender, (snapshot) => {
                            if (!substitution) throw new Error('The substitution request is no longer visible.')
                            return rejectSubstitution(substitution.contractId, snapshot)
                          }),
                        onCancel: () =>
                          act('Cancel collateral substitution', PARTY_NAMES.borrower, (snapshot) => {
                            if (!substitution) throw new Error('The substitution request is no longer visible.')
                            return cancelSubstitution(substitution.contractId, snapshot)
                          }),
                      }}
                    />
                  )}
                </>
              )}

              {activeSection === 'disclosure' && (
                <>
                  <DisclosureMatrix role={role} />
                  <PartyStrip parties={parties} issuer={getIssuer()} active={role} />
                </>
              )}

              {activeSection === 'holdings' && <PositionsTable role={role} holdings={holdings} />}
              {activeSection === 'activity' && <ActivityLog entries={activity} />}
              {activeSection === 'ledger' && <LedgerInspector role={role} raw={raw} offset={offset} />}
            </div>

            <ViewpointRail role={role} />
          </div>
        )}
      </main>
    </div>
  )
}
