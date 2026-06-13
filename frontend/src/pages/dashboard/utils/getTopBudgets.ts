import type { LatestBudgetUtilization } from '@/api/budgets'
import type { TopBudget } from '@/pages/dashboard/types/dashboard'

/**
 * Ranks latest-period budget utilizations by exact usage ratio
 * The rounded percentage is display-only and does not affect ordering
 */
export function getTopBudgets(
  latestBudgetUtilizations: LatestBudgetUtilization[] | undefined,
): TopBudget[] {
  return (latestBudgetUtilizations ?? [])
    .map((utilization): TopBudget => {
      const usageRatio = utilization.overall_limit > 0
        ? utilization.total_spent / utilization.overall_limit
        : 0
      const usagePct = Math.round(usageRatio * 100)

      return {
        budget_id: utilization.budget_id,
        base_budget_id: utilization.base_budget_id,
        name: utilization.name,
        currency: utilization.currency,
        period_end: utilization.period_end,
        overall_limit: utilization.overall_limit,
        total_spent: utilization.total_spent,
        fx_status: utilization.fx_status,
        usageRatio,
        usagePct,
      }
    })
    .sort((a, b) => {

      // Sort by exact ratio first so display rounding cannot misorder close
      // budgets while total spent is only the tie-breaker
      if (b.usageRatio !== a.usageRatio) return b.usageRatio - a.usageRatio
      return b.total_spent - a.total_spent
    })
    .slice(0, 3)
}
