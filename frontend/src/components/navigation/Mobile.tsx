import { useCallback, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Theme } from '@/types'
import { AnimatedMobileMenuIcon } from '@/components/navigation/parts/MobileMenuIcon'
import { MOBILE_MENU_FADE_MS } from '@/components/navigation/constants/data'
import { NavigationBrand } from '@/components/navigation/parts/Brand'
import { NavigationLinks } from '@/components/navigation/parts/Links'
import { NavigationThemeToggle } from '@/components/navigation/parts/ThemeToggle'
import { NavigationUserProfile } from '@/components/navigation/parts/UserProfile'
import { NavigationVersionIndicator } from '@/components/navigation/parts/VersionIndicator'
import { useMobileNavigationEffects } from '@/components/navigation/hooks/useMobileEffects'

interface MobileNavigationProps {
  displayName: string
  initials: string
  logout: () => Promise<void>
  setTheme: (theme: Theme) => void
  theme: Theme
}

/**
 * Renders the mobile navigation toggle and full-screen navigation surface
 */
export function MobileNavigation({
  displayName,
  initials,
  logout,
  setTheme,
  theme,
}: MobileNavigationProps) {
  const [isOpen, setIsOpen] = useState(false)
  const shouldReduceMotion = useReducedMotion()
  const closeMobileNavigation = useCallback(() => setIsOpen(false), [])

  useMobileNavigationEffects({
    isOpen,
    menuId: 'mobile-primary-navigation',
    theme,
    onRequestClose: closeMobileNavigation,
  })

  return (
    <>
      <button
        id="app-mobile-navigation-toggle"
        type="button"
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-controls="mobile-primary-navigation"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="app-icon-button fixed right-4 top-4 z-50 h-11 w-11 min-[1050px]:hidden"
        style={{
          background: 'var(--app-nav-bg)',
          border: '1px solid var(--app-border)',
          color: 'var(--app-text)',
        }}
      >
        <AnimatedMobileMenuIcon isOpen={isOpen} shouldReduceMotion={shouldReduceMotion} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.nav
            id="mobile-primary-navigation"
            aria-label="Primary"
            className="fixed inset-x-0 -bottom-40 top-0 z-40 flex overscroll-contain flex-col overflow-y-auto px-5 pt-6 min-[1050px]:hidden"
            style={{
              background: 'var(--app-nav-bg)',
              color: 'var(--app-text)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0.16 : MOBILE_MENU_FADE_MS / 1000, ease: 'easeOut' }}
          >
            <motion.div
              className="flex min-h-[100dvh] flex-col pb-[calc(env(safe-area-inset-bottom)+2rem)]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.22, delay: shouldReduceMotion ? 0 : 0.16, ease: 'easeOut' }}
            >
              <div className="pr-14">
                <NavigationBrand />
              </div>

              <div className="mt-10">
                <NavigationLinks onNavigate={closeMobileNavigation} />
              </div>

              <div className="mt-auto pt-8">
                <NavigationThemeToggle
                  theme={theme}
                  setTheme={setTheme}
                  onThemeChange={closeMobileNavigation}
                />
              </div>

              <div className="pt-3">
                <NavigationUserProfile displayName={displayName} initials={initials} logout={logout} />
              </div>

              <NavigationVersionIndicator />
            </motion.div>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  )
}
