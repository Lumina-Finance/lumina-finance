import { DesktopToolbarControls } from '@/components/list-controls/DesktopToolbarControls'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { MobileToolbarActions } from '@/components/list-controls/MobileToolbarActions'
import { ToolbarStickyShell } from '@/components/list-controls/ToolbarStickyShell'
import { getSearchFieldWrapperClassName } from '@/components/list-controls/toolbarStyles'
import { useToolbarShellState } from '@/components/list-controls/useToolbarShellState'
import { useToolbarStickyOffset } from '@/components/transactions/toolbar/hooks/useStickyOffset'
import { GroupingPanel } from '@/pages/accounts/components/toolbar/GroupingPanel'
import { MobileGroupingPanel } from '@/pages/accounts/components/toolbar/MobileGroupingPanel'
import { AccountFilterPanel } from '@/pages/accounts/components/toolbar/FilterPanel'
import { MobileFilterPanel } from '@/pages/accounts/components/toolbar/MobileFilterPanel'
import type { AccountListToolbarProps } from '@/pages/accounts/components/toolbar/types'

/**
 * Orchestrates account list search, filters, and responsive toolbar layout
 */
export default function AccountListToolbar({
  search,
  onSearchChange,
  filters,
  setFilter,
  activeFilterCount,
  institutionOptions,
  kindOptions,
  typeOptions,
  grouping,
  onAddAccount,
  onStickyOffsetChange,
}: AccountListToolbarProps) {
  const shell = useToolbarShellState()
  useToolbarStickyOffset(shell.toolbarRef, onStickyOffsetChange)

  return (
    <>
      <ToolbarStickyShell
        toolbarRef={shell.toolbarRef}
        topRowSentinelRef={shell.topRowSentinelRef}
        toolbarStuckSentinelRef={shell.toolbarStuckSentinelRef}
        desktopInlineLayout={shell.desktopInlineLayout}
        isToolbarStuck={shell.isToolbarStuck}
        isTopRowAtMenuButton={shell.isTopRowAtMenuButton}
      >
        <GlassSearchField
          value={search}
          onValueChange={onSearchChange}
          placeholder="Search accounts..."
          wrapperClassName={getSearchFieldWrapperClassName(shell.isTopRowAtMenuButton, shell.desktopInlineLayout)}
        />

        <MobileToolbarActions
          activeFilterCount={activeFilterCount}
          onOpenFilters={shell.openMobileSheet}
          onPrimaryAction={onAddAccount}
          primaryLabel="Add account"
          // On a phone the grouping pill sits beside Filters in the sticky row and opens the same
          // full-screen sheet, where a desktop opens the glass panel. Filters' own siblings keep their
          // content width while Filters takes the rest of the row, so this one does too
          secondaryAction={<MobileGroupingPanel settings={grouping} />}
        />

        <DesktopToolbarControls
          controlsRef={shell.controlsRef}
          filterGroupRef={shell.filterGroupRef}
          createMeasureRef={shell.createMeasureRef}
          desktopInlineLayout={shell.desktopInlineLayout}
          isTopRowAtMenuButton={shell.isTopRowAtMenuButton}
          desktopCreateStacked={shell.desktopCreateStacked}
          filterPanel={
            // Both go in the filter slot, because the layout hook measures this group's own children
            // as they render. Wrapped as one child, since the group spreads its children apart once
            // the create button stacks
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <GroupingPanel settings={grouping} />
              <AccountFilterPanel
                institutionOptions={institutionOptions}
                kindOptions={kindOptions}
                typeOptions={typeOptions}
                filters={filters}
                setFilter={setFilter}
              />
            </div>
          }
          createLabel="Add account"
          onCreate={onAddAccount}
        />
      </ToolbarStickyShell>

      {shell.isMobileSheetMounted && (
        <MobileFilterPanel
          isOpen={shell.isMobileSheetOpen}
          onClose={shell.closeMobileSheet}
          onExitComplete={shell.finishMobileSheetExit}
          institutionOptions={institutionOptions}
          kindOptions={kindOptions}
          typeOptions={typeOptions}
          filters={filters}
          setFilter={setFilter}
        />
      )}
    </>
  )
}
