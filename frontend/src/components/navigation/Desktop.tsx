import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { Theme } from '@/types'
import { useNavCollapse } from '@/hooks/useNavCollapse'
import { joinClassNames } from '@/utils/classNames'
import { NavigationBrand } from '@/components/navigation/parts/Brand'
import { NavigationLinks } from '@/components/navigation/parts/Links'
import { NavigationThemeToggle } from '@/components/navigation/parts/ThemeToggle'
import { NavigationUserProfile } from '@/components/navigation/parts/UserProfile'
import { NavigationVersionIndicator } from '@/components/navigation/parts/VersionIndicator'

// Outer widths the sidebar animates between. The rail equals the icon column plus the nav's own
// padding and border, so each icon sits dead-centre without any layout shift on collapse, while the
// expanded width matches the former fixed sidebar
const RAIL_WIDTH = 74
const EXPANDED_WIDTH = 240

// A gently damped spring so the sidebar settles with a slight overshoot like the filter pills rather
// than sliding in on a flat curve
const NAV_WIDTH_TRANSITION = { type: 'spring', stiffness: 340, damping: 32, mass: 1 } as const

interface DesktopNavigationProps {
  displayName: string
  initials: string
  logout: () => Promise<void>
  setTheme: (theme: Theme) => void
  theme: Theme
}

/**
 * Renders the fixed desktop sidebar, which collapses to an icon rail when unpinned. The pinned state
 * drives the page offset, while hover or keyboard focus expands the rail as a frosted-glass overlay
 * without reflowing the page
 */
export function DesktopNavigation({
  displayName,
  initials,
  logout,
  setTheme,
  theme,
}: DesktopNavigationProps) {
  const { navExpanded, toggleNavExpanded } = useNavCollapse()
  const [previewing, setPreviewing] = useState(false)
  const shouldReduceMotion = useReducedMotion()

  // Hover or focus temporarily reveals the full menu, but only the pinned state persists
  const expanded = navExpanded || previewing

  return (
    <motion.nav
      aria-label="Primary"
      className={joinClassNames(
        'app-desktop-nav fixed left-5 z-40 hidden flex-col rounded-2xl px-4 pb-4 pt-7 min-[1050px]:flex',
        !navExpanded && 'app-desktop-nav-glass',
        !expanded && 'app-desktop-nav-collapsed',
      )}
      initial={false}
      animate={{ width: expanded ? EXPANDED_WIDTH : RAIL_WIDTH }}
      transition={shouldReduceMotion ? { duration: 0 } : NAV_WIDTH_TRANSITION}
      onHoverStart={() => setPreviewing(true)}
      onHoverEnd={() => setPreviewing(false)}
      onFocusCapture={() => setPreviewing(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreviewing(false)
      }}
    >
      <button
        type="button"
        className="app-desktop-nav-toggle app-icon-button"
        aria-label={navExpanded ? 'Collapse sidebar' : 'Keep sidebar expanded'}
        aria-pressed={navExpanded}
        onClick={toggleNavExpanded}
      >
        {navExpanded ? <PanelLeftClose size={16} aria-hidden /> : <PanelLeftOpen size={16} aria-hidden />}
      </button>

      <div className="app-desktop-nav-header mb-8 flex items-center">
        <NavigationBrand />
      </div>

      <NavigationLinks />

      <div className="mt-auto flex flex-col gap-3 pt-4">
        <div className="app-nav-theme-wrap">
          <NavigationThemeToggle theme={theme} setTheme={setTheme} />
        </div>
        <NavigationUserProfile displayName={displayName} initials={initials} logout={logout} />
        <NavigationVersionIndicator />
      </div>
    </motion.nav>
  )
}
