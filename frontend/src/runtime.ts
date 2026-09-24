import * as ledger from './ledger'
import { requireOperator, type AuthSnapshot } from './auth'
import type { ActiveState, Draft, Holding, Role, TxResult } from './types'

export async function loadConfig(): Promise<boolean> {
  return ledger.loadConfig()
}

export const getParties = (): Record<Role, string> => ledger.getParties()
export const getIssuer = (): string => ledger.getIssuer()
export const getConfigIssue = (): string | null => ledger.getConfigIssue()

export const LIQUIDATION_THRESHOLD_LTV = ledger.LIQUIDATION_THRESHOLD_LTV
export const COLLATERAL_ASSET = ledger.COLLATERAL_ASSET

export const listActive = (role: Role, snapshot?: AuthSnapshot): Promise<ActiveState> =>
  ledger.listActive(ledger.getParties()[role], snapshot)

export const parseHoldings = (contracts: ActiveState['contracts']): Holding[] =>
  ledger.parseHoldings(contracts)

export const createOffer = (draft: Draft, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.createOffer(draft, snapshot)

export const acceptOffer = (offerCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.acceptOffer(offerCid, snapshot)

export const withdrawOffer = (offerCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.withdrawOffer(offerCid, snapshot)

export const repayLoan = (loanCid: string, repayment: number, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.repayLoan(loanCid, repayment, snapshot)

export const publishValuation = (unitPrice: number, snapshot?: AuthSnapshot): Promise<TxResult> => ledger.publishValuation(unitPrice, snapshot)

export const issueMarginCall = (loanCid: string, valuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.issueMarginCall(loanCid, valuationCid, snapshot)

export const topUpCollateral = (loanCid: string, topUpQuantity: number, valuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.topUpCollateral(loanCid, topUpQuantity, valuationCid, snapshot)

export const resolveMarginCall = (loanCid: string, valuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.resolveMarginCall(loanCid, valuationCid, snapshot)

export const liquidateLoan = (loanCid: string, valuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.liquidateLoan(loanCid, valuationCid, snapshot)

export const liquidateOverdueLoan = (loanCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.liquidateOverdueLoan(loanCid, snapshot)

export const resetDemo = (snapshot?: AuthSnapshot): Promise<void> => {
  requireOperator(snapshot)
  return ledger.resetDemo(snapshot)
}

export const seedDemo = (snapshot?: AuthSnapshot): Promise<void> => {
  requireOperator(snapshot)
  return ledger.seedDemo(snapshot)
}
