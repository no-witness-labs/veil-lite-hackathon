import { DEFAULT_DRAFT } from './state'
import type { ActiveState, Contract, DealArgs, Draft, Role, TemplateName, TxResult } from './types'

const parties: Record<Role, string> = {
  lender: 'Lender::static-demo-0001',
  borrower: 'Borrower::static-demo-0002',
  regulator: 'Regulator::static-demo-0003',
  outsider: 'Outsider::static-demo-0004',
}

type Stage = 'none' | 'offered' | 'active' | 'repaid' | 'liquidated'

interface DemoState {
  stage: Stage
  terms: Draft
  offset: number
  tx: number
}

let state: DemoState = initialState()

export const getParties = (): Record<Role, string> => parties

export function resetRuntime(): void {
  state = initialState()
}

export async function listActive(role: Role): Promise<ActiveState> {
  const contracts = visibleContracts(role)
  return {
    contracts,
    raw: contracts.map((contract) => rawEntry(contract)),
    offset: state.offset,
  }
}

export async function createOffer(draft: Draft): Promise<TxResult> {
  if (state.stage !== 'none') throw new Error('An offer already exists. Reset the demo before creating another offer.')
  state = { ...state, terms: draft, stage: 'offered', offset: state.offset + 1, tx: state.tx + 1 }
  return txResult('offer', state.offset, {
    created: [dealContract('LoanOffer')],
    archived: [holding('CashHolding', 'lender-cash-100', 1, { owner: parties.lender, amount: '100' })],
  })
}

export async function acceptOffer(_offerCid: string): Promise<TxResult> {
  if (state.stage !== 'offered') throw new Error('No open offer is available to accept.')
  const offer = dealContract('LoanOffer')
  state = { ...state, stage: 'active', offset: state.offset + 1, tx: state.tx + 1 }
  return txResult('accept', state.offset, {
    created: [
      dealContract('Loan'),
      holding('CashHolding', 'borrower-principal-100', state.offset, { owner: parties.borrower, amount: '100' }),
    ],
    archived: [
      offer,
      holding('CollateralHolding', 'borrower-collateral-150', 1, {
        owner: parties.borrower,
        asset: 'Tokenized T-Bill / MMF',
        quantity: '150',
      }),
    ],
  })
}

export async function withdrawOffer(_offerCid: string): Promise<TxResult> {
  if (state.stage !== 'offered') throw new Error('No open offer is available to withdraw.')
  const offer = dealContract('LoanOffer')
  state = { ...initialState(), offset: state.offset + 1, tx: state.tx + 1 }
  return txResult('withdraw', state.offset, {
    created: [holding('CashHolding', 'lender-cash-100', state.offset, { owner: parties.lender, amount: '100' })],
    archived: [offer],
  })
}

export async function repayLoan(_loanCid: string, _repayment: number): Promise<TxResult> {
  if (state.stage !== 'active') throw new Error('No active loan is available to repay.')
  const loan = dealContract('Loan')
  state = { ...state, stage: 'repaid', offset: state.offset + 1, tx: state.tx + 1 }
  return txResult('repay', state.offset, {
    created: [
      dealContract('LoanClosed'),
      holding('CashHolding', 'lender-repayment-105', state.offset, { owner: parties.lender, amount: '105' }),
      holding('CollateralHolding', 'borrower-collateral-150', state.offset, {
        owner: parties.borrower,
        asset: 'Tokenized T-Bill / MMF',
        quantity: '150',
      }),
    ],
    archived: [
      loan,
      holding('CashHolding', 'borrower-seed-105', 1, { owner: parties.borrower, amount: '105' }),
    ],
  })
}

export async function liquidateLoan(_loanCid: string, _currentCollateralValue: number): Promise<TxResult> {
  if (state.stage !== 'active') throw new Error('No active loan is available to liquidate.')
  const loan = dealContract('Loan')
  state = { ...state, stage: 'liquidated', offset: state.offset + 1, tx: state.tx + 1 }
  return txResult('liquidate', state.offset, {
    created: [
      dealContract('LoanClosed'),
      holding('CollateralHolding', 'lender-collateral-150', state.offset, {
        owner: parties.lender,
        asset: 'Tokenized T-Bill / MMF',
        quantity: '150',
      }),
    ],
    archived: [loan],
  })
}

export async function resetDemo(): Promise<void> {
  state = initialState()
}

export function parseHoldings(contracts: Contract[]) {
  const out = []
  for (const c of contracts) {
    if (c.template === 'CashHolding')
      out.push({ contractId: c.contractId, kind: 'cash' as const, amount: Number(c.args.amount) })
    else if (c.template === 'CollateralHolding')
      out.push({ contractId: c.contractId, kind: 'collateral' as const, amount: Number(c.args.quantity), asset: c.args.asset })
  }
  return out
}

