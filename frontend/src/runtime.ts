import * as demo from './staticDemo'
import * as ledger from './ledger'
import type { ActiveState, Draft, Holding, Role, TxResult } from './types'

export type RuntimeMode = 'ledger' | 'static'

let mode: RuntimeMode = 'ledger'

export async function loadConfig(): Promise<boolean> {
  const requested = requestedMode()

  if (requested === 'static') {
    mode = 'static'
    demo.resetRuntime()
    return true
  }

  const ledgerReady = await ledger.loadConfig()
  if (ledgerReady) {
    mode = 'ledger'
    return true
  }

  if (!import.meta.env.DEV && requested !== 'ledger') {
    mode = 'static'
    demo.resetRuntime()
    return true
  }

  return false
}

export const getMode = (): RuntimeMode => mode

export const getParties = (): Record<Role, string> =>
  mode === 'static' ? demo.getParties() : ledger.getParties()

export const listActive = (role: Role): Promise<ActiveState> =>
  mode === 'static' ? demo.listActive(role) : ledger.listActive(ledger.getParties()[role])

export const parseHoldings = (contracts: ActiveState['contracts']): Holding[] =>
  mode === 'static' ? demo.parseHoldings(contracts) : ledger.parseHoldings(contracts)

export const createOffer = (draft: Draft): Promise<TxResult> =>
  mode === 'static' ? demo.createOffer(draft) : ledger.createOffer(draft)

export const acceptOffer = (offerCid: string): Promise<TxResult> =>
  mode === 'static' ? demo.acceptOffer(offerCid) : ledger.acceptOffer(offerCid)

export const withdrawOffer = (offerCid: string): Promise<TxResult> =>
  mode === 'static' ? demo.withdrawOffer(offerCid) : ledger.withdrawOffer(offerCid)

export const repayLoan = (loanCid: string, repayment: number): Promise<TxResult> =>
  mode === 'static' ? demo.repayLoan(loanCid, repayment) : ledger.repayLoan(loanCid, repayment)

export const liquidateLoan = (loanCid: string, currentCollateralValue: number): Promise<TxResult> =>
  mode === 'static' ? demo.liquidateLoan(loanCid, currentCollateralValue) : ledger.liquidateLoan(loanCid, currentCollateralValue)

export const resetDemo = (): Promise<void> =>
  mode === 'static' ? demo.resetDemo() : ledger.resetDemo()

function requestedMode(): RuntimeMode | undefined {
  const params = new URLSearchParams(window.location.search)
  const queryMode = params.get('mode')
  if (queryMode === 'static' || queryMode === 'ledger') return queryMode
  if (import.meta.env.VITE_DEMO_MODE === 'static' || import.meta.env.VITE_DEMO_MODE === 'ledger')
    return import.meta.env.VITE_DEMO_MODE
  return undefined
}
