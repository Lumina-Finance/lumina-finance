import { useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import {
  useAccountSpendingBreakdown,
  type Account,
  type SpendingRange,
} from '@/api/accounts'
import {
  getDeterministicChartColor,
  getDeterministicChartColorMap,
} from '@/utils/chartColor'
import {
  getBreakdownRows,
  shouldExplainMerchantsTotal,
} from '@/pages/accounts/detail/utils/spendingBreakdownViewModel'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { SpendingBreakdownCard } from './Card'

/**
 * Explains why this card's total differs from the one on the categories card beside it
 *
 * The two figures are built from different groupings and are both correct, so the difference needs
 * saying rather than looking like an error
 */
function MerchantSpendingTotalTooltip() {
  return (
    <IconTooltip
      label="Why this total differs from the categories total"
      icon={CircleHelp}
      placement="top"
      widthClassName="w-64"
      size={13}
    >
      A merchant refunded more than it charged is left out of this total. Its category can still
      count as spending, so the Categories by Spending card can show a different figure.
    </IconTooltip>
  )
}

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
    (breakdown) => breakdown.merchants_total_spend,
  )

  return (
    <SpendingBreakdownCard
      title="Merchants by Spending"
      rangeLabel="Merchant range"
      range={range}
      onRangeChange={handleRangeChange}
      rows={rows}
      cardTotal={data?.merchants_total_spend ?? 0}
      totalTooltip={shouldExplainMerchantsTotal(data) ? <MerchantSpendingTotalTooltip /> : undefined}
      currency={account.currency}
      emptyLabel="No merchant activity in this range"
      loading={isFetching}
      transitionKey={range}
    />
  )
}
