import { useMemo, useState } from 'react'
import { useAccountSpendingBreakdown, type Account, type SpendingRange } from '@/api/accounts'
import { getCategoryColor, getCategoryColorMap } from '@/utils/chartColor'
import { isLoadingFirstAnswer } from '@/utils/queryLoading'
import { getBreakdownRows } from '@/pages/accounts/detail/utils/spendingBreakdownViewModel'
import { SpendingBreakdownCard } from './Card'

/**
 * Renders top spending categories for one account and owns category colour mapping
 */
export function TopCategoriesBySpendingCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const breakdownQuery = useAccountSpendingBreakdown(account.id, range)
  const { data } = breakdownQuery
  const categoryColors = useMemo(
    () =>
      getCategoryColorMap(
        (data?.top_categories ?? []).map((category) => ({
          id: category.category_id,
          name: category.name,
          kind: 'expense',
        })),
      ),
    [data?.top_categories],
  )

  function handleRangeChange(nextRange: SpendingRange) {
    if (nextRange === range) return
    setRange(nextRange)
  }

  const rows = getBreakdownRows(
    data,
    (breakdown) =>
      breakdown.top_categories.map((category) => ({
        key: category.category_id,
        name: category.name,
        total: category.total,
        isOther: false,
        color:
          categoryColors.get(category.category_id || category.name) ??
          getCategoryColor({
            id: category.category_id,
            name: category.name,
            kind: 'expense',
          }),
      })),
    (breakdown) => breakdown.other_categories_count,
    (breakdown) => breakdown.categories_total_spend,
  )

  return (
    <SpendingBreakdownCard
      title="Categories by spending"
      rangeLabel="Spending range"
      range={range}
      onRangeChange={handleRangeChange}
      rows={rows}
      cardTotal={data?.categories_total_spend ?? 0}
      currency={account.currency}
      emptyLabel="No spending in this range"
      loading={isLoadingFirstAnswer(breakdownQuery)}
      transitionKey={range}
    />
  )
}
