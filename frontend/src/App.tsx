import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityEntry, Contract, Draft, Role, TxResult } from './types'
import {
  acceptOffer,
  createOffer,
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
  ACCENT,
  DEFAULT_DRAFT,
  PARTY_NAMES,
  ROLE_DOT,
  ROLE_LABELS,
  currentDeal,
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

export default function App() {
  const [role, setRole] = useState<Role>('lender')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [raw, setRaw] = useState<unknown[]>([])
  const [offset, setOffset] = useState(0)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configOk, setConfigOk] = useState<boolean | null>(null)
  const refreshGeneration = useRef(0)
  const activeRole = useRef<Role>(role)

  const refresh = useCallback(async (forRole: Role) => {
    const generation = ++refreshGeneration.current
    setLoading(true)
    try {
      const state = await listActive(forRole)
      if (generation !== refreshGeneration.current || forRole !== activeRole.current) return
      setContracts(state.contracts)
      setRaw(state.raw)
      setOffset(state.offset)
    } catch (e) {
      if (generation !== refreshGeneration.current || forRole !== activeRole.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (generation === refreshGeneration.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig().then((ok) => {
      setConfigOk(ok)
    })
  }, [])

  useEffect(() => {
    if (configOk) void refresh(role)
  }, [role, configOk, refresh])

  // Run a ledger action and record its committed transaction.
  const act = async (label: string, actor: string, fn: () => Promise<TxResult>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      setActivity((a) => [{ key: result.updateId || `tx-${a.length}`, action: label, actor, result }, ...a])
      await refresh(role)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const deal = currentDeal(contracts)
  const status = statusOf(deal)
  const holdings = parseHoldings(contracts)
  const valuation = valuationFor(contracts, deal)

  const isOutsider = role === 'outsider'
  const isValuer = role === 'valuer'
  const hasDeal = status !== 'none'
  const showCreateForm = !isOutsider && role === 'lender' && status === 'none'
  const showWaiting = !isOutsider && !isValuer && (role === 'borrower' || role === 'regulator') && status === 'none'
  const showDealCard = !isOutsider && !isValuer && hasDeal && !!deal
  const collateralCandidates = holdings
    .filter((holding) => holding.kind === 'collateral' && holding.asset === 'Tokenized T-Bill / MMF')
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
    setBusy(true)
    setError(null)
    try {
      await resetDemo()
      setActivity([])
      setDraft(DEFAULT_DRAFT)
      await refresh(role)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const selectRole = (nextRole: Role) => {
    if (nextRole === role || busy) return
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
          </div>

          <RoleTabs role={role} onSelect={selectRole} disabled={busy} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9aa1ad' }}>Viewing as</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end', marginTop: 2 }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: ROLE_DOT[role] }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: '#14171f' }}>{ROLE_LABELS[role]}</div>
              </div>
            </div>
            <button
              onClick={onReset}
              disabled={busy}
              style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#5b6472', fontSize: 12, fontWeight: 500, padding: '9px 14px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
            >
              Reset demo
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
                  No ledger configuration found. Start the sandbox or configure the DevNet deployment first:
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
                  onPublish={(price) => act(`Publish valuation ${price.toFixed(2)}`, PARTY_NAMES.valuer, () => publishValuation(price))}
                  busy={busy}
                />
              )}
              {showCreateForm && (
                <CreateOfferForm
                  draft={draft}
                  onChange={(field, value) => setDraft((d) => ({ ...d, [field]: value }) as Draft)}
                  onSubmit={() => act('Create offer', PARTY_NAMES.lender, () => createOffer(draft))}
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
                  availableTopUp={availableTopUp}
                  busy={busy}
                  actions={{
                    onWithdraw: () => act('Withdraw offer', PARTY_NAMES.lender, () => withdrawOffer(deal.contractId)),
                    onAccept: () => act('Accept offer', PARTY_NAMES.borrower, () => acceptOffer(deal.contractId)),
                    onRepay: () =>
                      act('Repay loan', PARTY_NAMES.borrower, () =>
                        repayLoan(deal.contractId, Number(deal.args.principal) + Number(deal.args.interest)),
                      ),
                    onLiquidate: () =>
                      act('Liquidate collateral', PARTY_NAMES.lender, () => {
                        if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh mark before liquidating.')
                        return liquidateLoan(deal.contractId, valuation.contractId)
                      }),
                    onLiquidateOverdue: () =>
                      act('Liquidate after maturity', PARTY_NAMES.lender, () => liquidateOverdueLoan(deal.contractId)),
                    onIssueMarginCall: () =>
                      act('Issue margin call', PARTY_NAMES.lender, () => {
                        if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh breached mark first.')
                        return issueMarginCall(deal.contractId, valuation.contractId)
                      }),
                    onTopUp: (quantity) =>
                      act(`Top up collateral · ${quantity} units`, PARTY_NAMES.borrower, () => {
                        if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh mark before topping up.')
                        return topUpCollateral(deal.contractId, quantity, valuation.contractId)
                      }),
                    onResolveMarginCall: () =>
                      act('Resolve margin call', PARTY_NAMES.borrower, () => {
                        if (!valuation) throw new Error('No ledger valuation is visible. Publish a fresh healthy mark first.')
                        return resolveMarginCall(deal.contractId, valuation.contractId)
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
        Viewing as {PARTY_NAMES[role]} · live Canton ledger · {contracts.length} visible contract{contracts.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}
