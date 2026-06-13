import { useEffect, useRef } from 'react'

type MobileFilterSheetEffectsOptions = {
  isOpen: boolean
  onClose: () => void
}

/**
 * Owns page-level browser effects while the mobile filter sheet is mounted
 */
export function useMobileFilterSheetEffects({
  isOpen,
  onClose,
}: MobileFilterSheetEffectsOptions) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return undefined

    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const panel = panelRef.current
      if (!panel || panel.contains(event.target as Node)) return
      onClose()
    }

    document.addEventListener('pointerdown', dismissOnOutsidePointer)

    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    const root = document.documentElement
    const blurTarget = document.getElementById('app-page-content')
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = root.style.overflow
    const previousRootOverscroll = root.style.overscrollBehavior
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    const previousBlurTargetFilter = blurTarget?.style.filter ?? ''
    const previousBlurTargetOpacity = blurTarget?.style.opacity ?? ''
    const previousBlurTargetTransition = blurTarget?.style.transition ?? ''
    const previousBlurTargetWillChange = blurTarget?.style.willChange ?? ''
    const previousMobileNavigationToggleOpacity = mobileNavigationToggle?.style.opacity ?? ''
    const previousMobileNavigationTogglePointerEvents = mobileNavigationToggle?.style.pointerEvents ?? ''
    const previousMobileNavigationToggleTransition = mobileNavigationToggle?.style.transition ?? ''
    const previousMobileNavigationToggleWillChange = mobileNavigationToggle?.style.willChange ?? ''

    root.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    if (blurTarget) {
      blurTarget.style.transition = 'filter 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)'
      blurTarget.style.willChange = 'filter, opacity'
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
      if (blurTarget) {
        blurTarget.style.filter = previousBlurTargetFilter
        blurTarget.style.opacity = previousBlurTargetOpacity
        blurTarget.style.transition = previousBlurTargetTransition
        blurTarget.style.willChange = previousBlurTargetWillChange
      }
      if (mobileNavigationToggle) {
        mobileNavigationToggle.style.opacity = previousMobileNavigationToggleOpacity
        mobileNavigationToggle.style.pointerEvents = previousMobileNavigationTogglePointerEvents
        mobileNavigationToggle.style.transition = previousMobileNavigationToggleTransition
        mobileNavigationToggle.style.willChange = previousMobileNavigationToggleWillChange
      }
    }
  }, [])

  useEffect(() => {
    const blurTarget = document.getElementById('app-page-content')
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    if (!blurTarget && !mobileNavigationToggle) return undefined

    const frame = window.requestAnimationFrame(() => {
      if (blurTarget) {
        blurTarget.style.filter = isOpen ? 'blur(7px)' : 'blur(0px)'
        blurTarget.style.opacity = isOpen ? '0.76' : '1'
      }
      if (mobileNavigationToggle) {
        mobileNavigationToggle.style.opacity = isOpen ? '0' : '1'
        mobileNavigationToggle.style.pointerEvents = isOpen ? 'none' : 'auto'
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isOpen])

  return panelRef
}
