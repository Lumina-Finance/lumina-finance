import type { Category } from '@/api/categories'
import type { CategoryKind } from '@/pages/settings/components/category-settings-section/categorySettingsConstants'
import { DEFAULT_CATEGORY_ICON } from '@/pages/settings/components/category-settings-section/categorySettingsConstants'

export function displayEmoji(category: Category): string {
  return category.icon ?? DEFAULT_CATEGORY_ICON
}

export function editableEmoji(icon: string | null): string {
  return icon ?? DEFAULT_CATEGORY_ICON
}

export function displayKind(category: Category): CategoryKind {
  return category.kind
}

export function categoryMergeOptions(category: Category, categories: Category[]) {
  return categories
    .filter((option) => {
      if (option.id === category.id || option.kind !== category.kind) return false
      if (category.group_id) return option.is_system || option.group_id === category.group_id
      return option.is_system || (!option.is_system && option.group_id === null)
    })
    .map((option) => ({
      value: option.id,
      label: option.name,
      icon: option.icon,
      group: option.is_system ? 'System' : option.group_id ? 'Group' : 'Personal',
    }))
}
