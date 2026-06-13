import {
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { formatCurrency } from '@/utils/formatCurrency'

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
  return (
    <div className="flex items-baseline gap-2">
      <p className="font-financial text-3xl font-normal leading-none tracking-tight max-[1000px]:text-[1.6875rem]">
        <AppScrambledNumber text={formatCurrency(spentToDate, displayCurrency)} />
      </p>
      {spendingDeltaPct != null && (
        <div
          className="flex items-center text-sm font-medium max-[1000px]:text-[0.7875rem]"
          style={{ color: spendingDeltaPct <= 0 ? 'var(--app-positive)' : 'var(--app-negative)' }}
        >
          {spendingDeltaPct <= 0 ? (
            <ArrowDownRight size={14} aria-hidden />
          ) : (
            <ArrowUpRight size={14} aria-hidden />
          )}
          <AppScrambledNumber text={spendingDeltaText} />
        </div>
      )}
    </div>
  )
}
