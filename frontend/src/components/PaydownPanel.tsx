import { useEffect, useState } from 'react'
import type { Contract, Valuation } from '../types'
import { UNIT_CASH, balanceOf, fmtAmount, marginCallOf, repaidOf } from '../state'
import { Button, Field, Panel } from '../ui/primitives'

/** Pay part of the balance in cash. Interest is settled first, then principal,
 * so LTV improves once the payment reaches principal. With a margin call open
 * the payment must cure it on a fresh mark; the ledger enforces both rules. */
export function PaydownPanel({
  loan,
  valuation,
  availableCash,
  busy,
  onPayDown,
}: {
  loan: Contract
  valuation?: Valuation
  availableCash: number
  busy: boolean
  onPayDown: (amount: number) => void
}) {
  const [amount, setAmount] = useState('30')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const principal = Number(loan.args.principal)
  const interest = Number(loan.args.interest)
  const collateral = Number(loan.args.collateralQuantity)
  const threshold = Number(loan.args.liquidationThresholdLtv)
  const repaid = repaidOf(loan)
  const { outstandingDue } = balanceOf(principal, interest, repaid)
  const payment = Number(amount)
  const after = balanceOf(principal, interest, repaid + (Number.isFinite(payment) ? payment : 0))
  const callOpen = Boolean(marginCallOf(loan))
  const maturityMs = Date.parse(loan.args.maturity ?? '')
  const markAgeMs = valuation ? now - Date.parse(valuation.observedAt) : Number.POSITIVE_INFINITY
  const markFresh = Boolean(valuation) && markAgeMs >= 0 && markAgeMs <= 5 * 60 * 1000
  const ltvAfter = valuation ? (after.outstandingPrincipal / (collateral * valuation.unitPrice)) * 100 : Number.NaN

  const blocker = !(Number.isFinite(maturityMs) && now < maturityMs)
    ? 'The loan has reached maturity; repay the full balance instead.'
    : !Number.isFinite(payment) || payment <= 0
      ? 'Enter a positive amount.'
      : payment >= outstandingDue
        ? `Pay less than the ${fmtAmount(outstandingDue)} outstanding, or use Repay to settle and release collateral.`
        : payment > availableCash
          ? `Only ${fmtAmount(availableCash)} ${UNIT_CASH} is available.`
          : callOpen && !markFresh
            ? 'A margin call is open: a fresh mark is needed to prove the payment cures it.'
            : callOpen && !(ltvAfter < threshold)
              ? `This leaves LTV at ${ltvAfter.toFixed(1)}%; pay more to get below ${threshold}%.`
              : null

  return (
    <Panel title="Pay down" kicker={`Outstanding · ${fmtAmount(outstandingDue)} ${UNIT_CASH}`}>
      <div style={{ padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
        <p style={{ color: 'var(--ink-500)', lineHeight: 'var(--leading-relaxed)' }}>
          Pay part of the balance in cash. It settles interest first, then principal.
          {callOpen ? ' With a margin call open, a payment that brings LTV back under the threshold cures it.' : ''}
        </p>
        <div className="v-row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="v-grow" style={{ minWidth: 200 }}>
            <Field label={`Amount · ${UNIT_CASH}`}>
              <input
                className="v-input"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <Button variant="primary" onClick={() => onPayDown(payment)} busy={busy} disabled={Boolean(blocker)}>
            Pay down
          </Button>
        </div>
        <p className="v-metric__note" style={{ color: blocker ? 'var(--danger)' : undefined }}>
          {blocker ?? `Leaves ${fmtAmount(after.outstandingDue)} ${UNIT_CASH} outstanding${Number.isFinite(ltvAfter) ? ` at ${ltvAfter.toFixed(1)}% LTV` : ''}.`}
        </p>
      </div>
    </Panel>
  )
}
