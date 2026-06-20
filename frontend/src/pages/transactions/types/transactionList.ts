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

export interface TransactionDateGroup {
  dateLabel: string
  transactions: Transaction[]
}
