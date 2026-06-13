import type { Theme } from '@/types'
import { NavigationBrand } from '@/components/navigation/parts/Brand'
import { NavigationLinks } from '@/components/navigation/parts/Links'
import { NavigationThemeToggle } from '@/components/navigation/parts/ThemeToggle'
import { NavigationUserProfile } from '@/components/navigation/parts/UserProfile'
import { NavigationVersionIndicator } from '@/components/navigation/parts/VersionIndicator'

interface DesktopNavigationProps {
  displayName: string
  initials: string
  logout: () => Promise<void>
  setTheme: (theme: Theme) => void
  theme: Theme
}

/**
 * Renders the fixed desktop sidebar navigation
 */
export function DesktopNavigation({
  displayName,
  initials,
  logout,
  setTheme,
  theme,
}: DesktopNavigationProps) {
  return (
    <nav
      aria-label="Primary"
      className="app-desktop-nav fixed left-5 z-30 hidden w-60 flex-col rounded-2xl px-4 pb-4 pt-7 min-[1050px]:flex"
      style={{
        background: 'var(--app-nav-bg)',
        border: '1px solid var(--app-border)',
        boxShadow: 'var(--app-shadow-soft)',
      }}
    >
      <div className="mb-8">
        <NavigationBrand />
      </div>

      <NavigationLinks />

      <div className="mt-auto pt-4">
        <NavigationThemeToggle theme={theme} setTheme={setTheme} />
      </div>

      <div className="pt-3">
        <NavigationUserProfile displayName={displayName} initials={initials} logout={logout} />
      </div>

      <NavigationVersionIndicator />
    </nav>
  )
}
