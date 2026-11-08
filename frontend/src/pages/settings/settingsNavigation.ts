import { Landmark, LifeBuoy, Link2, Shield, Store, Tag, Tags, User as UserIcon, type LucideIcon } from 'lucide-react'
import { offersBankSync, type BankProvidersResponse } from '@/api/bank-sync'

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
 * Returns whether a section opened from a link is held at the top of the screen while the page grows
 *
 * Only Bank connections is, since the account page's Open settings link scrolls it to the top and the
 * sections above it load after the page opens. A link to any other section scrolls once and leaves the
 * page where the reader takes it
 */
export function isHeldWhenLinked(id: SettingsSectionId): boolean {
  return id === 'bank-connections'
}

/**
 * The sections the settings page shows. Bank connections shows only while the deployment offers bank
 * sync to the user, as the account page's bank link section does. Wherever it offers none, settings is
 * as it was before bank sync
 *
 * @param providers - The deployment's providers and whether the user may link, undefined until read
 */
export function listSettingsSections(providers: BankProvidersResponse | undefined): SettingsSection[] {
  return offersBankSync(providers)
    ? SETTINGS_SECTIONS
    : SETTINGS_SECTIONS.filter((section) => section.id !== 'bank-connections')
}
