import { Landmark, LifeBuoy, Store, Tag, Tags, User as UserIcon, type LucideIcon } from 'lucide-react'

export type SettingsSectionId = 'profile' | 'runway' | 'categories' | 'merchants' | 'tags' | 'tax-advantaged-categories'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  icon: LucideIcon
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'runway', label: 'Runway', icon: LifeBuoy },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'merchants', label: 'Merchants', icon: Store },
  { id: 'tags', label: 'Tags', icon: Tags },
  { id: 'tax-advantaged-categories', label: 'Tax-Advantaged Categories', icon: Landmark },
]
