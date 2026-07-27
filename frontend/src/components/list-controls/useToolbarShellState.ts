import { useCallback, useState } from 'react'
import { useDesktopToolbarLayout } from '@/components/filters/hooks/useDesktopToolbarLayout'
import type { DesktopToolbarLayoutState } from '@/components/filters/hooks/useDesktopToolbarLayout'
import { useMobileSearchStuck } from '@/components/filters/hooks/useMobileSearchStuck'
import type { MobileSearchStuckState } from '@/components/filters/hooks/useMobileSearchStuck'
import { useToolbarStuck } from '@/components/filters/hooks/useToolbarStuck'
import type { ToolbarStuckState } from '@/components/filters/hooks/useToolbarStuck'

export type ToolbarShellState = DesktopToolbarLayoutState & MobileSearchStuckState & ToolbarStuckState & {
  isMobileSheetOpen: boolean
  // Kept mounted through the close animation so the sheet's scroll lock is only ever active while
  // the sheet exists, never on the page underneath
  isMobileSheetMounted: boolean
  openMobileSheet: () => void
  closeMobileSheet: () => void
  // Passed to the mobile sheet's onExitComplete so it unmounts once its close animation finishes
  finishMobileSheetExit: () => void
}

/**
 * Combines the desktop wrap layout, the mobile sticky search state, the toolbar dock state, and the
 * mobile filter sheet's open and mounted lifecycle shared by the account and transaction list
 * toolbars
 */
export function useToolbarShellState(): ToolbarShellState {
  const desktopLayout = useDesktopToolbarLayout()
  const mobileSearchStuck = useMobileSearchStuck()
  const toolbarStuck = useToolbarStuck()
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false)
  const [isMobileSheetMounted, setIsMobileSheetMounted] = useState(false)

  const openMobileSheet = useCallback(() => {
    setIsMobileSheetMounted(true)
    setIsMobileSheetOpen(true)
  }, [])

  const closeMobileSheet = useCallback(() => setIsMobileSheetOpen(false), [])

  function finishMobileSheetExit() {
    if (!isMobileSheetOpen) setIsMobileSheetMounted(false)
  }

  return {
    ...desktopLayout,
    ...mobileSearchStuck,
    ...toolbarStuck,
    isMobileSheetOpen,
    isMobileSheetMounted,
    openMobileSheet,
    closeMobileSheet,
    finishMobileSheetExit,
  }
}
