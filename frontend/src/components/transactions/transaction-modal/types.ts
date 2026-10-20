import type { Transaction, TransactionDirection } from '@/api/transactions'

export type TransactionModalKind = 'expense' | 'income' | 'transfer'

export type { TransactionDirection }

export interface TransactionFormValues {
  kind: TransactionModalKind
  direction: TransactionDirection
  account_id: string
  category_id: string
  merchant_id: string
  amount: string
  currency: string
  notes: string
  date: string
  tag_ids: string[]

  // When set on a transfer, the same amount is recorded in both accounts as two independent rows.
  // The account it is recorded in is the one below, which doubles as the receiving account
  symmetric_transfer: boolean

  // Where the counterparty account of a transfer sits: an account id, the "outside this app"
  // sentinel, or empty when not yet answered. Ignored for every category except a transfer that
  // is not Balance Adjustment
  counterparty_account_id: string
}

export interface TransactionFormFieldErrors {
  account_id?: string
  category_id?: string
  merchant_id?: string
  amount?: string
  currency?: string
  date?: string
  counterparty_account_id?: string
}

export interface CreateTransactionModalProps {
  open: boolean
  onClose: () => void

  /** When set, the modal opens in edit mode for this transaction */
  transaction?: Transaction

  /** Pre-selects this account in create mode, such as from an account page */
  defaultAccountId?: string

  /** Pre-selects this currency in create mode, usually from the default account */
  defaultCurrency?: string

  /** Opens an existing transaction for viewing without allowing changes */
  readOnly?: boolean
}
