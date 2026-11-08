import type { OptionItem } from '@/components/filters/OptionList'
import type { FilterValues } from '@/pages/accounts/types/accounts'
import type { AccountGroupingSettings } from '@/pages/accounts/components/toolbar/GroupingPanel'

export type AccountFilterSetter = (patch: Partial<FilterValues>) => void

export type AccountListToolbarProps = {
  search: string
  onSearchChange: (value: string) => void
  filters: FilterValues
  setFilter: AccountFilterSetter
  // Count of applied facet selections, driving the mobile filter button badge
  activeFilterCount: number
  institutionOptions: OptionItem[]
  kindOptions: OptionItem[]
  typeOptions: OptionItem[]
  grouping: AccountGroupingSettings
  onAddAccount: () => void
  // Takes where the toolbar ends once it sticks, so a group's header can stick just below it
  onStickyOffsetChange?: (offset: number) => void
}
