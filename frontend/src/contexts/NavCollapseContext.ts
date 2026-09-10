import { createContext } from 'react'

export interface NavCollapseValue {
  // Pinned expanded state, persisted and mirrored by the page content offset. Hover expansion is
  // local to the navigation and deliberately excluded here so it never reflows the page
  navExpanded: boolean
  toggleNavExpanded: () => void
}

export const NavCollapseContext = createContext<NavCollapseValue | null>(null)
