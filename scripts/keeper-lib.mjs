// Pure decision logic for the Veil lender keeper. No I/O: given the lender's
// active loans, the current valuation marks and a clock reading, return what
// the lender's desk would do. scripts/keeper.mjs performs the reads and writes.
//
// The rules mirror daml/Veil.daml so that a decided action is one the ledger
// will accept (modulo clock skew between this process and ledger time):
//   - a mark is usable only if observedAt <= now <= observedAt + 300s;
//   - breach = outstandingPrincipal / (collateralQuantity * unitPrice) * 100 >= threshold;
//   - outstandingPrincipal = principal - max(0, amountRepaid - interest);
//   - margin calls only before maturity; liquidation only once the call
//     deadline has passed on a fresh, still-breaching mark;
//   - overdue liquidation once now > maturity. A T-Bill Loan needs a fresh mark
//     (0.9.0 returns surplus collateral at that price); a CoinLoan needs none.

export const COIN_ASSET = 'Canton Coin'
export const FRESHNESS_MS = 300_000
export const COIN_SETTLEMENT_GRACE_MS = 86_400_000

export const DEFAULT_OPTIONS = {
  // Margin applied against the ledger's own clock so a decided action is not
  // rejected because this host's clock is slightly ahead or behind.
  skewMs: 5_000,
  // Warn when a CoinLoan's allocation settlement deadline is this close.
  settlementWarnHours: 6,
}

// ---------------------------------------------------------------- Decimal --
// Daml Decimal is Numeric 10; multiplication and division round half-even to
// scale 10. Mirror that with BigInt so threshold boundaries match the ledger.

const SCALE_DIGITS = 10
const SCALE = 10n ** BigInt(SCALE_DIGITS)

export function parseDecimal(value) {
  const text = String(value).trim()
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text)
  if (!match) throw new Error(`invalid decimal ${JSON.stringify(value)}`)
  const [, sign, whole, frac = ''] = match
  if (frac.length > SCALE_DIGITS) throw new Error(`decimal ${text} exceeds ${SCALE_DIGITS} fractional digits`)
  const scaled = BigInt(whole) * SCALE + BigInt((frac + '0'.repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS))
  return sign ? -scaled : scaled
}

export function formatDecimal(scaled, digits = 4) {
  const negative = scaled < 0n
  const abs = negative ? -scaled : scaled
  const unit = 10n ** BigInt(SCALE_DIGITS - digits)
  const rounded = roundDiv(abs, unit)
  const base = 10n ** BigInt(digits)
  const text = `${rounded / base}.${String(rounded % base).padStart(digits, '0')}`
  return negative ? `-${text}` : text
}

function roundDiv(numerator, denominator) {
  if (denominator === 0n) throw new Error('division by zero')
  if (denominator < 0n) return roundDiv(-numerator, -denominator)
  const negative = numerator < 0n
  const n = negative ? -numerator : numerator
  let q = n / denominator
  const r2 = (n % denominator) * 2n
  if (r2 > denominator || (r2 === denominator && q % 2n === 1n)) q += 1n
  return negative ? -q : q
}

const mulDec = (a, b) => roundDiv(a * b, SCALE)
const divDec = (a, b) => roundDiv(a * SCALE, b)
const HUNDRED = 100n * SCALE

export function outstandingPrincipal(principal, interest, amountRepaid) {
  const repaid = amountRepaid === null || amountRepaid === undefined ? 0n : parseDecimal(amountRepaid)
  const overInterest = repaid - parseDecimal(interest)
  return parseDecimal(principal) - (overInterest > 0n ? overInterest : 0n)
}

/** LTV in percent (scaled Decimal), computed exactly as the Daml choices do. */
export function loanLtv(args, unitPrice) {
  const outstanding = outstandingPrincipal(args.principal, args.interest, args.amountRepaid)
  const collateralValue = mulDec(parseDecimal(args.collateralQuantity), parseDecimal(unitPrice))
  return mulDec(divDec(outstanding, collateralValue), HUNDRED)
}

// ------------------------------------------------------------------ Time --

function timeMs(value, field) {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) throw new Error(`invalid ${field} ${JSON.stringify(value)}`)
  return ms
}

const collateralAssetOf = (loan) => (loan.template === 'CoinLoan' ? COIN_ASSET : loan.args.collateralAsset)

/** Marks that the ledger's checkedPrice would accept for this loan. */
export function marksForLoan(loan, marks) {
  const a = loan.args
  return marks.filter((m) =>
    m.args.streamId === a.valuationStreamId
      && m.args.valuationAgent === a.valuationAgent
      && m.args.lender === a.lender
      && m.args.borrower === a.borrower
      && m.args.regulator === a.regulator
      && m.args.collateralAsset === collateralAssetOf(loan))
}

const CHOICES = {
  Loan: { issueMarginCall: 'IssueMarginCall', liquidate: 'Liquidate', liquidateOverdue: 'LiquidateOverdue' },
  CoinLoan: { issueMarginCall: 'IssueCoinMarginCall', liquidate: 'LiquidateCoin', liquidateOverdue: 'LiquidateCoinOverdue' },
}

/** Kinds that change ledger state; every other kind is informational. */
export const EXECUTABLE = new Set(['issueMarginCall', 'liquidate', 'liquidateOverdue'])

/**
 * Decide what the lender should do for each loan.
 *
 * @param loans  [{ contractId, template: 'Loan' | 'CoinLoan', args }] as read from the ACS
 * @param marks  [{ contractId, args }] active CollateralValuation contracts
 * @param now    Date or epoch ms (the keeper's estimate of ledger time)
 * @returns one or more actions per loan: executable kinds (issueMarginCall,
 *   liquidate, liquidateOverdue) plus informational ones (hold,
 *   needsFreshPrice, warnSettlementDeadline, invalid).
 */
