import { useMemo } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import type { TaxAdvantagedLimitSummary } from '@/accounts/types/accounts'

export function useTaxAdvantagedLimitSummaries({
  rows,
  filteredRows,
  taxAdvantagedCategories,
}: {
  rows: AccountsOverview[]
  filteredRows: AccountsOverview[]
  taxAdvantagedCategories?: TaxAdvantagedCategory[]
}) {
  const taxAdvantagedCategoryById = useMemo(
    () => new Map((taxAdvantagedCategories ?? []).map((plan) => [plan.id, plan])),
    [taxAdvantagedCategories],
  )

  const linkedAccountCountByPlanId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of rows) {
      if (account.group_id !== null || !account.tax_advantaged_category_id) continue
      if (!taxAdvantagedCategoryById.has(account.tax_advantaged_category_id)) continue
      counts.set(
        account.tax_advantaged_category_id,
        (counts.get(account.tax_advantaged_category_id) ?? 0) + 1,
      )
    }
    return counts
  }, [rows, taxAdvantagedCategoryById])

  const taxAdvantagedLimitSummaries = useMemo<TaxAdvantagedLimitSummary[]>(() => {
    const visiblePlanIds = new Set<string>()
    for (const account of filteredRows) {
      if (account.group_id !== null || !account.tax_advantaged_category_id) continue
      visiblePlanIds.add(account.tax_advantaged_category_id)
    }

    return (taxAdvantagedCategories ?? [])
      .filter((plan) => visiblePlanIds.has(plan.id))
      .filter((plan) =>
        plan.current_year_contribution_limit !== null ||
        plan.current_year_withdrawal_limit !== null ||
        plan.lifetime_contribution_limit !== null ||
        plan.accrued_lifetime_contribution_limit !== null)
      .map((plan) => ({
        plan,
        linkedAccountCount: linkedAccountCountByPlanId.get(plan.id) ?? 0,
      }))
  }, [filteredRows, linkedAccountCountByPlanId, taxAdvantagedCategories])

  return { taxAdvantagedCategoryById, taxAdvantagedLimitSummaries }
}
