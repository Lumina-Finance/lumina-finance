import { Landmark, LifeBuoy, Link2, Shield, Store, Tag, Tags, User as UserIcon, type LucideIcon } from 'lucide-react'
import { offersBankSync, type BankProvidersResponse } from '@/api/bank-sync'
import type { FeatureCoverState } from '@/components/feature-cover/useFeatureCover'

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
 * The sections the settings page shows. Bank connections shows only while the deployment offers bank
 * sync to the user, as the account page's bank link section does. Wherever it offers none, settings
 * leaves Bank connections out, unless the build's screen covers the section.
 * While the build waits to learn whether to cover it, the section draws nothing, so it stays out of
 * the list until then and a link to the section scrolls there once the section is drawn
 *
 * @param providers - The deployment's providers and whether the user may link, undefined until read
 * @param bankSyncCover - Whether the section shows as it is, waits, or shows the build's screen
 */
export function listSettingsSections(
  providers: BankProvidersResponse | undefined,
  bankSyncCover: FeatureCoverState['status'],
): SettingsSection[] {
  const showsBankConnections = bankSyncCover === 'covered' || (bankSyncCover === 'shown' && offersBankSync(providers))
  return showsBankConnections
    ? SETTINGS_SECTIONS
    : SETTINGS_SECTIONS.filter((section) => section.id !== 'bank-connections')
}
