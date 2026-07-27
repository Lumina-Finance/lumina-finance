import { useMemo } from 'react'
import { DesktopToolbarControls } from '@/components/list-controls/DesktopToolbarControls'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { MobileToolbarActions } from '@/components/list-controls/MobileToolbarActions'
import { ToolbarStickyShell } from '@/components/list-controls/ToolbarStickyShell'
import { getSearchFieldWrapperClassName } from '@/components/list-controls/toolbarStyles'
import { useToolbarShellState } from '@/components/list-controls/useToolbarShellState'
import type { TransactionListToolbarProps } from '@/pages/transactions/components/toolbar/types'
import { TransactionFilterPanel } from '@/pages/transactions/components/toolbar/FilterPanel'
import { MobileFilterPanel } from '@/pages/transactions/components/toolbar/MobileFilterPanel'
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
  const shell = useToolbarShellState()
  useToolbarStickyOffset(shell.toolbarRef, onStickyOffsetChange)

  const accountOptions = useMemo(
    () => getAccountOptions(accounts),
    [accounts],
  )
  const categoryOptions = useMemo(
    () => getCategoryOptions(categories),
    [categories],
  )
  const activeFilterCount = getActiveFilterCount(filters, showAccountFilter)

  return (
    <>
      <ToolbarStickyShell
        toolbarRef={shell.toolbarRef}
        mobileSearchStickySentinelRef={shell.mobileSearchStickySentinelRef}
        toolbarStuckSentinelRef={shell.toolbarStuckSentinelRef}
        desktopInlineLayout={shell.desktopInlineLayout}
        isToolbarStuck={shell.isToolbarStuck}
      >
        <GlassSearchField
          value={search}
          onValueChange={onSearchChange}
          onSubmit={onSearchSubmit}
          placeholder="Search transactions..."
          wrapperClassName={getSearchFieldWrapperClassName(shell.mobileSearchStuck, shell.desktopInlineLayout)}
        />

        <MobileToolbarActions
          activeFilterCount={activeFilterCount}
          onOpenFilters={shell.openMobileSheet}
          onPrimaryAction={onCreateTransaction}
          primaryLabel="Add transaction"
          primaryDisabled={createDisabled}
          primaryDisabledReason={createDisabledReason}
        />

        <DesktopToolbarControls
          controlsRef={shell.controlsRef}
          filterGroupRef={shell.filterGroupRef}
          createMeasureRef={shell.createMeasureRef}
          desktopInlineLayout={shell.desktopInlineLayout}
          desktopCreateStacked={shell.desktopCreateStacked}
          filterPanel={
            <TransactionFilterPanel
              accountOptions={accountOptions}
              categoryOptions={categoryOptions}
              filters={filters}
              setFilter={setFilter}
              showAccountFilter={showAccountFilter}
              lockedCurrency={lockedCurrency}
            />
          }
          createLabel="Add Transaction"
          onCreate={onCreateTransaction}
          createDisabled={createDisabled}
          createDisabledReason={createDisabledReason}
        />
      </ToolbarStickyShell>

      {shell.isMobileSheetMounted && (
        <MobileFilterPanel
          isOpen={shell.isMobileSheetOpen}
          onClose={shell.closeMobileSheet}
          onExitComplete={shell.finishMobileSheetExit}
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
