import * as ledger from './ledger'
import type { ActiveState, Draft, Holding, Role, TxResult } from './types'

export async function loadConfig(): Promise<boolean> {
  return ledger.loadConfig()
}

export const getParties = (): Record<Role, string> => ledger.getParties()

export const listActive = (role: Role): Promise<ActiveState> =>
  ledger.listActive(ledger.getParties()[role])

export const parseHoldings = (contracts: ActiveState['contracts']): Holding[] =>
  ledger.parseHoldings(contracts)

export const createOffer = (draft: Draft): Promise<TxResult> =>
  ledger.createOffer(draft)

export const acceptOffer = (offerCid: string): Promise<TxResult> =>
  ledger.acceptOffer(offerCid)

export const withdrawOffer = (offerCid: string): Promise<TxResult> =>
  ledger.withdrawOffer(offerCid)

export const repayLoan = (loanCid: string, repayment: number): Promise<TxResult> =>
  ledger.repayLoan(loanCid, repayment)

export const publishValuation = (unitPrice: number): Promise<TxResult> => ledger.publishValuation(unitPrice)

export const issueMarginCall = (loanCid: string, valuationCid: string): Promise<TxResult> =>
  ledger.issueMarginCall(loanCid, valuationCid)

export const topUpCollateral = (loanCid: string, topUpQuantity: number, valuationCid: string): Promise<TxResult> =>
  ledger.topUpCollateral(loanCid, topUpQuantity, valuationCid)

export const resolveMarginCall = (loanCid: string, valuationCid: string): Promise<TxResult> =>
  ledger.resolveMarginCall(loanCid, valuationCid)

export const liquidateLoan = (loanCid: string, valuationCid: string): Promise<TxResult> =>
  ledger.liquidateLoan(loanCid, valuationCid)

export const resetDemo = (): Promise<void> => ledger.resetDemo()
