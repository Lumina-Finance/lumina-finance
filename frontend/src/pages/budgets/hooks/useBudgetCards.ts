import { useMemo } from 'react'
import type { BaseBudget, Budget } from '@/api/budgets'
import type { BudgetCardViewModel } from '@/pages/budgets/types'

/**
 * Builds stable budget card view models from base budgets and their latest period
 */
export function useBudgetCards({
  baseBudgets,
  latestPeriods,
  categoryById,
}: {
  baseBudgets: BaseBudget[] | undefined
  latestPeriods: Budget[] | undefined
  categoryById: Map<string, string>
}) {
  return useMemo<BudgetCardViewModel[]>(() => {
    const baseById = new Map<string, BaseBudget>()
    const latestPeriodByBase = new Map<string, Budget>()

    // Base budgets can exist before any periods do, so merge both API payloads before deriving cards
    for (const baseBudget of baseBudgets ?? []) {
      baseById.set(baseBudget.id, baseBudget)
    }

    for (const period of latestPeriods ?? []) {
      baseById.set(period.base_budget_id, period.base_budget)
      latestPeriodByBase.set(period.base_budget_id, period)
    }

    return Array.from(baseById.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((baseBudget) => ({
        baseBudget,
        latestPeriod: latestPeriodByBase.get(baseBudget.id),
        categoryNames: baseBudget.category_ids
          .map((categoryId) => categoryById.get(categoryId))
          .filter((name): name is string => Boolean(name)),
      }))
  }, [baseBudgets, latestPeriods, categoryById])
}
