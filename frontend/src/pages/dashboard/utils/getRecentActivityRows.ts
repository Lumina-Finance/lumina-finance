import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'

type RecentActivityCategory = Pick<Category, 'name' | 'kind'>

export type RecentActivityRow = {
  transaction: Transaction
  category: RecentActivityCategory | undefined
  title: string
  isIncome: boolean
}

/**
 * Builds a category lookup with only the fields used by recent activity rows
 */
function getRecentActivityCategoryMap(categories: Category[] | undefined) {
  const map = new Map<string, RecentActivityCategory>()
  categories?.forEach((category) => {
    map.set(category.id, { name: category.name, kind: category.kind })
  })
  return map
}

/**
 * Builds the dashboard recent activity rows with title fallbacks and category metadata
 */
export function getRecentActivityRows(
  transactions: Transaction[] | undefined,
  categories: Category[] | undefined,
  limit = 5,
): RecentActivityRow[] {
  const categoryMap = getRecentActivityCategoryMap(categories)
  return (transactions ?? []).slice(0, limit).map((transaction) => {
    const category = categoryMap.get(transaction.category_id)
    const title = transaction.merchant_name ?? transaction.notes ?? category?.name ?? 'Transaction'

    return {
      transaction,
      category,
      title,
      isIncome: category?.kind === 'income',
    }
  })
}
