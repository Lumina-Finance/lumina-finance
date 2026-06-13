import type { DropdownCreateLabel, DropdownOption, DropdownOptionGroup } from './types'

interface VisibleDropdownOptionsParams {
  filterOptions: boolean
  hideOptionsWhileLoading: boolean
  options: DropdownOption[]
  searchable: boolean
  searchText: string
  showLoading: boolean
}

/**
 * Finds the selected option while allowing callers to pass a selected value that has not been loaded into the current page of options
 */
export function getSelectedDropdownOption(
  options: DropdownOption[],
  selectedOption: DropdownOption | undefined,
  value: string,
): DropdownOption | undefined {
  return options.find((option) => option.value === value) ?? (
    selectedOption?.value === value ? selectedOption : undefined
  )
}

/**
 * Applies client-side search and loading visibility rules before the menu renders options
 */
export function getVisibleDropdownOptions({
  filterOptions,
  hideOptionsWhileLoading,
  options,
  searchable,
  searchText,
  showLoading,
}: VisibleDropdownOptionsParams): DropdownOption[] {
  if (showLoading && hideOptionsWhileLoading) return []
  if (!filterOptions || !searchable || !searchText) return options

  const normalizedSearch = searchText.toLowerCase()
  return options.filter((option) => option.label.toLowerCase().includes(normalizedSearch))
}

/**
 * Groups adjacent options by their group label so sticky headers cover the same flat option indexes used by keyboard navigation
 */
export function getGroupedDropdownOptions(options: DropdownOption[]): DropdownOptionGroup[] | null {
  if (!options.some((option) => option.group)) return null

  const groups: DropdownOptionGroup[] = []
  let currentGroup: string | undefined

  options.forEach((option, index) => {
    if (groups.length === 0 || option.group !== currentGroup) {
      currentGroup = option.group
      groups.push({ label: option.group ?? '', items: [] })
    }

    groups[groups.length - 1].items.push({ option, flatIndex: index })
  })

  return groups
}

/**
 * Keeps keyboard selection on the first visible option when auto-highlighting is enabled and the current index is unusable
 */
export function getEffectiveHighlightedIndex(
  autoHighlightFirstOption: boolean,
  highlightedIndex: number,
  visibleOptionsLength: number,
): number {
  if (
    autoHighlightFirstOption &&
    visibleOptionsLength > 0 &&
    (highlightedIndex < 0 || highlightedIndex >= visibleOptionsLength)
  ) {
    return 0
  }

  return highlightedIndex
}

/**
 * Resolves the create action label from static text, a query-aware formatter, or the default dropdown wording
 */
export function getCreateNewLabel(
  createNewLabel: DropdownCreateLabel | undefined,
  createQuery: string,
): string {
  if (typeof createNewLabel === 'function') return createNewLabel(createQuery)
  return createNewLabel ?? (createQuery ? `Create "${createQuery}"` : 'Create new')
}

