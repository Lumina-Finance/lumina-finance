import type { OptionItem } from '@/components/filters/OptionList'
import type { FilterValues } from '@/pages/accounts/types/accounts'

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
  onAddAccount: () => void
}

export type AccountFilterOptions = {
  institutionOptions: OptionItem[]
  kindOptions: OptionItem[]
  typeOptions: OptionItem[]
}
