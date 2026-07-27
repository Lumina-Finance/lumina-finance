import { DesktopToolbarControls } from '@/components/list-controls/DesktopToolbarControls'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { MobileToolbarActions } from '@/components/list-controls/MobileToolbarActions'
import { ToolbarStickyShell } from '@/components/list-controls/ToolbarStickyShell'
import { getSearchFieldWrapperClassName } from '@/components/list-controls/toolbarStyles'
import { useToolbarShellState } from '@/components/list-controls/useToolbarShellState'
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
  onAddAccount,
}: AccountListToolbarProps) {
  const shell = useToolbarShellState()

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
          placeholder="Search accounts..."
          wrapperClassName={getSearchFieldWrapperClassName(shell.mobileSearchStuck, shell.desktopInlineLayout)}
        />

        <MobileToolbarActions
          activeFilterCount={activeFilterCount}
          onOpenFilters={shell.openMobileSheet}
          onPrimaryAction={onAddAccount}
          primaryLabel="Add account"
        />

        <DesktopToolbarControls
          controlsRef={shell.controlsRef}
          filterGroupRef={shell.filterGroupRef}
          createMeasureRef={shell.createMeasureRef}
          desktopInlineLayout={shell.desktopInlineLayout}
          desktopCreateStacked={shell.desktopCreateStacked}
          filterPanel={
            <AccountFilterPanel
              institutionOptions={institutionOptions}
              kindOptions={kindOptions}
              typeOptions={typeOptions}
              filters={filters}
              setFilter={setFilter}
            />
          }
          createLabel="Add Account"
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
