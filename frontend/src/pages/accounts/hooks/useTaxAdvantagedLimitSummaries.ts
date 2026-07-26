import { useMemo } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { getTaxAdvantagedLimitSummaries } from '@/pages/accounts/utils/taxAdvantagedLimits'

/**
 * Builds tax-advantaged lookup and limit summary data for the accounts overview
 */
export function useTaxAdvantagedLimitSummaries({
  rows,
  taxAdvantagedCategories,
}: {
  rows: AccountsOverview[]
  taxAdvantagedCategories?: TaxAdvantagedCategory[]
}) {
  const taxAdvantagedCategoryById = useMemo(
    () => new Map((taxAdvantagedCategories ?? []).map((plan) => [plan.id, plan])),
    [taxAdvantagedCategories],
  )

  const taxAdvantagedLimitSummaries = useMemo(
    () => getTaxAdvantagedLimitSummaries(rows, taxAdvantagedCategories ?? []),
    [rows, taxAdvantagedCategories],
  )

  return { taxAdvantagedCategoryById, taxAdvantagedLimitSummaries }
}
