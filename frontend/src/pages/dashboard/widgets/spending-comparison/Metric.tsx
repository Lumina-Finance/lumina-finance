import {
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react'
import { AppScrambledNumber } from '@/components/display/ScrambledNumber'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { getSpendingDeltaDisplay } from '@/pages/dashboard/utils/getSpendingDeltaDisplay'

type SpendingComparisonMetricProps = {
  spentToDate: number
  spendingDeltaPct: number | null
  spendingDeltaText: string
  displayCurrency: string
}

/**
 * Renders the current spending total and its previous-period percentage delta
 */
export function SpendingComparisonMetric({
  spentToDate,
  spendingDeltaPct,
  spendingDeltaText,
  displayCurrency,
}: SpendingComparisonMetricProps) {
  const { formatCurrency } = useMoneyFormatters()
  const delta = spendingDeltaPct == null ? null : getSpendingDeltaDisplay(spendingDeltaPct)

  return (
    <div className="flex items-baseline gap-2">
      <p className="font-financial text-3xl font-normal leading-none tracking-tight max-[1000px]:text-[1.6875rem]">
        <AppScrambledNumber text={formatCurrency(spentToDate, displayCurrency)} />
      </p>
      {delta && (
        <div
          className="flex items-center text-sm font-medium max-[1000px]:text-[0.7875rem]"
          style={{ color: delta.color }}
        >
          {delta.arrow === 'down' && <ArrowDownRight size={14} aria-hidden />}
          {delta.arrow === 'up' && <ArrowUpRight size={14} aria-hidden />}
          <AppScrambledNumber text={spendingDeltaText} />
        </div>
      )}
    </div>
  )
}
