import * as ledger from './ledger'
import { requireOperator, type AuthSnapshot } from './auth'
import type { ActiveState, Contract, Draft, Holding, Role, TxResult } from './types'

export async function loadConfig(): Promise<boolean> {
  return ledger.loadConfig()
}

export const getParties = (): Record<Role, string> => ledger.getParties()
export const getIssuer = (): string => ledger.getIssuer()
export const getConfigIssue = (): string | null => ledger.getConfigIssue()

export const COLLATERAL_ASSET = ledger.COLLATERAL_ASSET
export const COLLATERAL_ASSETS = ledger.COLLATERAL_ASSETS
export const COIN_ASSET = ledger.COIN_ASSET
export const VALUED_ASSETS = ledger.VALUED_ASSETS

export const coinAdmin = (snapshot?: AuthSnapshot): Promise<string | null> => ledger.coinAdmin(snapshot)

export const listActive = (role: Role, snapshot?: AuthSnapshot): Promise<ActiveState> =>
  ledger.listActive(ledger.getParties()[role], snapshot)

export const parseHoldings = (contracts: ActiveState['contracts']): Holding[] =>
  ledger.parseHoldings(contracts)

export const createOffer = (draft: Draft, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.createOffer(draft, snapshot)

export const acceptOffer = (offerCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.acceptOffer(offerCid, snapshot)

export const withdrawOffer = (offer: Contract, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.withdrawOffer(offer, snapshot)

export const rejectOffer = (offer: Contract, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.rejectOffer(offer, snapshot)

export const repayLoan = (loan: Contract, repayment: number, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.repayLoan(loan, repayment, snapshot)

export const publishValuation = (unitPrice: number, asset: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.publishValuation(unitPrice, asset, snapshot)

export const partialRepay = (loan: Contract, amount: number, valuationCid: string | null, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.partialRepay(loan, amount, valuationCid, snapshot)

export const issueMarginCall = (loan: Contract, valuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.issueMarginCall(loan, valuationCid, snapshot)

export const topUpCollateral = (loanCid: string, asset: string, topUpQuantity: number, valuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.topUpCollateral(loanCid, asset, topUpQuantity, valuationCid, snapshot)

export const proposeSubstitution = (loan: Contract, asset: string, quantity: number, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.proposeSubstitution(loan, asset, quantity, snapshot)

export const applySubstitution = (loanCid: string, requestCid: string, newValuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.applySubstitution(loanCid, requestCid, newValuationCid, snapshot)

export const rejectSubstitution = (requestCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.rejectSubstitution(requestCid, snapshot)

export const cancelSubstitution = (requestCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.cancelSubstitution(requestCid, snapshot)

export const resolveMarginCall = (loan: Contract, valuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.resolveMarginCall(loan, valuationCid, snapshot)

export const liquidateLoan = (loan: Contract, valuationCid: string, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.liquidateLoan(loan, valuationCid, snapshot)

export const liquidateOverdueLoan = (loan: Contract, snapshot?: AuthSnapshot): Promise<TxResult> =>
  ledger.liquidateOverdueLoan(loan, snapshot)

export const resetDemo = (snapshot?: AuthSnapshot): Promise<void> => {
  requireOperator(snapshot)
  return ledger.resetDemo(snapshot)
}

export const seedDemo = (snapshot?: AuthSnapshot): Promise<void> => {
  requireOperator(snapshot)
  return ledger.seedDemo(snapshot)
}
