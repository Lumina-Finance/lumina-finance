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

  // One node for both widths and for the hidden copy the desktop row measures itself by, sized to
  // match whichever primary button it stands beside, which is taller on a phone than on a desktop
  const importAction = onImport ? (
    <button
      type="button"
      className="app-glass-button h-11 w-11 shrink-0 px-0 min-[750px]:h-10 min-[750px]:w-10"
      onClick={onImport}
      disabled={importDisabled}
      title={importDisabledReason}
      aria-label={importDisabledReason ?? 'Import transactions into this account'}
    >
      <Upload size={18} aria-hidden />
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
          secondaryAction={importAction}
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
