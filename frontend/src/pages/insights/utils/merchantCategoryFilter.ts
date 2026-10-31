import type { Category } from '@/api/categories'
import type { OptionItem } from '@/components/filters/OptionList'
import { DEFAULT_TRANSACTION_CATEGORY_ICON } from '@/components/transactions/constants/transactionList'

/**
 * Builds the merchant distribution's category options: expense categories only, since the map
 * counts expense spending alone, sorted by name
 */
export function getMerchantCategoryOptions(categories: Category[] | undefined): OptionItem[] {
  return (categories ?? [])
    .filter((category) => category.kind === 'expense')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((category) => ({
      value: category.id,
      label: category.name,
      icon: category.icon ?? DEFAULT_TRANSACTION_CATEGORY_ICON,
    }))
}

/**
 * Drops chosen categories that no longer exist, such as one merged away in another tab, so the
 * map is never narrowed by a category the user cannot see or clear. Until the categories load,
 * every choice is kept
 */
export function keepExistingCategoryIds(
  selectedIds: string[],
  options: OptionItem[],
  categoriesLoaded: boolean,
): string[] {
  if (!categoriesLoaded) return selectedIds
  const existing = new Set(options.map((option) => option.value))
  const kept = selectedIds.filter((id) => existing.has(id))
  return kept.length === selectedIds.length ? selectedIds : kept
}
