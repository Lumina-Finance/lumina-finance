/**
 * Selected-transaction fixtures shared by the bulk edit selection and summary tests, so both cover
 * the same rows rather than each drifting its own copies
 */
import type { Category } from '@/api/categories'
import type { BulkEditChoice, SelectedTransactionFacts } from '@/pages/transactions/components/bulk-edit/selection'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'

export const writableAccounts: TransactionListAccount[] = [
  { id: 'chequing', name: 'Chequing', currency: 'CAD', can_write: true },
  { id: 'savings', name: 'Savings', currency: 'CAD', can_write: true },
  { id: 'cash', name: 'Cash', currency: 'CAD', can_write: true },
  { id: 'us_savings', name: 'US Savings', currency: 'USD', can_write: true },
  { id: 'eur_account', name: 'Euro account', currency: 'EUR', can_write: true },
]

export const transferCategory = {
  id: 'cat_t', name: 'Transfer', kind: 'transfer', icon: null,
  is_system: true, owner_id: null, group_id: null,
} as Category

export const groceriesCategory = {
  id: 'cat_g', name: 'Groceries', kind: 'expense', icon: null,
  is_system: true, owner_id: null, group_id: null,
} as Category

export const groceries: SelectedTransactionFacts = {
  id: 'a', accountId: 'chequing', hasMerchant: true,
  recordsFarSide: false, hasFarSideRecorded: false, farSideAccountId: null, currency: 'CAD', direction: 'debit',
  isZeroAmount: false,
}
export const oldImport: SelectedTransactionFacts = {
  id: 'b', accountId: 'chequing', hasMerchant: false,
  recordsFarSide: false, hasFarSideRecorded: false, farSideAccountId: null, currency: 'CAD', direction: 'debit',
  isZeroAmount: false,
}
export const toSavings: SelectedTransactionFacts = {
  id: 'c', accountId: 'chequing', hasMerchant: true,
  recordsFarSide: true, hasFarSideRecorded: true, farSideAccountId: 'savings', currency: 'CAD', direction: 'debit',
  isZeroAmount: false,
}
export const toOutside: SelectedTransactionFacts = {
  id: 'd', accountId: 'chequing', hasMerchant: true,
  recordsFarSide: true, hasFarSideRecorded: true, farSideAccountId: null, currency: 'CAD', direction: 'debit',
  isZeroAmount: false,
}
export const unanswered: SelectedTransactionFacts = {
  id: 'e', accountId: 'chequing', hasMerchant: true,
  recordsFarSide: true, hasFarSideRecorded: false, farSideAccountId: null, currency: 'CAD', direction: 'debit',
  isZeroAmount: false,
}

// The two halves a transfer pair makes: the money-out half sitting in Chequing and recording
// Savings, and the money-in half sitting in Savings and recording Chequing back
export const chequingHalf: SelectedTransactionFacts = {
  id: 'chequing_half', accountId: 'chequing', hasMerchant: true,
  recordsFarSide: true, hasFarSideRecorded: true, farSideAccountId: 'savings', currency: 'CAD', direction: 'debit',
  isZeroAmount: false,
}
export const savingsHalf: SelectedTransactionFacts = {
  id: 'savings_half', accountId: 'savings', hasMerchant: true,
  recordsFarSide: true, hasFarSideRecorded: true, farSideAccountId: 'chequing', currency: 'CAD', direction: 'credit',
  isZeroAmount: false,
}
export const pair = [chequingHalf, savingsHalf]

// A second money-out transfer in Chequing recording Savings, alongside chequingHalf, for the
// direction-implying cases, which need more than one row already sitting in the same account
export const chequingHalf2: SelectedTransactionFacts = { ...chequingHalf, id: 'chequing_half_2' }

// A transfer recording outside in EUR, its far side already answered so the only blocker it can
// trip is the own-currency check. Sits alongside the Chequing half so a From set to a tracked USD
// account produces two distinct currency-mismatch warnings rather than the one pair either row
// would trip alone
export const eurExpense: SelectedTransactionFacts = {
  id: 'eur_expense', accountId: 'eur_account', hasMerchant: true,
  recordsFarSide: true, hasFarSideRecorded: true, farSideAccountId: null, currency: 'EUR', direction: 'debit',
  isZeroAmount: false,
}

// A transfer in USD recorded in Chequing, a CAD account, the way an exchange-rate transfer sits
// once it is imported. Its own end already answers to Chequing, so setting From back to Chequing
// moves nothing and should trip no currency blocker, unlike setting it to another CAD account
export const usdTransferInChequing: SelectedTransactionFacts = {
  id: 'usd_in_chequing', accountId: 'chequing', hasMerchant: true,
  recordsFarSide: true, hasFarSideRecorded: true, farSideAccountId: 'savings', currency: 'USD', direction: 'debit',
  isZeroAmount: false,
}

export const zeroTransfer: SelectedTransactionFacts = {
  ...chequingHalf,
  id: 'zero_transfer',
  direction: 'credit',
  isZeroAmount: true,
}

/** A panel with every control untouched, so each test states only the one it fills in */
export function untouched(overrides: Partial<BulkEditChoice> = {}): BulkEditChoice {
  return {
    categoryId: '',
    merchantId: '',
    tagIds: [],
    accountId: '',
    date: '',
    note: '',
    clearsNote: false,
    transferFrom: null,
    transferTo: null,
    direction: null,
    directionIsImplied: false,
    endsAreOffered: false,
    ...overrides,
  }
}
