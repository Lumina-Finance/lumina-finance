
import type { Category } from '@/api/categories'
import { DEFAULT_CATEGORY_ICON } from '@/pages/budgets/constants'

/**
 * Returns the category's configured icon, falling back to the default icon when none is set
 */
export function categoryIcon(category: Category) {
  return category.icon ?? DEFAULT_CATEGORY_ICON
}
