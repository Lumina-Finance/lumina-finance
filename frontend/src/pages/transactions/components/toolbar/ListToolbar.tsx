import { useCallback, useMemo, useState } from 'react'
import type { TransactionListToolbarProps } from '@/pages/transactions/components/toolbar/types'
import { DesktopTransactionToolbarControls } from '@/pages/transactions/components/toolbar/desktop/Controls'
import { MobileToolbarActions } from '@/pages/transactions/components/toolbar/mobile/Actions'
import { MobileFilterPanel } from '@/pages/transactions/components/toolbar/MobileFilterPanel'
import { TransactionSearchField } from '@/pages/transactions/components/toolbar/SearchField'
import { useDesktopToolbarLayout } from '@/components/filters/hooks/useDesktopToolbarLayout'
import { useMobileSearchStuck } from '@/components/filters/hooks/useMobileSearchStuck'
import { useToolbarStuck } from '@/components/filters/hooks/useToolbarStuck'
import { getToolbarStickyRowClass, getToolbarStuckShadow } from '@/components/list-controls/toolbarStyles'
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
  lockedCurrency,
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
  const { toolbarStuckSentinelRef, isToolbarStuck } = useToolbarStuck()

  useToolbarStickyOffset(toolbarRef, onStickyOffsetChange)

  const openMobileSheet = useCallback(() => {
    setIsMobileSheetMounted(true)
    setIsMobileSheetOpen(true)
  }, [])

  const closeMobileSheet = useCallback(() => setIsMobileSheetOpen(false), [])

  return (
    <>
      <div ref={mobileSearchStickySentinelRef} aria-hidden className="h-px min-[1050px]:hidden" />
      <div ref={toolbarStuckSentinelRef} aria-hidden className="h-px max-[1049px]:hidden" />
      <div
        ref={toolbarRef}
        className={getToolbarStickyRowClass(desktopInlineLayout)}
        style={{
          background: 'var(--app-bg)',
          boxShadow: getToolbarStuckShadow(isToolbarStuck),
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
          showAccountFilter={showAccountFilter}
          lockedCurrency={lockedCurrency}
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
          showAccountFilter={showAccountFilter}
          lockedCurrency={lockedCurrency}
        />
      )}
    </>
  )
}
