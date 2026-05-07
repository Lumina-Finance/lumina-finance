
import type { Category } from '@/api/categories'
import { DEFAULT_CATEGORY_ICON } from '@/budgets/constants'

export function categoryIcon(category: Category) {
  return category.icon ?? DEFAULT_CATEGORY_ICON
}
