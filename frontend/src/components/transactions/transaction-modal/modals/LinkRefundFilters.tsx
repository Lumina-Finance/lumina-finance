import { useMemo, useState, type RefObject } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { Category } from '@/api/categories'
import { MobileFilterPanel } from '@/components/transactions/toolbar/MobileFilterPanel'
import { TransactionFilterPanel } from '@/components/transactions/toolbar/FilterPanel'
import type { TransactionFilterSetter } from '@/components/transactions/toolbar/types'
import {
  getAccountOptions,
  getActiveFilterCount,
  getCategoryOptions,
} from '@/components/transactions/utils/filterOptions'
import type { TransactionListAccount, TransactionListFilters } from '@/components/transactions/types/transactionList'

interface LinkRefundFiltersProps {
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
  accounts: TransactionListAccount[] | undefined
  categories: Category[] | undefined

  // The width of the search row, so the open glass covers it edge to edge
  panelWidth?: number

  // The dialog's scrolling body, which the open glass must stay inside so its buttons stay on screen
  constrainTo?: RefObject<HTMLElement | null>
}

/**
 * The transaction list's own filters, for narrowing the transactions offered to link: the glass pill on
 * a wide screen and a Filters button opening the full-screen sheet on a phone, as on the list
 */
export default function TransactionModalLinkRefundFilters({
  filters,
  setFilter,
  accounts,
  categories,
  panelWidth,
  constrainTo,
}: LinkRefundFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMounted, setSheetMounted] = useState(false)
  const accountOptions = useMemo(() => getAccountOptions(accounts), [accounts])
  const categoryOptions = useMemo(() => getCategoryOptions(categories), [categories])
  const activeFilterCount = getActiveFilterCount(filters, true)

  return (
    <>
      <div className="hidden shrink-0 min-[750px]:block">
        <TransactionFilterPanel
          accountOptions={accountOptions}
          categoryOptions={categoryOptions}
          filters={filters}
          setFilter={setFilter}
          showAccountFilter
          openWidth={panelWidth}
          constrainTo={constrainTo}
        />
      </div>

      <button
        type="button"
        className="app-glass-button h-11 shrink-0 gap-2 min-[750px]:hidden"
        onClick={() => {
          setSheetMounted(true)
          setSheetOpen(true)
        }}
        aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
      >
        <SlidersHorizontal size={17} aria-hidden />
        <span aria-hidden>Filters</span>
        {activeFilterCount > 0 && (
          <span
            aria-hidden
            className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold"
            style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
          >
            {activeFilterCount}
          </span>
        )}
      </button>

      {sheetMounted && (
        <MobileFilterPanel
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onExitComplete={() => setSheetMounted(sheetOpen)}
          accountOptions={accountOptions}
          categoryOptions={categoryOptions}
          filters={filters}
          setFilter={setFilter}
          showAccountFilter
          aboveDialog
        />
      )}
    </>
  )
}
