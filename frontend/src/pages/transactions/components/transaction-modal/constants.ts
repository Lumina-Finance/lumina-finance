import type {
  TransactionDirection,
  TransactionFormValues,
  TransactionModalKind,
} from '@/pages/transactions/components/transaction-modal/types'

export const EASE = [0.25, 0.1, 0.25, 1] as const
export const SELECTOR_SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 } as const
export const DEFAULT_CATEGORY_ICON = '🏷️'
export const MIN_ADD_TRANSACTION_LOADING_MS = 800
export const MIN_BATCH_ADD_TRANSACTION_LOADING_MS = 300
export const MIN_DELETE_TRANSACTION_LOADING_MS = 800
export const MERCHANT_DROPDOWN_PAGE_SIZE = 10
export const MERCHANT_SEARCH_LOADING_TEXT_MIN_MS = 300
export const MERCHANT_SEARCH_DEBOUNCE_MS = 300
export const MERCHANT_FETCHING_MORE_TEXT_MIN_MS = 800
export const TAG_DROPDOWN_PAGE_SIZE = 10
export const TAG_SEARCH_LOADING_TEXT_MIN_MS = 300
export const TAG_SEARCH_DEBOUNCE_MS = 300
export const TAG_FETCHING_MORE_TEXT_MIN_MS = 800
export const SEGMENTED_OPTION_GAP_REM = 0.35

export const TRANSACTION_MODAL_FIELD_IDS = {
  account: 'txn-account',
  merchant: 'txn-merchant',
  category: 'txn-category',
} as const

export const KIND_OPTIONS: { value: TransactionModalKind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

export const DIRECTION_OPTIONS: { value: TransactionDirection; label: string }[] = [
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Credit' },
]

export const KIND_LABELS: Record<TransactionModalKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

export const DEFAULT_DIRECTION_BY_KIND: Record<TransactionModalKind, TransactionDirection> = {
  expense: 'debit',
  income: 'credit',
  transfer: 'debit',
}

export const INITIAL_TRANSACTION_FORM: TransactionFormValues = {
  kind: 'expense',
  direction: DEFAULT_DIRECTION_BY_KIND.expense,
  account_id: '',
  category_id: '',
  merchant_id: '',
  amount: '',
  currency: '',
  notes: '',
  date: '',
  tag_ids: [],
}
