import type { RefObject } from 'react'
import type { Category } from '@/api/categories'
import type { OptionItem } from '@/components/filters/OptionList'
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
  onCreateTransaction: () => void
  createDisabled?: boolean
  createDisabledReason?: string
  onStickyOffsetChange?: (offset: number) => void
}

export type TransactionToolbarOptions = {
  accountOptions: OptionItem[]
  categoryOptions: OptionItem[]
}

export type DesktopTransactionToolbarRefs = {
  toolbarRef: RefObject<HTMLDivElement | null>
  controlsRef: RefObject<HTMLDivElement | null>
  filterGroupRef: RefObject<HTMLDivElement | null>
  createMeasureRef: RefObject<HTMLButtonElement | null>
}
