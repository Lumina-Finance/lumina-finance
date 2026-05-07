import { Plus, Search } from 'lucide-react'
import type { Category } from '@/api/categories'
import DateRangeFilterPanel from '@/components/DateRangeFilterPanel'
import FilterChip from '@/components/FilterChip'
import FilterOptionList from '@/components/FilterOptionList'
import { DEFAULT_TRANSACTION_CATEGORY_ICON } from '@/transactions/constants/transactionList'
import type { TransactionListAccount, TransactionListFilters } from '@/transactions/types/transactionList'
import { formatDateRangeLabel } from '@/transactions/utils/date'

const CATEGORY_KIND_LABELS: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

export default function TransactionListToolbar({
  search,
  onSearchChange,
  onSearchSubmit,
  filters,
  setFilter,
  categories,
  accounts,
  showAccountFilter,
  pendingFrom,
  pendingTo,
  dateRangeChanged,
  dateRangeInvalid,
  onPendingFromChange,
  onPendingToChange,
  onDateRangeReset,
  onDateRangeClose,
  onCreateTransaction,
}: {
  search: string
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  filters: TransactionListFilters
  setFilter: (patch: Partial<TransactionListFilters>) => void
  categories?: Category[]
  accounts?: TransactionListAccount[]
  showAccountFilter: boolean
  pendingFrom: string
  pendingTo: string
  dateRangeChanged: boolean
  dateRangeInvalid: boolean
  onPendingFromChange: (value: string) => void
  onPendingToChange: (value: string) => void
  onDateRangeReset: () => void
  onDateRangeClose: () => void
  onCreateTransaction: () => void
}) {
  return (
    <div
      className="sticky top-0 z-30 !mt-2 mb-2 flex items-center gap-3 pb-2 pt-5"
      style={{
        background: 'var(--app-bg)',
        boxShadow: '0 0.25rem 0 var(--app-bg)',
      }}
    >
      <div className="relative flex-1">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--app-text-subtle)' }}
          aria-hidden
        />
        <input
          type="text"
          placeholder="Search transactions..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSearchSubmit()
          }}
          className="app-input w-full pl-9"
        />
      </div>

      {showAccountFilter && (
        <FilterChip
          label="Account"
          selectedLabel={accounts?.find((account) => account.id === filters.account_id)?.name ?? null}
          onClear={() => setFilter({ account_id: undefined })}
        >
          {(close) => (
            <FilterOptionList
              options={(accounts ?? []).map((account) => ({
                value: account.id,
                label: account.name ?? 'Unnamed account',
              }))}
              selectedValue={filters.account_id}
              onSelect={(value) => { setFilter({ account_id: value }); close() }}
              searchPlaceholder="Search accounts..."
            />
          )}
        </FilterChip>
      )}

      <FilterChip
        label="Category"
        selectedLabel={categories?.find((category) => category.id === filters.category_id)?.name ?? null}
        onClear={() => setFilter({ category_id: undefined })}
      >
        {(close) => {
          const options = (['expense', 'income', 'transfer'] as const).flatMap((kind) =>
            (categories ?? [])
              .filter((category) => category.kind === kind)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((category) => ({
                value: category.id,
                label: category.name,
                group: CATEGORY_KIND_LABELS[kind],
                icon: category.icon ?? DEFAULT_TRANSACTION_CATEGORY_ICON,
              })),
          )
          return (
            <FilterOptionList
              options={options}
              selectedValue={filters.category_id}
              onSelect={(value) => { setFilter({ category_id: value }); close() }}
              searchPlaceholder="Search categories..."
            />
          )
        }}
      </FilterChip>

      <FilterChip
        label="Date range"
        selectedLabel={formatDateRangeLabel(filters.from_date, filters.to_date)}
        onClear={() => setFilter({ from_date: undefined, to_date: undefined })}
        onClose={onDateRangeClose}
        panelAlign="right"
        panelClassName="w-[25rem] overflow-hidden"
      >
        {(close) => (
          <DateRangeFilterPanel
            from={pendingFrom}
            to={pendingTo}
            changed={dateRangeChanged}
            invalid={dateRangeInvalid}
            onFromChange={onPendingFromChange}
            onToChange={onPendingToChange}
            onReset={onDateRangeReset}
            onApply={close}
          />
        )}
      </FilterChip>

      <button
        type="button"
        className="app-primary-button"
        onClick={onCreateTransaction}
      >
        <Plus size={18} aria-hidden />
        Add Transaction
      </button>
    </div>
  )
}
