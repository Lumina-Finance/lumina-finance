import type { Category } from '@/api/categories'
import type { TransactionListAccount, TransactionListFilters } from '@/components/transactions/types/transactionList'

import type { ExportScope } from '@/components/transactions/utils/exportFile'

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

  // Opens an import that files every row into the one account this list is fixed to. Absent on the
  // list of every account, which has no one account to import into
  onImport?: () => void
  importDisabled?: boolean
  importDisabledReason?: string

  // Downloads what the list shows as a CSV file, or asks first when that is every transaction. Absent
  // on a list that offers no export
  onExport?: () => void

  // What the export saves, which the button's word and name follow
  exportScope?: ExportScope

  // Whether the file is being prepared, which holds the button off until it is saved
  exportPending?: boolean

  // Why the button is off beyond waiting on its own download, such as the list being empty
  exportDisabledReason?: string
  onStickyOffsetChange?: (offset: number) => void

  // Whether the list is showing a checkbox on every row, so a bulk edit can pick rows out
  isSelecting?: boolean

  // How many rows are ticked, which is what decides whether the edit button can be pressed
  selectedCount?: number

  // Shown as the edit button's title while it is off for a reason other than nothing being ticked
  editDisabledReason?: string

  // Opens the bulk edit modal. Absent on a list that offers no selection at all
  onEditSelection?: () => void

  // Shown as the delete button's title while it is off for a reason other than nothing being ticked
  deleteDisabledReason?: string

  // Opens the bulk delete confirmation. Absent on a list that offers no selection at all
  onDeleteSelection?: () => void
  onToggleSelecting?: () => void
}
