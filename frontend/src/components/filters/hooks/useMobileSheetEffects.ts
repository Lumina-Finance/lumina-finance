import { useEffect, useRef } from 'react'
import { isInsideFloatingLayer } from '@/utils/floatingLayer'

type MobileFilterSheetEffectsOptions = {
  isOpen: boolean
  onClose: () => void
  // A full-screen sheet disables this: setting overflow hidden on the page strips a sticky toolbar
  // back to its in-flow position, and the sheet already covers the page so no lock is needed
  lockScroll?: boolean
}

/**
 * Owns page-level browser effects while the mobile filter sheet is mounted
 */
export function useMobileFilterSheetEffects({
  isOpen,
  onClose,
  lockScroll = true,
}: MobileFilterSheetEffectsOptions) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return undefined

    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const panel = panelRef.current

      // A popover opened from inside the sheet portals out of it, so a press on one lands outside
      // the panel node while still belonging to the sheet
      if (!panel || panel.contains(event.target as Node) || isInsideFloatingLayer(event.target)) return

      onClose()
    }

    document.addEventListener('pointerdown', dismissOnOutsidePointer)

    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    const root = document.documentElement
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = root.style.overflow
    const previousRootOverscroll = root.style.overscrollBehavior
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    const previousMobileNavigationToggleOpacity = mobileNavigationToggle?.style.opacity ?? ''
    const previousMobileNavigationTogglePointerEvents = mobileNavigationToggle?.style.pointerEvents ?? ''
    const previousMobileNavigationToggleTransition = mobileNavigationToggle?.style.transition ?? ''
    const previousMobileNavigationToggleWillChange = mobileNavigationToggle?.style.willChange ?? ''

    if (lockScroll) {
      root.style.overflow = 'hidden'
      root.style.overscrollBehavior = 'none'
      document.body.style.overflow = 'hidden'
      document.body.style.overscrollBehavior = 'none'
    }
    if (mobileNavigationToggle) {
      mobileNavigationToggle.style.transition = 'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)'
      mobileNavigationToggle.style.willChange = 'opacity'
    }

    return () => {
      root.style.overflow = previousRootOverflow
      root.style.overscrollBehavior = previousRootOverscroll
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousBodyOverscroll
      if (mobileNavigationToggle) {
        mobileNavigationToggle.style.opacity = previousMobileNavigationToggleOpacity
        mobileNavigationToggle.style.pointerEvents = previousMobileNavigationTogglePointerEvents
        mobileNavigationToggle.style.transition = previousMobileNavigationToggleTransition
        mobileNavigationToggle.style.willChange = previousMobileNavigationToggleWillChange
      }
    }
  }, [lockScroll])

  useEffect(() => {
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    if (!mobileNavigationToggle) return undefined

    const frame = window.requestAnimationFrame(() => {
      mobileNavigationToggle.style.opacity = isOpen ? '0' : '1'
      mobileNavigationToggle.style.pointerEvents = isOpen ? 'none' : 'auto'
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isOpen])

  return panelRef
}
