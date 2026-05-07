
import { useMemo } from 'react'
import type { BaseBudget, Budget } from '@/api/budgets'
import type { BudgetCardViewModel } from '@/budgets/types'

export function useBudgetCards({
  baseBudgets,
  periods,
  categoryById,
}: {
  baseBudgets: BaseBudget[] | undefined
  periods: Budget[] | undefined
  categoryById: Map<string, string>
}) {
  return useMemo<BudgetCardViewModel[]>(() => {
    const baseById = new Map<string, BaseBudget>()
    const periodsByBase = new Map<string, Budget[]>()

    // Base budgets can exist before any periods do; merge both API payloads so
    // those budgets still render as cards.
    for (const baseBudget of baseBudgets ?? []) {
      baseById.set(baseBudget.id, baseBudget)
    }

    for (const period of periods ?? []) {
      baseById.set(period.base_budget_id, period.base_budget)
      const existingPeriods = periodsByBase.get(period.base_budget_id) ?? []
      existingPeriods.push(period)
      periodsByBase.set(period.base_budget_id, existingPeriods)
    }

    return Array.from(baseById.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((baseBudget) => {
        const budgetPeriods = (periodsByBase.get(baseBudget.id) ?? [])
          .slice()
          .sort((a, b) => b.period_start.localeCompare(a.period_start))
        return {
          baseBudget,
          periods: budgetPeriods,
          latestPeriod: budgetPeriods[0],
          categoryNames: baseBudget.category_ids
            .map((categoryId) => categoryById.get(categoryId))
            .filter((name): name is string => Boolean(name)),
        }
      })
  }, [baseBudgets, periods, categoryById])
}
