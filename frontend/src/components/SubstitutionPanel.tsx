import { useEffect, useState } from 'react'
import type { Contract, Holding, Role, Valuation } from '../types'
import { assessValuation, fmtAmount, marginCallOf } from '../state'
import { Banner, Button, Panel } from '../ui/primitives'

export interface SubstitutionActions {
  onPropose: (holdingCid: string) => void
  onApply: () => void
  onReject: () => void
  onCancel: () => void
}

/** Collateral substitution on an open loan. The borrower escrows a whole
 * holding of the other eligible asset; the lender approves it against a fresh
 * mark of that asset, and Canton swaps the collateral in one transaction. The
 * buttons mirror the ApplySubstitution guards; the ledger remains the judge. */
export function SubstitutionPanel({
  role,
  loan,
  request,
  replacement,
  replacementMarks,
  busy,
  actions,
}: {
  role: Role
  loan: Contract
  request?: Contract
  replacement?: Holding
  replacementMarks: Valuation[]
  busy: boolean
  actions: SubstitutionActions
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const principal = Number(loan.args.principal)
  const threshold = Number(loan.args.liquidationThresholdLtv)
  const lockedAsset = loan.args.collateralAsset ?? ''
  const lockedQuantity = Number(loan.args.collateralQuantity)
  const maturityMs = Date.parse(loan.args.maturity ?? '')
  const beforeMaturity = Number.isFinite(maturityMs) && now < maturityMs
  const callOpen = Boolean(marginCallOf(loan))

  if (!request) {
    if (role !== 'borrower' || !replacement?.asset) return null
    const blocked = callOpen ? 'Cure the open margin call first.' : !beforeMaturity ? 'The loan has reached maturity.' : null
    return (
      <Panel title="Substitute collateral" kicker={`Locked · ${fmtAmount(lockedQuantity, 0)} ${lockedAsset}`}>
        <div style={{ padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
          <p style={{ color: 'var(--ink-500)', lineHeight: 'var(--leading-relaxed)' }}>
            Offer {fmtAmount(replacement.amount, 0)} units of {replacement.asset} in place of the locked {lockedAsset}.
            The replacement is escrowed until the lender approves or rejects it, and the lender sees only the request,
            not your wallet.
          </p>
          {blocked && <p className="v-metric__note" style={{ color: 'var(--danger)' }}>{blocked}</p>}
          <div className="v-row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={() => actions.onPropose(replacement.contractId)} busy={busy} disabled={Boolean(blocked)}>
              Propose substitution
            </Button>
          </div>
        </div>
      </Panel>
    )
  }

  const newAsset = request.args.newAsset ?? ''
  const newQuantity = Number(request.args.newQuantity)
  const matchesLoan = request.args.releaseAsset === lockedAsset && Number(request.args.releaseQuantity) === lockedQuantity
  const assessment = assessValuation(replacementMarks, principal, newQuantity, threshold, now)
  const approveBlocker = !matchesLoan
    ? 'The locked collateral changed since this request; reject it.'
    : callOpen
      ? 'Cure the open margin call before substituting.'
      : !beforeMaturity
        ? 'The loan has reached maturity.'
        : assessment.status !== 'healthy'
          ? assessment.status === 'stale' || assessment.status === 'missing'
            ? `A fresh ${newAsset} mark is required: the valuer publishes one first.`
            : assessment.message
          : null

  return (
    <Panel title="Collateral substitution" kicker="Requested by the borrower">
      <div style={{ padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
        <Banner tone="info" title="Substitution requested.">
          Release {fmtAmount(Number(request.args.releaseQuantity), 0)} {request.args.releaseAsset} and lock{' '}
          {fmtAmount(newQuantity, 0)} {newAsset} in its place.{' '}
          {assessment.ltv !== undefined && Number.isFinite(assessment.ltv)
            ? `At the current ${newAsset} mark the loan would sit at ${assessment.ltv.toFixed(1)}% LTV.`
            : ''}
        </Banner>
        {role === 'lender' && approveBlocker && (
          <p className="v-metric__note" style={{ color: 'var(--danger)' }}>{approveBlocker}</p>
        )}
        <div className="v-row" style={{ justifyContent: 'flex-end', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {role === 'lender' && (
            <>
              <Button variant="danger-ghost" onClick={actions.onReject} busy={busy}>
                Reject substitution
              </Button>
              <Button variant="primary" onClick={actions.onApply} busy={busy} disabled={Boolean(approveBlocker)}>
                Approve substitution
              </Button>
            </>
          )}
          {role === 'borrower' && (
            <Button variant="danger-ghost" onClick={actions.onCancel} busy={busy}>
              Cancel request
            </Button>
          )}
        </div>
      </div>
    </Panel>
  )
}
