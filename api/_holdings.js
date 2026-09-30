// Shared demo wallets top themselves up. Every visitor trades from the same
// lender and borrower holdings, and a janitored T-Bill loan never returns the
// lender's cash, so the wallets drain. After a desk create/repair the server
// reads them and, for each drained wallet, creates ONE holding that brings it
// back to its seed amount, all in one transaction signed by issuer and owner.
// Canton Coin is a real token and is never minted here.
//
// Concurrency: two tasks that read the same drained wallet both top it up, so
// a wallet can overshoot its seed by at most one top-up per concurrent task;
// a single top-up never exceeds the seed amount.

/** Mirrors SEED in frontend/src/ledger.ts (T-Bill is collateral + reserve). */
const WALLETS = Object.freeze([
  { key: 'lenderCash', owner: 'lender', template: 'CashHolding', seed: '10000' },
  { key: 'borrowerCash', owner: 'borrower', template: 'CashHolding', seed: '10500' },
  { key: 'borrowerTBill', owner: 'borrower', template: 'CollateralHolding', asset: 'Tokenized T-Bill', seed: '20000' },
  { key: 'borrowerMMF', owner: 'borrower', template: 'CollateralHolding', asset: 'Tokenized MMF', seed: '16000' },
])
/** A wallet below this share of its seed is topped up. */
const LOW_WATER_PERCENT = 25n

// Daml Decimal has 10 fractional digits; sum exactly in scaled integers.
const SCALE = 10
const UNIT = 10n ** BigInt(SCALE)

function toUnits(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,10}))?$/.exec(String(value ?? '').trim())
  if (!match) return null
  const units = BigInt(match[2]) * UNIT + BigInt((match[3] ?? '').padEnd(SCALE, '0'))
  return match[1] ? -units : units
}

function fromUnits(units) {
  const whole = units / UNIT
  const fraction = (units % UNIT).toString().padStart(SCALE, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

/** Current total per wallet from the owners' active Veil contracts. */
function walletTotals(contracts, config) {
  const totals = Object.fromEntries(WALLETS.map((w) => [w.key, 0n]))
  for (const c of contracts) {
    if (c.args.issuer !== config.issuer) continue
    for (const w of WALLETS) {
      if (c.template !== w.template || c.args.owner !== config.parties[w.owner]) continue
      if (w.asset !== undefined && c.args.asset !== w.asset) continue
      const units = toUnits(w.template === 'CashHolding' ? c.args.amount : c.args.quantity)
      if (units !== null && units > 0n) totals[w.key] += units
    }
  }
  return totals
}

/** The holdings to create: one per wallet below the low-water mark, each
 * bringing it back to (never beyond) its seed amount. */
function topUpPlan(totals) {
  const plan = []
  for (const w of WALLETS) {
    const seed = toUnits(w.seed)
    const total = totals[w.key] ?? 0n
    if (total * 100n >= seed * LOW_WATER_PERCENT) continue
    const amount = seed - (total > 0n ? total : 0n)
    plan.push({ wallet: w, before: total, amount })
  }
  return plan
}

/** Read the lender's and borrower's wallets and top up the drained ones in one
 * submission. Returns the number of holdings created. Throws on ledger errors;
 * the caller logs them. */
async function topUpHoldings(ledger, config, ctx) {
  const { issuer, parties } = config
  // Contracts are deduplicated by id: a holding is seen by issuer and owner only,
  // so the two reads never overlap today, but stay safe if that changes.
  const seen = new Map()
  for (const party of [parties.lender, parties.borrower]) {
    for (const c of await ledger.active(party)) seen.set(c.contractId, c)
  }
  const plan = topUpPlan(walletTotals([...seen.values()], config))
  if (plan.length === 0) return 0
  const commands = plan.map(({ wallet, amount }) => ledger.create(wallet.template, wallet.template === 'CashHolding'
    ? { issuer, owner: parties[wallet.owner], amount: fromUnits(amount) }
    : { issuer, owner: parties[wallet.owner], asset: wallet.asset, quantity: fromUnits(amount) }))
  const actAs = [issuer, ...new Set(plan.map(({ wallet }) => parties[wallet.owner]))]
  await ledger.submit(actAs, commands, 'topup')
  for (const { wallet, before, amount } of plan) {
    console.log(JSON.stringify({ level: 'info', msg: 'desk holdings top-up', requestId: ctx.id, wallet: wallet.key, before: fromUnits(before), amount: fromUnits(amount), seed: wallet.seed }))
  }
  return plan.length
}

module.exports = { LOW_WATER_PERCENT, WALLETS, fromUnits, toUnits, topUpHoldings, topUpPlan, walletTotals }
