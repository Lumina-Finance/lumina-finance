import { useCallback, useMemo, useState } from 'react'
import type { TransactionListToolbarProps } from '@/pages/transactions/components/toolbar/types'
import { DesktopTransactionToolbarControls } from '@/pages/transactions/components/toolbar/desktop/Controls'
import { MobileToolbarActions } from '@/pages/transactions/components/toolbar/mobile/Actions'
import { MobileFilterPanel } from '@/pages/transactions/components/toolbar/MobileFilterPanel'
import { TransactionSearchField } from '@/pages/transactions/components/toolbar/SearchField'
import { useDesktopToolbarLayout } from '@/pages/transactions/components/toolbar/hooks/useDesktopLayout'
import { useMobileSearchStuck } from '@/pages/transactions/components/toolbar/hooks/useMobileSearchStuck'
import { useToolbarStickyOffset } from '@/pages/transactions/components/toolbar/hooks/useStickyOffset'
import {
  getAccountOptions,
  getActiveFilterCount,
  getCategoryOptions,
} from '@/pages/transactions/utils/filterOptions'

/**
 * Orchestrates transaction list search, filters, and responsive toolbar layout
 */
export default function TransactionListToolbar({
  search,
  onSearchChange,
  onSearchSubmit,
  filters,
  setFilter,
  categories,
  accounts,
  showAccountFilter,
  onCreateTransaction,
  createDisabled = false,
  createDisabledReason,
  onStickyOffsetChange,
}: TransactionListToolbarProps) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false)
  // Kept mounted through the close animation so the sheet's scroll lock is only ever active while
  // the sheet exists, never on the page underneath
  const [isMobileSheetMounted, setIsMobileSheetMounted] = useState(false)

  const accountOptions = useMemo(
    () => getAccountOptions(accounts),
    [accounts],
  )
  const categoryOptions = useMemo(
    () => getCategoryOptions(categories),
    [categories],
  )
  const activeFilterCount = getActiveFilterCount(filters, showAccountFilter)

  const {
    toolbarRef,
    controlsRef,
    filterGroupRef,
    createMeasureRef,
    desktopInlineLayout,
    desktopCreateStacked,
  } = useDesktopToolbarLayout()
  const { mobileSearchStickySentinelRef, mobileSearchStuck } = useMobileSearchStuck()

  useToolbarStickyOffset(toolbarRef, onStickyOffsetChange)

  const openMobileSheet = useCallback(() => {
    setIsMobileSheetMounted(true)
    setIsMobileSheetOpen(true)
  }, [])

  const closeMobileSheet = useCallback(() => setIsMobileSheetOpen(false), [])

  return (
    <>
      <div ref={mobileSearchStickySentinelRef} aria-hidden className="h-px min-[1050px]:hidden" />
      <div
        ref={toolbarRef}
        className={`sticky top-0 z-30 !mt-2 mb-2 flex flex-col gap-3 pb-2 pt-4 min-[1050px]:pt-5 ${desktopInlineLayout ? 'min-[750px]:flex-row min-[750px]:items-center' : ''}`}
        style={{
          background: 'var(--app-bg)',
          boxShadow: '0 0.25rem 0 var(--app-bg)',
        }}
      >
        <TransactionSearchField
          search={search}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          mobileSearchStuck={mobileSearchStuck}
          desktopInlineLayout={desktopInlineLayout}
        />

        <MobileToolbarActions
          activeFilterCount={activeFilterCount}
          onOpenFilters={openMobileSheet}
          onCreateTransaction={onCreateTransaction}
          createDisabled={createDisabled}
          createDisabledReason={createDisabledReason}
        />

        <DesktopTransactionToolbarControls
          filters={filters}
          setFilter={setFilter}
          accountOptions={accountOptions}
          categoryOptions={categoryOptions}
          desktopInlineLayout={desktopInlineLayout}
          desktopCreateStacked={desktopCreateStacked}
          controlsRef={controlsRef}
          filterGroupRef={filterGroupRef}
          createMeasureRef={createMeasureRef}
          onCreateTransaction={onCreateTransaction}
          createDisabled={createDisabled}
          createDisabledReason={createDisabledReason}
        />
      </div>

      {isMobileSheetMounted && (
        <MobileFilterPanel
          isOpen={isMobileSheetOpen}
          onClose={closeMobileSheet}
          onExitComplete={() => {
            if (!isMobileSheetOpen) setIsMobileSheetMounted(false)
          }}
          accountOptions={accountOptions}
          categoryOptions={categoryOptions}
          filters={filters}
          setFilter={setFilter}
        />
      )}
    </>
  )
}
