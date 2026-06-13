import type { RefObject } from 'react'
import { Plus } from 'lucide-react'
import DateRangeFilterPanel from '@/components/DateRangeFilterPanel'
import FilterChip from '@/components/FilterChip'
import FilterOptionList from '@/components/FilterOptionList'
import type {
  TransactionDateRangeDraftProps,
  TransactionFilterSetter,
  TransactionToolbarOptions,
  TransactionToolbarSelectionLabels,
} from '@/transactions/components/Toolbar/types'
import type { TransactionListFilters } from '@/transactions/types/transactionList'

type DesktopTransactionToolbarControlsProps = TransactionDateRangeDraftProps & TransactionToolbarOptions & TransactionToolbarSelectionLabels & {
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
  showAccountFilter: boolean
  desktopInlineLayout: boolean
  desktopCreateStacked: boolean
  controlsRef: RefObject<HTMLDivElement | null>
  filterGroupRef: RefObject<HTMLDivElement | null>
  createMeasureRef: RefObject<HTMLButtonElement | null>
  onCreateTransaction: () => void
  createDisabled: boolean
  createDisabledReason?: string
}

/**
 * Renders the desktop transaction filters and create action while exposing measurement refs to the toolbar layout hook
 */
export function DesktopTransactionToolbarControls({
  filters,
  setFilter,
  showAccountFilter,
  accountOptions,
  categoryOptions,
  selectedAccountLabel,
  selectedCategoryLabel,
  selectedDateLabel,
  pendingFrom,
  pendingTo,
  dateRangeChanged,
  dateRangeInvalid,
  onPendingFromChange,
  onPendingToChange,
  onDateRangeReset,
  onDateRangeClose,
  desktopInlineLayout,
  desktopCreateStacked,
  controlsRef,
  filterGroupRef,
  createMeasureRef,
  onCreateTransaction,
  createDisabled,
  createDisabledReason,
}: DesktopTransactionToolbarControlsProps) {
  return (
    <div
      ref={controlsRef}
      className={`relative hidden w-full flex-wrap items-center gap-3 min-[750px]:flex ${desktopInlineLayout ? 'min-[750px]:w-auto min-[750px]:flex-none min-[750px]:flex-nowrap' : ''}`}
    >
      <div
        ref={filterGroupRef}
        className={`flex min-w-0 flex-1 flex-wrap items-center gap-3 ${desktopInlineLayout ? 'min-[750px]:flex-none min-[750px]:flex-nowrap' : ''} ${desktopCreateStacked ? 'justify-between' : ''}`}
      >
        {showAccountFilter && (
          <FilterChip
            label="Account"
            selectedLabel={selectedAccountLabel}
            onClear={() => setFilter({ account_id: undefined })}
          >
            {(close) => (
              <FilterOptionList
                options={accountOptions}
                selectedValue={filters.account_id}
                onSelect={(value) => { setFilter({ account_id: value }); close() }}
                searchPlaceholder="Search accounts..."
                selectFirstSearchResultOnEnter
              />
            )}
          </FilterChip>
        )}

        <FilterChip
          label="Category"
          selectedLabel={selectedCategoryLabel}
          onClear={() => setFilter({ category_id: undefined })}
        >
          {(close) => (
            <FilterOptionList
              options={categoryOptions}
              selectedValue={filters.category_id}
              onSelect={(value) => { setFilter({ category_id: value }); close() }}
              searchPlaceholder="Search categories..."
              selectFirstSearchResultOnEnter
            />
          )}
        </FilterChip>

        <FilterChip
          label="Date range"
          selectedLabel={selectedDateLabel}
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
      </div>

      <button
        type="button"
        className={`app-primary-button h-10 shrink-0 ${desktopCreateStacked ? 'basis-full justify-center' : 'w-auto'}`}
        onClick={onCreateTransaction}
        disabled={createDisabled}
        title={createDisabledReason}
      >
        <Plus size={18} aria-hidden />
        <span>Add Transaction</span>
      </button>
      <button
        ref={createMeasureRef}
        type="button"
        className="app-primary-button pointer-events-none invisible absolute h-10 w-auto shrink-0"
        tabIndex={-1}
        aria-hidden
      >
        <Plus size={18} aria-hidden />
        <span>Add Transaction</span>
      </button>
    </div>
  )
}