export function decide(loans, marks, now, options = {}) {
  const { skewMs, settlementWarnHours } = { ...DEFAULT_OPTIONS, ...options }
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const actions = []
  for (const loan of loans) {
    try {
      actions.push(...decideLoan(loan, marks, nowMs, skewMs, settlementWarnHours))
    } catch (error) {
      actions.push({ ...base(loan), kind: 'invalid', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return actions
}

function base(loan) {
  return { template: loan.template, loanCid: loan.contractId }
}

/** The loan's single current mark if it is fresh, else a needsFreshPrice action. */
function freshMark(loan, marks, nowMs, skewMs) {
  const candidates = marksForLoan(loan, marks)
  if (candidates.length !== 1) {
    return {
      needs: {
        ...base(loan),
        kind: 'needsFreshPrice',
        reason: candidates.length === 0
          ? 'no current mark on the loan\'s valuation stream'
          : `ambiguous: ${candidates.length} current marks on the loan's valuation stream`,
      },
    }
  }
  const mark = candidates[0]
  const observedMs = timeMs(mark.args.observedAt, 'observedAt')
  if (observedMs > nowMs || nowMs + skewMs > observedMs + FRESHNESS_MS) {
    return {
      needs: {
        ...base(loan),
        kind: 'needsFreshPrice',
        valuationCid: mark.contractId,
        observedAt: mark.args.observedAt,
        reason: observedMs > nowMs ? 'mark is ahead of this host\'s clock' : 'mark is older than 300s; ask the valuer to publish',
      },
    }
  }
  return { mark }
}

function decideLoan(loan, marks, nowMs, skewMs, settlementWarnHours) {
  const a = loan.args
  const choices = CHOICES[loan.template]
  if (!choices) throw new Error(`unsupported template ${loan.template}`)
  const out = []
  const maturityMs = timeMs(a.maturity, 'maturity')

  if (loan.template === 'CoinLoan') {
    const settlementDeadlineMs = maturityMs + COIN_SETTLEMENT_GRACE_MS
    const hoursLeft = (settlementDeadlineMs - nowMs) / 3_600_000
    if (hoursLeft <= settlementWarnHours) {
      out.push({
        ...base(loan),
        kind: 'warnSettlementDeadline',
        settlementDeadline: new Date(settlementDeadlineMs).toISOString(),
        hoursLeft: Math.round(hoursLeft * 100) / 100,
        reason: hoursLeft <= 0
          ? 'allocation settlement deadline has passed: the borrower can now withdraw the locked Canton Coin'
          : `allocation settlement deadline in ${hoursLeft.toFixed(2)}h: after it the borrower can withdraw the locked Canton Coin`,
      })
    }
  }

  if (nowMs > maturityMs + skewMs) {
    if (loan.template === 'CoinLoan') {
      // The Canton Coin allocation settles its fixed leg; no price is involved.
      out.push({ ...base(loan), kind: 'liquidateOverdue', choice: choices.liquidateOverdue, reason: `past maturity ${a.maturity}` })
      return out
    }
    // A T-Bill Loan returns surplus collateral at the attested price, so the
    // ledger requires a fresh mark for overdue liquidation too.
    const fresh = freshMark(loan, marks, nowMs, skewMs)
    if (fresh.needs) {
      out.push({ ...fresh.needs, reason: `past maturity ${a.maturity}; ${fresh.needs.reason}` })
      return out
    }
    out.push({ ...base(loan), kind: 'liquidateOverdue', choice: choices.liquidateOverdue, valuationCid: fresh.mark.contractId, reason: `past maturity ${a.maturity}` })
    return out
  }

  const call = a.marginCall ?? null
  const hold = (reason, extra = {}) => out.push({ ...base(loan), kind: 'hold', reason, ...extra })

  if (call === null && nowMs + skewMs >= maturityMs) {
    hold(`at maturity ${a.maturity}: margin calls are closed; overdue liquidation opens after maturity`)
    return out
  }
  if (call !== null) {
    const deadlineMs = timeMs(call.deadline, 'marginCall.deadline')
    if (nowMs < deadlineMs + skewMs) {
      hold(`margin call open until ${call.deadline}`, { deadline: call.deadline })
      return out
    }
  }

  const fresh = freshMark(loan, marks, nowMs, skewMs)
  if (fresh.needs) {
    out.push(fresh.needs)
    return out
  }
  const mark = fresh.mark

  const ltv = loanLtv(a, mark.args.unitPrice)
  const threshold = parseDecimal(a.liquidationThresholdLtv)
  const breached = ltv >= threshold
  const metrics = {
    ltv: formatDecimal(ltv),
    thresholdLtv: formatDecimal(threshold),
    outstandingPrincipal: formatDecimal(outstandingPrincipal(a.principal, a.interest, a.amountRepaid)),
    unitPrice: String(mark.args.unitPrice),
    valuationCid: mark.contractId,
  }

  if (call === null) {
    if (breached) out.push({ ...base(loan), kind: 'issueMarginCall', choice: choices.issueMarginCall, ...metrics, reason: 'LTV at or above threshold' })
    else hold('healthy', metrics)
  } else if (breached) {
    out.push({ ...base(loan), kind: 'liquidate', choice: choices.liquidate, ...metrics, reason: `margin call expired ${call.deadline} and LTV still breached` })
  } else {
    hold('margin call expired but LTV recovered; the borrower can resolve it', metrics)
  }
  return out
}
