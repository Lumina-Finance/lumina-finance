import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { DesktopNavigation } from '@/components/navigation/DesktopNavigation'
import { MobileNavigation } from '@/components/navigation/MobileNavigation'
import {
  getNavigationDisplayName,
  getNavigationInitials,
} from '@/components/navigation/utils/navigationLabels'

/**
 * Composes desktop and mobile navigation from authenticated user and theme state
 */
const Navigation = () => {
  const { theme, setTheme } = useTheme()
  const { user, logout } = useAuth()
  const displayName = getNavigationDisplayName(user)
  const initials = getNavigationInitials(user)

  return (
    <>
      <DesktopNavigation
        theme={theme}
        setTheme={setTheme}
        displayName={displayName}
        initials={initials}
        logout={logout}
      />
      <MobileNavigation
        theme={theme}
        setTheme={setTheme}
        displayName={displayName}
        initials={initials}
        logout={logout}
      />
    </>
  )
}

export default Navigation
