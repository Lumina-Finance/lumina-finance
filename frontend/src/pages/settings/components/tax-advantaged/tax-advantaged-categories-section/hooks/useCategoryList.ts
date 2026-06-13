import { useMemo } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import {
  currentYearForTimezone,
  formatTaxTreatment,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'

export function useTaxAdvantagedCategoryList({
  accounts,
  plans,
  search,
  userTimezone,
}: {
  accounts: AccountsOverview[]
  plans: TaxAdvantagedCategory[]
  search: string
  userTimezone?: string
}) {
  const currentYear = useMemo(() => currentYearForTimezone(userTimezone), [userTimezone])
  const linkedAccountCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of accounts) {
      if (!account.tax_advantaged_category_id) continue
      counts.set(account.tax_advantaged_category_id, (counts.get(account.tax_advantaged_category_id) ?? 0) + 1)
    }
    return counts
  }, [accounts])
  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return plans
    return plans.filter((plan) =>
      plan.name.toLowerCase().includes(q)
      || plan.currency.toLowerCase().includes(q)
      || formatTaxTreatment(plan.tax_treatment).toLowerCase().includes(q),
    )
  }, [plans, search])

  return { currentYear, filteredPlans, linkedAccountCounts }
}

