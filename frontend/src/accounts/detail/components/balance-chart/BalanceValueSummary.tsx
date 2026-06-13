import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatCurrency } from '@/utils/formatCurrency'
import type { BalanceChartSnapshot } from '@/accounts/detail/utils/balanceChartViewModel'

type BalanceValueSummaryProps = {
  snapshot: BalanceChartSnapshot
}

/**
 * Renders the current balance and selected-range movement summary above the chart
 */
export function BalanceValueSummary({ snapshot }: BalanceValueSummaryProps) {
  return (
    <div className="mb-4">
      <p
        className="font-financial font-normal leading-none text-3xl"
        style={{ color: snapshot.currentBalance < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
      >
        {formatCurrency(snapshot.currentBalance, snapshot.currency)}
      </p>
      {snapshot.periodDelta !== null && (
        <div className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: snapshot.deltaColor }}>
          {snapshot.trendUp ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
          <span>
            {snapshot.trendUp ? '+' : '−'}
            {formatCurrency(Math.abs(snapshot.periodDelta.absolute), snapshot.currency)}
            {snapshot.periodDelta.pct !== null && (
              <>
                {' '}
                ({snapshot.trendUp ? '+' : '−'}
                {Math.abs(snapshot.periodDelta.pct).toFixed(1)}%)
              </>
            )}
          </span>
          <span style={{ color: 'var(--app-text-subtle)' }}>· {snapshot.range.toLowerCase()}</span>
        </div>
      )}
    </div>
  )
}
