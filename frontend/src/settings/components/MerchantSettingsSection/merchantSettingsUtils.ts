import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { DropdownOption } from '@/components/Dropdown'
import {
  CATEGORY_KIND_LABELS,
  CATEGORY_KIND_ORDER,
  NO_CATEGORY_VALUE,
} from '@/settings/components/MerchantSettingsSection/merchantSettingsConstants'

export function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

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

export function categoryName(categoryById: Map<string, Category>, categoryId: string | null) {
  if (!categoryId) return 'No default category'
  return categoryById.get(categoryId)?.name ?? 'Unknown category'
}

export function scopeLabel(merchant: Merchant) {
  return merchant.group_id ? 'Group' : 'Personal'
}

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
