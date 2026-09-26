import { useEffect, useState } from 'react'
import type { Draft, Valuation } from '../types'
import { PARTY_NAMES, UNIT_CASH, assessValuation, fmtAmount, fmtPct, fmtTimestamp, ltvBand } from '../state'
import { Button, DateInput, Field, Label, Meter, Metric, MetricRow, NumberInput, Panel, Section, Tag } from '../ui/primitives'

/** Order-ticket style form for originating a facility. The economics are
 * priced live against the current ledger-attested mark, and submission is only
 * enabled when that mark is fresh and the opening LTV sits below the threshold —
 * the same preconditions the Daml choice enforces. */
export function OfferTicket({
  draft,
  valuations,
  availableCash,
  onChange,
  onSubmit,
  busy,
}: {
  draft: Draft
  valuations: Valuation[]
  availableCash: number
  onChange: (field: keyof Draft, value: number | string) => void
  onSubmit: () => void
  busy: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const liquidationThresholdLtv = draft.thresholdLtv
  const repayment = draft.principal + draft.interest
  const coupon = draft.principal > 0 ? (draft.interest / draft.principal) * 100 : 0
  const maturityMs = parseMaturity(draft.maturity)
  const termMessage = !Number.isFinite(draft.principal) || draft.principal <= 0
    ? 'Principal must be greater than zero.'
    : draft.principal > availableCash
      ? `Principal exceeds the ${fmtAmount(availableCash)} ${UNIT_CASH} available to fund the offer.`
    : !Number.isFinite(draft.thresholdLtv) || draft.thresholdLtv <= 0 || draft.thresholdLtv > 100
      ? 'Liquidation threshold must be above 0% and at most 100%.'
    : !Number.isInteger(draft.marginCallWindowSeconds) || draft.marginCallWindowSeconds < 60 || draft.marginCallWindowSeconds > 86400
      ? 'Margin-call window must be a whole number of seconds from 60 to 86,400.'
    : !Number.isFinite(draft.interest) || draft.interest < 0
      ? 'Interest cannot be negative.'
      : !Number.isFinite(draft.collateral) || draft.collateral <= 0
        ? 'Collateral quantity must be greater than zero.'
        : !Number.isFinite(maturityMs) || now >= maturityMs
          ? 'Maturity must be a future UTC start-of-day timestamp.'
          : undefined

  const assessment = assessValuation(valuations, draft.principal, draft.collateral, liquidationThresholdLtv, now)
  const markPrice = assessment.mark?.unitPrice
  const collateralValue = markPrice !== undefined ? draft.collateral * markPrice : undefined
  const ltv = collateralValue !== undefined && collateralValue > 0 ? (draft.principal / collateralValue) * 100 : undefined
  const band = ltv !== undefined && Number.isFinite(ltv) ? ltvBand(ltv, liquidationThresholdLtv) : undefined
  const markOk = assessment.status === 'healthy'
  const canSubmit = !busy && !termMessage && markOk

  return (
    <Panel
      title="Originate facility"
      kicker={`counterparty · ${PARTY_NAMES.borrower}`}
      flush
      actions={band ? <Tag tone={band.tone}>{band.label}</Tag> : <Tag>No mark</Tag>}
    >
      <div style={{ padding: 'var(--space-5)' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          <Field label="Principal · simulated USDC" hint={`${fmtAmount(availableCash)} available`}>
            <NumberInput value={draft.principal} onChange={(v) => onChange('principal', v)} />
          </Field>
          <Field label="Interest · simulated USDC" hint={`${fmtPct(coupon)} coupon`}>
            <NumberInput value={draft.interest} onChange={(v) => onChange('interest', v)} />
          </Field>
          <Field label="Collateral · units" hint="Simulated tokenised T-Bill">
            <NumberInput value={draft.collateral} onChange={(v) => onChange('collateral', v)} />
          </Field>
          <Field label="Liquidation threshold · LTV %" hint="Margin calls and liquidation start at this LTV.">
            <NumberInput value={draft.thresholdLtv} onChange={(v) => onChange('thresholdLtv', v)} />
          </Field>
          <Field label="Margin-call window · seconds" hint="Time the borrower has to cure a call (60–86,400).">
            <NumberInput value={draft.marginCallWindowSeconds} onChange={(v) => onChange('marginCallWindowSeconds', v)} />
          </Field>
          <Field label="Maturity · UTC start of day" hint="Acceptance and collateral cures must complete before this.">
            <DateInput value={draft.maturity} onChange={(v) => onChange('maturity', v)} />
          </Field>
        </div>
      </div>

      <MetricRow cols={3}>
        <Metric
          label="Repayment at maturity"
          value={Number.isFinite(repayment) ? fmtAmount(repayment) : '—'}
          unit={UNIT_CASH}
          size="lg"
        />
        <Metric
          label="Collateral value @ mark"
          value={collateralValue !== undefined && Number.isFinite(collateralValue) ? fmtAmount(collateralValue) : '—'}
          unit={collateralValue !== undefined ? UNIT_CASH : undefined}
          size="lg"
        />
        <div>
          <Metric
            label="Opening LTV @ mark"
            value={ltv !== undefined && Number.isFinite(ltv) ? fmtPct(ltv) : '—'}
            size="lg"
            tone={band?.tone}
          />
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Meter value={ltv ?? 0} max={120} tone={band?.tone ?? 'ok'} threshold={liquidationThresholdLtv} />
          </div>
        </div>
      </MetricRow>

      <Section
        label="Ledger-attested mark"
        actions={<Tag tone={markOk ? 'ok' : 'danger'} dot>{markOk ? 'Fresh' : assessment.status.replace('-', ' ')}</Tag>}
      >
        {assessment.mark ? (
          <div className="v-row" style={{ gap: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <Metric label="" value={assessment.mark.unitPrice.toFixed(2)} unit={`${UNIT_CASH} / unit`} />
            <Label>observed {fmtTimestamp(assessment.mark.observedAt)}</Label>
          </div>
        ) : null}
        <p
          className="v-metric__note"
          style={{ marginTop: assessment.mark ? 'var(--space-2)' : 0, color: markOk ? undefined : 'var(--danger)' }}
        >
          {assessment.message}
        </p>
      </Section>

      <footer className="v-panel__foot">
        <span className="v-metric__note" style={{ color: termMessage ? 'var(--danger)' : undefined }}>
          {termMessage
            ?? (markOk
              ? 'Submitting reserves the principal in issuer-signed escrow — visible only to the stakeholders.'
              : 'A fresh, healthy mark from the valuer is required before an offer can be created.')}
        </span>
        <Button variant="primary" onClick={onSubmit} busy={busy} disabled={!canSubmit} size="lg">
          Create offer
        </Button>
      </footer>
    </Panel>
  )
}

function parseMaturity(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN
  return Date.parse(`${value}T00:00:00.000Z`)
}
