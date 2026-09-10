import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavCollapseContext, type NavCollapseValue } from '@/contexts/NavCollapseContext'

const NAV_EXPANDED_KEY = 'lumina:settings:navExpanded'

/**
 * Reads the persisted pinned state, treating a missing value as expanded so first-time users keep
 * the full sidebar
 */
function readStoredNavExpanded(): boolean {
  return localStorage.getItem(NAV_EXPANDED_KEY) !== 'false'
}

/**
 * Shares the pinned desktop-navigation expand state across the sidebar and the page content offset,
 * which render in separate trees, and persists it to local storage
 */
export function NavCollapseProvider({ children }: { children: ReactNode }) {
  const [navExpanded, setNavExpanded] = useState(readStoredNavExpanded)

  useEffect(() => {
    localStorage.setItem(NAV_EXPANDED_KEY, String(navExpanded))
  }, [navExpanded])

  const value = useMemo<NavCollapseValue>(
    () => ({ navExpanded, toggleNavExpanded: () => setNavExpanded((current) => !current) }),
    [navExpanded],
  )

  return <NavCollapseContext.Provider value={value}>{children}</NavCollapseContext.Provider>
}
