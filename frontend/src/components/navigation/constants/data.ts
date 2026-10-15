import {
  BarChart2,
  CreditCard,
  LayoutDashboard,
  Moon,
  Monitor,
  PieChart,
  Receipt,
  Settings,
  Sun,
} from 'lucide-react'
import type { NavigationItem, NavigationThemeOption } from '@/components/navigation/types/navigationTypes'

export const NAVIGATION_ITEMS: NavigationItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/accounts', icon: CreditCard, label: 'Accounts' },
  { to: '/transactions', icon: Receipt, label: 'Transactions' },
  { to: '/budgets', icon: PieChart, label: 'Budgets' },
  { to: '/insights', icon: BarChart2, label: 'Insights' },
]

export const PRIMARY_NAVIGATION_ITEMS: NavigationItem[] = [
  ...NAVIGATION_ITEMS,
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export const MOBILE_MENU_FADE_MS = 260

// The phone layout's menu button, fixed to the top right corner. The bars that pin to the top of a page
// read its bottom edge from here rather than from the button, which only mounts once the app reveals
export const MOBILE_NAVIGATION_TOGGLE_TOP_PX = 8
export const MOBILE_NAVIGATION_TOGGLE_SIZE_PX = 44

// The room a list toolbar leaves at its right end for the button once it nears the top: the button
// and the row's 12px gap, drawn as the toolbar's `mr-14`. The toolbar layout counts it wherever the
// button shows, so docking never changes the layout
export const MOBILE_NAVIGATION_TOGGLE_CLEARANCE_PX = MOBILE_NAVIGATION_TOGGLE_SIZE_PX + 12

// The widths that show the menu button, below the 1050px navigation breakpoint
export const MOBILE_NAVIGATION_QUERY = '(max-width: 1049.98px)'

// Shrinks the window a pinned bar's sentinel is watched against to the part below the menu button, so
// the bar makes room for the button before passing under it rather than once it reaches the very top
export const BELOW_MOBILE_NAVIGATION_TOGGLE_ROOT_MARGIN =
  `-${MOBILE_NAVIGATION_TOGGLE_TOP_PX + MOBILE_NAVIGATION_TOGGLE_SIZE_PX}px 0px 0px 0px`

export const THEME_TOGGLE_SPRING = {
  type: 'spring',
  stiffness: 500,
  damping: 38,
} as const

export const THEME_OPTIONS: NavigationThemeOption[] = [
  { value: 'light', icon: Sun, label: 'Light theme' },
  { value: 'system', icon: Monitor, label: 'System theme' },
  { value: 'dark', icon: Moon, label: 'Dark theme' },
]
