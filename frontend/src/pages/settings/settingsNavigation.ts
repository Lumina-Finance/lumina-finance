import { Landmark, LifeBuoy, Link2, Shield, Store, Tag, Tags, User as UserIcon, type LucideIcon } from 'lucide-react'

export type SettingsSectionId =
  | 'profile'
  | 'security'
  | 'runway'
  | 'bank-connections'
  | 'categories'
  | 'merchants'
  | 'tags'
  | 'tax-advantaged-categories'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  icon: LucideIcon
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'runway', label: 'Runway', icon: LifeBuoy },
  { id: 'bank-connections', label: 'Bank connections', icon: Link2 },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'merchants', label: 'Merchants', icon: Store },
  { id: 'tags', label: 'Tags', icon: Tags },
  { id: 'tax-advantaged-categories', label: 'Tax-advantaged categories', icon: Landmark },
]

/**
 * The sections the settings page shows, leaving out Bank connections for a user the bank-linking
 * check refuses
 *
 * @param mayLinkBanks - The check's answer, or undefined while it loads. Undefined keeps the section so
 * it doesn't appear late for everyone it is meant for
 */
export function listSettingsSections(mayLinkBanks: boolean | undefined): SettingsSection[] {
  return mayLinkBanks === false
    ? SETTINGS_SECTIONS.filter((section) => section.id !== 'bank-connections')
    : SETTINGS_SECTIONS
}
