import { useMemo, useState } from 'react'
import {
  useAccountSpendingBreakdown,
  type Account,
  type SpendingRange,
} from '@/api/accounts'
import {
  getDeterministicChartColor,
  getDeterministicChartColorMap,
} from '@/utils/chartColor'
import { getBreakdownRows } from '@/accounts/detail/utils/spendingBreakdownViewModel'
import { SpendingBreakdownCard } from './SpendingBreakdownCard'

/**
 * Renders top spending merchants for one account and owns merchant colour mapping
 */
export function TopMerchantsBySpendingCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data, isFetching } = useAccountSpendingBreakdown(account.id, range)
  const merchantColors = useMemo(() => getDeterministicChartColorMap((data?.top_merchants ?? []).map((merchant) => {
    const key = merchant.merchant_id || merchant.name

    return {
      key,
      seed: key,
    }
  })), [data?.top_merchants])

  function handleRangeChange(nextRange: SpendingRange) {
    if (nextRange === range) return
    setRange(nextRange)
  }

  const rows = getBreakdownRows(
    data,
    (breakdown) => breakdown.top_merchants.map((merchant) => {
      const key = merchant.merchant_id || merchant.name

      return {
        key,
        name: merchant.name,
        total: merchant.total,
        isOther: false,
        color: merchantColors.get(key) ?? getDeterministicChartColor(key),
      }
    }),
    (breakdown) => breakdown.other_merchants_count,
  )

  return (
    <SpendingBreakdownCard
      title="Merchants by Spending"
      rangeLabel="Merchant range"
      range={range}
      onRangeChange={handleRangeChange}
      rows={rows}
      grandTotal={data?.grand_total_spend ?? 0}
      currency={account.currency}
      emptyLabel="No merchant activity in this range"
      loading={isFetching}
      transitionKey={range}
    />
  )
}
