import type { Transaction } from '@/api/transactions'

export type TransactionModalKind = 'expense' | 'income' | 'transfer'

export type TransactionDirection = 'debit' | 'credit'

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
}

export interface TransactionFormFieldErrors {
  account_id?: string
  category_id?: string
  merchant_id?: string
  amount?: string
  currency?: string
  date?: string
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
