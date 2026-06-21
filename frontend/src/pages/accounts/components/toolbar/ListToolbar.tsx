import { useCallback, useState } from 'react'
import { useDesktopToolbarLayout } from '@/components/filters/hooks/useDesktopToolbarLayout'
import { useMobileSearchStuck } from '@/components/filters/hooks/useMobileSearchStuck'
import { useToolbarStuck } from '@/components/filters/hooks/useToolbarStuck'
import { getToolbarStickyRowClass, getToolbarStuckShadow } from '@/components/list-controls/toolbarStyles'
import { AccountSearchField } from '@/pages/accounts/components/toolbar/SearchField'
import { MobileToolbarActions } from '@/pages/accounts/components/toolbar/mobile/Actions'
import { DesktopAccountToolbarControls } from '@/pages/accounts/components/toolbar/desktop/Controls'
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
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false)
  // Kept mounted through the close animation so the sheet's scroll lock is only ever active while
  // the sheet exists, never on the page underneath
  const [isMobileSheetMounted, setIsMobileSheetMounted] = useState(false)

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
        <AccountSearchField
          search={search}
          onSearchChange={onSearchChange}
          mobileSearchStuck={mobileSearchStuck}
          desktopInlineLayout={desktopInlineLayout}
        />

        <MobileToolbarActions
          activeFilterCount={activeFilterCount}
          onOpenFilters={openMobileSheet}
          onAddAccount={onAddAccount}
        />

        <DesktopAccountToolbarControls
          filters={filters}
          setFilter={setFilter}
          institutionOptions={institutionOptions}
          kindOptions={kindOptions}
          typeOptions={typeOptions}
          desktopInlineLayout={desktopInlineLayout}
          desktopCreateStacked={desktopCreateStacked}
          controlsRef={controlsRef}
          filterGroupRef={filterGroupRef}
          createMeasureRef={createMeasureRef}
          onAddAccount={onAddAccount}
        />
      </div>

      {isMobileSheetMounted && (
        <MobileFilterPanel
          isOpen={isMobileSheetOpen}
          onClose={closeMobileSheet}
          onExitComplete={() => {
            if (!isMobileSheetOpen) setIsMobileSheetMounted(false)
          }}
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
