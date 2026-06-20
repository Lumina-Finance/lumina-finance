/**
 * Shared shape for a selectable filter option, used by the transaction and account filter panels to
 * back their multi-select checklists and active-filter chips
 */
export interface OptionItem {
  value: string
  label: string
  group?: string
  icon?: string | null
}
