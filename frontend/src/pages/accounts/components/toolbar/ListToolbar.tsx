import { useCallback, useState } from 'react'
import { useDesktopToolbarLayout } from '@/components/filters/hooks/useDesktopToolbarLayout'
import { useMobileSearchStuck } from '@/components/filters/hooks/useMobileSearchStuck'
import { useToolbarStuck } from '@/components/filters/hooks/useToolbarStuck'
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
        className={`sticky top-0 z-30 !mt-1 mb-1 flex flex-col gap-3 pb-1 pt-2 min-[1050px]:top-2.5 min-[1050px]:pt-2.5 ${desktopInlineLayout ? 'min-[750px]:flex-row min-[750px]:items-center' : ''}`}
        style={{
          background: 'var(--app-bg)',
          // While docked at the nav line the upward shadow masks list rows scrolling through the gap
          // above the toolbar, and it is dropped at rest so it never covers the content above the row
          boxShadow: isToolbarStuck
            ? '0 0.25rem 0 var(--app-bg), 0 -1.5rem 0 var(--app-bg)'
            : '0 0.25rem 0 var(--app-bg)',
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
