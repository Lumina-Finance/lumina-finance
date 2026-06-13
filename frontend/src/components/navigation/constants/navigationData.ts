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
