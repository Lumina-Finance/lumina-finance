import { useMemo } from 'react'
import { Upload } from 'lucide-react'
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
  onImport,
  importDisabled = false,
  importDisabledReason,
  onStickyOffsetChange,
}: TransactionListToolbarProps) {
  const shell = useToolbarShellState()
  useToolbarStickyOffset(shell.toolbarRef, onStickyOffsetChange)

  // One node for both widths, sized to match the buttons it stands beside, which are taller on a
  // phone than on a desktop. The accessible name says which import this is, since the word on the
  // button cannot: on a list fixed to one account it files every row into that account, and on the
  // list of every account it is the way to the import page. The reason it is blocked rides on the
  // title alone, the way the create button's does, so the name still says what the control is
  const importAction = onImport ? (
    <button
      type="button"
      className="app-glass-button h-11 shrink-0 min-[750px]:h-10"
      onClick={onImport}
      disabled={importDisabled}
      title={importDisabledReason}
      aria-label={showAccountFilter ? 'Import transactions' : 'Import transactions into this account'}
    >
      <Upload size={18} aria-hidden />
      <span>Import</span>
    </button>
  ) : undefined

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
          secondaryAction={importAction}
        />

        <DesktopToolbarControls
          controlsRef={shell.controlsRef}
          filterGroupRef={shell.filterGroupRef}
          createMeasureRef={shell.createMeasureRef}
          desktopInlineLayout={shell.desktopInlineLayout}
          desktopCreateStacked={shell.desktopCreateStacked}
          filterPanel={
            // Both go in the filter slot rather than beside the create button, because the layout
            // hook measures this group's own children as they render. A button placed after the
            // group instead would need its own measured twin, or the row would report itself
            // narrower than it draws and stay on one line where it no longer fits. Wrapped as one
            // child, since the group spreads its children apart once the create button stacks
            <div className="flex min-w-0 items-center gap-3">
              {importAction}
              <TransactionFilterPanel
                accountOptions={accountOptions}
                categoryOptions={categoryOptions}
                filters={filters}
                setFilter={setFilter}
                showAccountFilter={showAccountFilter}
                lockedCurrency={lockedCurrency}
              />
            </div>
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