function initialState(): DemoState {
  return { stage: 'none', terms: DEFAULT_DRAFT, offset: 1, tx: 0 }
}

function visibleContracts(role: Role): Contract[] {
  if (role === 'outsider') return []

  const contracts: Contract[] = []
  const deal = currentDeal()
  if (deal && (role === 'lender' || role === 'borrower' || role === 'regulator')) contracts.push(deal)

  if (role === 'lender') {
    if (state.stage === 'none' || state.stage === 'offered')
      contracts.push(holding('CashHolding', 'lender-cash-100', 1, { owner: parties.lender, amount: state.stage === 'none' ? '100' : '0' }))
    if (state.stage === 'repaid')
      contracts.push(holding('CashHolding', 'lender-repayment-105', state.offset, { owner: parties.lender, amount: '105' }))
    if (state.stage === 'liquidated')
      contracts.push(holding('CollateralHolding', 'lender-collateral-150', state.offset, {
        owner: parties.lender,
        asset: 'Tokenized T-Bill / MMF',
        quantity: '150',
      }))
  }

  if (role === 'borrower') {
    if (state.stage === 'none' || state.stage === 'offered') {
      contracts.push(holding('CashHolding', 'borrower-seed-105', 1, { owner: parties.borrower, amount: '105' }))
      contracts.push(holding('CollateralHolding', 'borrower-collateral-150', 1, {
        owner: parties.borrower,
        asset: 'Tokenized T-Bill / MMF',
        quantity: '150',
      }))
    }
    if (state.stage === 'active' || state.stage === 'liquidated') {
      contracts.push(holding('CashHolding', 'borrower-seed-105', 1, { owner: parties.borrower, amount: '105' }))
      contracts.push(holding('CashHolding', 'borrower-principal-100', state.offset, { owner: parties.borrower, amount: '100' }))
    }
    if (state.stage === 'repaid') {
      contracts.push(holding('CashHolding', 'borrower-principal-100', state.offset, { owner: parties.borrower, amount: '100' }))
      contracts.push(holding('CollateralHolding', 'borrower-collateral-150', state.offset, {
        owner: parties.borrower,
        asset: 'Tokenized T-Bill / MMF',
        quantity: '150',
      }))
    }
  }

  return contracts.filter((c) => c.template !== 'CashHolding' || c.args.amount !== '0')
}

function currentDeal(): Contract | undefined {
  if (state.stage === 'offered') return dealContract('LoanOffer')
  if (state.stage === 'active') return dealContract('Loan')
  if (state.stage === 'repaid' || state.stage === 'liquidated') return dealContract('LoanClosed')
  return undefined
}

function dealContract(template: Extract<TemplateName, 'LoanOffer' | 'Loan' | 'LoanClosed'>): Contract {
  const args: DealArgs = {
    lender: parties.lender,
    borrower: parties.borrower,
    regulator: parties.regulator,
    principal: String(state.terms.principal),
    interest: String(state.terms.interest),
    collateralAsset: 'Tokenized T-Bill / MMF',
    collateralQuantity: String(state.terms.collateral),
    maturity: state.terms.maturity,
  }
  if (template === 'Loan') args.collateralLocked = true
  if (template === 'LoanClosed') {
    args.reason = state.stage === 'liquidated' ? 'Liquidated' : 'Repaid'
    args.collateralReleased = state.stage === 'repaid'
  }
  return { template, contractId: cid(template), offset: state.offset, args }
}

function holding(template: Extract<TemplateName, 'CashHolding' | 'CollateralHolding'>, id: string, offset: number, args: DealArgs): Contract {
  return { template, contractId: `static-${id}`, offset, args }
}

function cid(template: TemplateName): string {
  return `static-${template.toLowerCase()}-${state.stage}-${state.offset}`
}

function rawEntry(contract: Contract) {
  return {
    contractEntry: {
      JsActiveContract: {
        createdEvent: {
          templateId: `#veil:Veil:${contract.template}`,
          contractId: contract.contractId,
          createArgument: contract.args,
          offset: contract.offset,
        },
      },
    },
  }
}

function txResult(prefix: string, offset: number, events: Pick<TxResult, 'created' | 'archived'>): TxResult {
  return {
    updateId: `static-${prefix}-${state.tx}`,
    offset,
    synchronizerId: 'static-demo',
    created: events.created.map((c) => ({ template: c.template, contractId: c.contractId })),
    archived: events.archived.map((c) => ({ template: c.template, contractId: c.contractId })),
  }
}
