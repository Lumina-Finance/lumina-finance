import type { Category } from '@/api/categories'
import type { TransactionListAccount, TransactionListFilters } from '@/pages/transactions/types/transactionList'

export type TransactionFilterSetter = (patch: Partial<TransactionListFilters>) => void

export type TransactionListToolbarProps = {
  search: string
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
  categories?: Category[]
  accounts?: TransactionListAccount[]
  showAccountFilter: boolean
  // The account's currency on its own transaction list, which pins the amount currency
  lockedCurrency?: string
  onCreateTransaction: () => void
  createDisabled?: boolean
  createDisabledReason?: string
  onStickyOffsetChange?: (offset: number) => void
}
