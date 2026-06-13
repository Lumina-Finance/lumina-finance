import type { LucideIcon } from 'lucide-react'
import type { Theme } from '@/types'

export interface NavigationItem {
  to: string
  icon: LucideIcon
  label: string
}

export interface NavigationThemeOption {
  value: Theme
  icon: LucideIcon
  label: string
}

