import { useCallback, useEffect, useState } from 'react'
import type { ActivityEntry, Contract, Draft, Role, TxResult } from './types'
import {
  acceptOffer,
  createOffer,
  liquidateLoan,
  listActive,
  parties,
  repayLoan,
  resetDemo,
  withdrawOffer,
} from './ledger'
import {
  ACCENT,
  DEFAULT_DRAFT,
  PARTY_NAMES,
  ROLE_DOT,
  ROLE_LABELS,
  currentDeal,
  statusOf,
} from './state'
import { RoleTabs } from './components/RoleTabs'
import { CreateOfferForm } from './components/CreateOfferForm'
import { DealCard } from './components/DealCard'
import { ExplainerSidebar } from './components/ExplainerSidebar'
import { ActivityFeed } from './components/ActivityFeed'
import { RawInspector } from './components/RawInspector'
import { PartyBar } from './components/PartyBar'
import { ErrorBanner, OutsiderEmpty, ShockBanner, Waiting } from './components/EmptyStates'

export default function App() {
  const [role, setRole] = useState<Role>('lender')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [raw, setRaw] = useState<unknown[]>([])
  const [offset, setOffset] = useState(0)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [shock, setShock] = useState(false)
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (forRole: Role) => {
    setLoading(true)
    try {
      const state = await listActive(parties[forRole])
      setContracts(state.contracts)
      setRaw(state.raw)
      setOffset(state.offset)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(role)
  }, [role, refresh])

  // Run a ledger action, record the committed transaction in the activity feed.
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

  const isOutsider = role === 'outsider'
  const hasDeal = status !== 'none'
  const showCreateForm = !isOutsider && role === 'lender' && status === 'none'
  const showWaiting = !isOutsider && (role === 'borrower' || role === 'regulator') && status === 'none'
  const showDealCard = !isOutsider && hasDeal && !!deal
  const showShockBanner = !isOutsider && status === 'active' && shock

  const onReset = async () => {
    setBusy(true)
    setError(null)
    try {
      await resetDemo()
      setActivity([])
      setShock(false)
      setDraft(DEFAULT_DRAFT)
      await refresh(role)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
              Canton · Confidential
            </div>
          </div>

          <RoleTabs role={role} onSelect={setRole} />

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
        <PartyBar active={role} />
      </div>

      {/* BODY */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 32 }}>
        <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .18s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 358px', gap: 28, alignItems: 'start' }}>
            {/* LEFT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
              {showShockBanner && <ShockBanner />}
              {isOutsider && <OutsiderEmpty />}
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
                  shock={shock}
                  busy={busy}
                  actions={{
                    onWithdraw: () => act('Withdraw offer', PARTY_NAMES.lender, () => withdrawOffer(deal.contractId)),
                    onAccept: () => act('Accept offer', PARTY_NAMES.borrower, () => acceptOffer(deal.contractId)),
                    onRepay: () => act('Repay loan', PARTY_NAMES.borrower, () => repayLoan(deal.contractId)),
                    onLiquidate: () => act('Liquidate collateral', PARTY_NAMES.lender, () => liquidateLoan(deal.contractId)),
                    onSimulateShock: () => setShock(true),
                  }}
                />
              )}

              {!isOutsider && <ActivityFeed entries={activity} />}
              <RawInspector role={role} raw={raw} offset={offset} />
            </div>

            {/* RIGHT */}
            <ExplainerSidebar role={role} />
          </div>
        </div>
      </div>

      {/* a tiny footer note so judges know the privacy is real */}
      <div style={{ maxWidth: 1200, margin: '8px auto 0', padding: '0 32px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#bcc2cb' }}>
        Viewing as {PARTY_NAMES[role]} · live Canton sandbox · {contracts.length} visible contract{contracts.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}
