import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import {
  CATEGORY_KIND_LABELS,
  CATEGORY_KIND_ORDER,
  NO_CATEGORY_VALUE,
} from '@/pages/settings/components/merchant-settings-section/constants'

/**
 * Builds the default-category dropdown options for a merchant, grouped by kind with a "no
 * default category" choice listed first
 */
export function categoryOptions(categories: Category[]): DropdownOption[] {
  return [
    { value: NO_CATEGORY_VALUE, label: 'No default category', group: 'Default' },
    ...CATEGORY_KIND_ORDER.flatMap((kind) =>
      categories
        .filter((category) => category.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((category) => ({
          value: category.id,
          label: category.name,
          group: CATEGORY_KIND_LABELS[kind],
          icon: category.icon,
        })),
    ),
  ]
}

/**
 * Name to show for a merchant's default category, distinguishing having none set from pointing
 * at a category that can no longer be found
 */
export function categoryName(categoryById: Map<string, Category>, categoryId: string | null) {
  if (!categoryId) return 'No default category'
  return categoryById.get(categoryId)?.name ?? 'Unknown category'
}

/**
 * Label for whether a merchant is shared with a group or belongs to the current user alone
 */
export function scopeLabel(merchant: Merchant) {
  return merchant.group_id ? 'Group' : 'Personal'
}

/**
 * Merchants offered as the destination when merging one merchant away, labelled by whether
 * each is shared with a group or personal
 *
 * Only merchants in the same group as the one being replaced qualify, or only personal
 * merchants when the original has no group, so a merge never crosses ownership
 */
export function merchantMergeOptions(merchant: Merchant, merchants: Merchant[]): DropdownOption[] {
  return merchants
    .filter((option) => {
      if (option.id === merchant.id) return false
      return merchant.group_id
        ? option.group_id === merchant.group_id
        : option.group_id === null
    })
    .map((option) => ({
      value: option.id,
      label: option.name,
      group: option.group_id ? 'Group' : 'Personal',
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
