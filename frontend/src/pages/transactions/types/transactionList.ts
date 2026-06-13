import type { AccountsOverview } from '@/api/accounts'
import type { Transaction } from '@/api/transactions'

export interface TransactionListFilters {
  account_id?: string
  category_id?: string
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
