import type { AccountsOverview } from '@/api/accounts'
import type { Transaction } from '@/api/transactions'

export interface TransactionListFilters {
  // Multi-value filters keep a transaction when its field matches any selected value
  account_id?: string[]
  category_id?: string[]
  merchant_id?: string[]
  tag_id?: string[]
  // ``all`` requires every selected tag, ``any`` requires at least one
  tag_match?: 'all' | 'any'
  // Single transaction currency the list and the amount range are scoped to
  currency?: string
  // Amount bounds in ``amount_currency`` minor units, matched as a magnitude
  min_amount?: number
  max_amount?: number
  amount_currency?: string
  from_date?: string
  to_date?: string
}

export interface TransactionListAccount {
  id: string
  name?: string
  currency?: string
  institution?: AccountsOverview['institution']
  is_archived?: boolean
}

/**
 * Narrows a loaded account to the fields the transaction list reads
 *
 * Both pages showing the list need the whole set, not only the accounts on screen, because a
 * transfer's counterparty account is often one the current view is not showing
 */
export function toTransactionListAccount(account: AccountsOverview): TransactionListAccount {
  return {
    id: account.id,
    name: account.name,
    currency: account.currency,
    institution: account.institution,
    is_archived: account.is_archived,
  }
}

export interface TransactionDateGroup {
  dateLabel: string
  transactions: Transaction[]
}
