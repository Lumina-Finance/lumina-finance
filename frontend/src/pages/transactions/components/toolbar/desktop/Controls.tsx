import type { RefObject } from 'react'
import { Plus } from 'lucide-react'
import { TransactionFilterPanel } from '@/pages/transactions/components/toolbar/FilterPanel'
import type {
  TransactionFilterSetter,
  TransactionToolbarOptions,
} from '@/pages/transactions/components/toolbar/types'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

type DesktopTransactionToolbarControlsProps = TransactionToolbarOptions & {
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
  showAccountFilter: boolean
  lockedCurrency?: string
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
  lockedCurrency,
  accountOptions,
  categoryOptions,
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
        <TransactionFilterPanel
          accountOptions={accountOptions}
          categoryOptions={categoryOptions}
          filters={filters}
          setFilter={setFilter}
          showAccountFilter={showAccountFilter}
          lockedCurrency={lockedCurrency}
        />
      </div>

      <button
        type="button"
        className={`app-glass-button-primary h-11 shrink-0 ${desktopCreateStacked ? 'basis-full justify-center' : 'w-auto'}`}
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
        className="app-glass-button-primary pointer-events-none invisible absolute h-11 w-auto shrink-0"
        tabIndex={-1}
        aria-hidden
      >
        <Plus size={18} aria-hidden />
        <span>Add Transaction</span>
      </button>
    </div>
  )
}
