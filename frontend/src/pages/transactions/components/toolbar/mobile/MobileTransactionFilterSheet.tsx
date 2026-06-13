import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { MobileFilterSection } from '@/components/filters/MobileSection'
import { useMobileFilterSheetEffects } from '@/components/filters/hooks/useMobileSheetEffects'
import { MobileDateRangeSection } from '@/pages/transactions/components/toolbar/mobile/MobileDateRangeSection'
import type {
  TransactionDateRangeDraftProps,
  TransactionFilterSetter,
  TransactionToolbarOptions,
  TransactionToolbarSelectionLabels,
} from '@/pages/transactions/components/toolbar/types'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

type MobileTransactionFilterSheetProps = TransactionDateRangeDraftProps & TransactionToolbarOptions & TransactionToolbarSelectionLabels & {
  isOpen: boolean
  activeFilterCount: number
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
  showAccountFilter: boolean
  onClose: () => void
  onExitComplete: () => void
}

/**
 * Renders the mobile transaction filter sheet and delegates shared modal browser effects
 */
export function MobileTransactionFilterSheet({
  isOpen,
  activeFilterCount,
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
  onClose,
  onExitComplete,
}: MobileTransactionFilterSheetProps) {
  const panelRef = useMobileFilterSheetEffects({ isOpen, onClose })
  const shouldReduceMotion = useReducedMotion()

  /**
   * Resets date drafts with the applied filters so clearing does not leave stale pending dates in the sheet
   */
  function clearAllFilters() {
    setFilter({
      account_id: undefined,
      category_id: undefined,
      from_date: undefined,
      to_date: undefined,
    })
    onDateRangeReset()
    onClose()
  }

  const sheetInitial = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 30 }
  const sheetAnimate = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0 }
  const sheetExit = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 24 }

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {isOpen && (
        <div
          className="fixed inset-x-0 -top-[env(safe-area-inset-top)] bottom-0 z-[100] min-[750px]:hidden"
          onClick={onClose}
        >
          <motion.div
            className="absolute inset-0 h-full w-full cursor-default"
            style={{
              background: 'color-mix(in srgb, var(--app-bg) 12%, transparent)',
            }}
            aria-hidden
            onPointerDown={onClose}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Transaction filters"
            className="absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col overflow-hidden rounded-t-2xl border-t"
            style={{
              background: 'var(--app-bg)',
              borderColor: 'var(--app-border)',
              boxShadow: '0 -18px 44px color-mix(in srgb, var(--app-text) 16%, transparent)',
            }}
            initial={sheetInitial}
            animate={sheetAnimate}
            exit={sheetExit}
            transition={{ duration: shouldReduceMotion ? 0.01 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
              <div>
                <h2 className="text-base font-semibold">Filters</h2>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {activeFilterCount === 0 ? 'No active filters' : `${activeFilterCount} active`}
                </p>
              </div>
              <button
                type="button"
                className="app-secondary-button h-10 w-10 px-0"
                onClick={onClose}
                aria-label="Close filters"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain py-5 pl-5 pr-6 [scrollbar-gutter:stable]">
              {showAccountFilter && (
                <MobileFilterSection
                  title="Account"
                  options={accountOptions}
                  selectedValue={filters.account_id}
                  selectedLabel={selectedAccountLabel}
                  searchPlaceholder="Search accounts..."
                  allLabel="All accounts"
                  onSelect={(value) => setFilter({ account_id: value })}
                  onClear={() => setFilter({ account_id: undefined })}
                  selectFirstSearchResultOnEnter
                />
              )}
              <MobileFilterSection
                title="Category"
                options={categoryOptions}
                selectedValue={filters.category_id}
                selectedLabel={selectedCategoryLabel}
                searchPlaceholder="Search categories..."
                allLabel="All categories"
                onSelect={(value) => setFilter({ category_id: value })}
                onClear={() => setFilter({ category_id: undefined })}
                selectFirstSearchResultOnEnter
              />
              <MobileDateRangeSection
                selectedLabel={selectedDateLabel}
                from={pendingFrom}
                to={pendingTo}
                changed={dateRangeChanged}
                invalid={dateRangeInvalid}
                onFromChange={onPendingFromChange}
                onToChange={onPendingToChange}
                onReset={onDateRangeReset}
                onApply={onDateRangeClose}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 border-t px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
              <button type="button" className="app-secondary-button" onClick={clearAllFilters}>
                Clear
              </button>
              <button type="button" className="app-primary-button" onClick={onClose}>
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
