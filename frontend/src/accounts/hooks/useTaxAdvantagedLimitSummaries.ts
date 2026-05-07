import { useMemo } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedPlan } from '@/api/taxAdvantagedPlans'
import type { TaxAdvantagedLimitSummary } from '@/accounts/types/accounts'

export function useTaxAdvantagedLimitSummaries({
  rows,
  filteredRows,
  taxAdvantagedPlans,
}: {
  rows: AccountsOverview[]
  filteredRows: AccountsOverview[]
  taxAdvantagedPlans?: TaxAdvantagedPlan[]
}) {
  const taxAdvantagedPlanById = useMemo(
    () => new Map((taxAdvantagedPlans ?? []).map((plan) => [plan.id, plan])),
    [taxAdvantagedPlans],
  )

  const linkedAccountCountByPlanId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of rows) {
      if (account.group_id !== null || !account.tax_advantaged_plan_id) continue
      if (!taxAdvantagedPlanById.has(account.tax_advantaged_plan_id)) continue
      counts.set(
        account.tax_advantaged_plan_id,
        (counts.get(account.tax_advantaged_plan_id) ?? 0) + 1,
      )
    }
    return counts
  }, [rows, taxAdvantagedPlanById])

  const taxAdvantagedLimitSummaries = useMemo<TaxAdvantagedLimitSummary[]>(() => {
    const visiblePlanIds = new Set<string>()
    for (const account of filteredRows) {
      if (account.group_id !== null || !account.tax_advantaged_plan_id) continue
      visiblePlanIds.add(account.tax_advantaged_plan_id)
    }

    return (taxAdvantagedPlans ?? [])
      .filter((plan) => visiblePlanIds.has(plan.id))
      .filter((plan) =>
        plan.current_year_contribution_limit !== null ||
        plan.current_year_withdrawal_limit !== null)
      .map((plan) => ({
        plan,
        linkedAccountCount: linkedAccountCountByPlanId.get(plan.id) ?? 0,
      }))
  }, [filteredRows, linkedAccountCountByPlanId, taxAdvantagedPlans])

  return { taxAdvantagedPlanById, taxAdvantagedLimitSummaries }
}
