import type { Category } from '@/api/categories'
import type { CategoryKind } from '@/pages/settings/components/category-settings-section/constants'
import { DEFAULT_CATEGORY_ICON } from '@/pages/settings/components/category-settings-section/constants'

/**
 * Emoji to show for a category, falling back to the shared default when it carries no icon
 */
export function displayEmoji(category: Category): string {
  return category.icon ?? DEFAULT_CATEGORY_ICON
}

/**
 * Emoji the icon picker starts on when editing a category, so an unset icon opens on the
 * default rather than on nothing
 */
export function editableEmoji(icon: string | null): string {
  return icon ?? DEFAULT_CATEGORY_ICON
}

export function displayKind(category: Category): CategoryKind {
  return category.kind
}

/**
 * Categories offered as the destination when merging one category away, labelled by whether
 * each is built in, shared with a group, or personal
 *
 * Only categories of the same kind qualify. A category owned by a group can move into a
 * built-in category or another category in that same group, and a personal one into a
 * built-in category or another personal category, so a merge never crosses ownership
 */
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
