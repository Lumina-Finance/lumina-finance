import { useEffect } from 'react'
import type { Theme } from '@/types'

interface UseMobileNavigationEffectsParams {
  isOpen: boolean
  menuId: string
  theme: Theme
  onRequestClose: () => void
}

/**
 * Applies mobile navigation browser effects while the full-screen menu is open
 */
export function useMobileNavigationEffects({
  isOpen,
  menuId,
  theme,
  onRequestClose,
}: UseMobileNavigationEffectsParams) {
  useEffect(() => {
    if (!isOpen) return

    const root = document.documentElement
    const navBackground = getComputedStyle(root).getPropertyValue('--app-nav-bg').trim() || '#F8F4EC'
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = root.style.overflow
    const previousRootBackground = root.style.backgroundColor
    const previousRootOverscroll = root.style.overscrollBehavior
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    let themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const hadThemeColorMeta = Boolean(themeColorMeta)
    const previousThemeColor = themeColorMeta?.content ?? ''

    root.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    document.body.style.setProperty('--app-mobile-nav-bg-current', navBackground)
    document.body.classList.add('app-mobile-nav-open')
    root.style.backgroundColor = navBackground

    if (!themeColorMeta) {
      themeColorMeta = document.createElement('meta')
      themeColorMeta.name = 'theme-color'
      document.head.appendChild(themeColorMeta)
    }
    themeColorMeta.content = navBackground

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onRequestClose()
    }
    const handleTouchMove = (event: TouchEvent) => {
      const menu = document.getElementById(menuId)
      if (menu?.contains(event.target as Node)) return
      event.preventDefault()
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      document.body.style.overflow = previousOverflow
      root.style.overflow = previousRootOverflow
      root.style.overscrollBehavior = previousRootOverscroll
      document.body.style.overscrollBehavior = previousBodyOverscroll
      document.body.classList.remove('app-mobile-nav-open')
      document.body.style.removeProperty('--app-mobile-nav-bg-current')
      root.style.backgroundColor = previousRootBackground
      if (themeColorMeta) {
        if (hadThemeColorMeta) {
          themeColorMeta.content = previousThemeColor
        } else {
          themeColorMeta.remove()
        }
      }
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('touchmove', handleTouchMove)
    }
  }, [isOpen, menuId, onRequestClose, theme])
}

