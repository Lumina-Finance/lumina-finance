import type {
  TransactionDirection,
  TransactionFormFieldErrors,
  TransactionFormValues,
  TransactionModalKind,
} from '@/components/transactions/transaction-modal/types'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

export const EASE = [0.25, 0.1, 0.25, 1] as const
export const SELECTOR_SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 } as const

// The app's ease-out, shared by the modal's bank item motions
export const APP_EASE_OUT = [0.22, 1, 0.36, 1] as const

// For a line under a details field opening and closing: the message under the date row and the bank's
// value under the date or the amount
export const DETAILS_LINE_TRANSITION = { duration: 0.18, ease: APP_EASE_OUT } as const
export const DEFAULT_CATEGORY_ICON = '🏷️'
export const MIN_ADD_TRANSACTION_LOADING_MS = LOADING_ANIMATION_MIN_MS
export const MIN_BATCH_ADD_TRANSACTION_LOADING_MS = LOADING_ANIMATION_MIN_MS
export const MIN_DELETE_TRANSACTION_LOADING_MS = LOADING_ANIMATION_MIN_MS
export const MERCHANT_DROPDOWN_PAGE_SIZE = 10
export const MERCHANT_SEARCH_DEBOUNCE_MS = 300
export const TAG_DROPDOWN_PAGE_SIZE = 10
export const TAG_SEARCH_DEBOUNCE_MS = 300
export const SEGMENTED_OPTION_GAP_REM = 0.35

export const TRANSACTION_MODAL_FIELD_IDS = {
  account: 'txn-account',
  counterpartyAccount: 'txn-counterparty-account',
  merchant: 'txn-merchant',
  category: 'txn-category',
  tags: 'txn-tags',
  currency: 'txn-currency',
  date: 'txn-date',
  amount: 'txn-amount',
} as const

// The control that takes focus when a refused press lands on each validated field that stays in place.
// The two account fields trade places with the direction, so `getTransactionFieldLayout` places them
export const TRANSACTION_MODAL_FIXED_CONTROL_IDS: Omit<
  Record<keyof TransactionFormFieldErrors, string>,
  'account_id' | 'counterparty_account_id'
> = {
  merchant_id: TRANSACTION_MODAL_FIELD_IDS.merchant,
  category_id: TRANSACTION_MODAL_FIELD_IDS.category,
  currency: TRANSACTION_MODAL_FIELD_IDS.currency,
  date: TRANSACTION_MODAL_FIELD_IDS.date,
  amount: TRANSACTION_MODAL_FIELD_IDS.amount,
}

// The id of the message a failed save shows at the foot of the form. A bank item's form scrolls it into view
export const SUBMIT_ERROR_ID = 'txn-submit-error'

// The id of each validated field's message, which the field points to as its description
export const TRANSACTION_MODAL_ERROR_IDS: Record<keyof TransactionFormFieldErrors, string> = {
  account_id: 'txn-account-error',
  counterparty_account_id: 'txn-counterparty-account-error',
  merchant_id: 'txn-merchant-error',
  category_id: 'txn-category-error',
  currency: 'txn-currency-error',
  date: 'txn-date-error',
  amount: 'txn-amount-error',
}

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

// The most Notes takes for a bank item and for a transaction added from one, the server's limit for a
// note. Their notes start as the bank's whole description, so main's 500 would refuse any typing in a
// longer one without a word
export const BANK_ITEM_NOTES_MAX_LENGTH = 10_000

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
  symmetric_transfer: false,
  counterparty_account_id: '',
}

// How a bank item's form, and its filing card beside it, slide in as the next item takes their place:
// the app's ease-out over a short distance, with no exit, so the decided item's card never sits beside
// the next item's form
export const REVIEW_SWAP_DURATION_S = 0.2
export const REVIEW_SWAP_OFFSET_PX = 12
