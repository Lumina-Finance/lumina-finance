import { formatCurrency } from '@/utils/formatCurrency'
import { formatBudgetPeriod } from '@/budgets/utils/budgetPeriods'
import type { BudgetPeriodHistoryEntry } from '@/budgets/utils/budgetDetails'

type BudgetPeriodHistoryProps = {
  periodHistory: BudgetPeriodHistoryEntry[]
  currency: string
  loading: boolean
  error: boolean
}

/**
 * Renders budget period history as mobile cards and a desktop table
 */
export default function BudgetPeriodHistory({
  periodHistory,
  currency,
  loading,
  error,
}: BudgetPeriodHistoryProps) {
  return (
    <section className="min-[1050px]:flex min-[1050px]:min-h-0 min-[1050px]:flex-1 min-[1050px]:flex-col">
      <h3 className="text-base font-semibold" style={{ color: 'var(--app-text)' }}>Period history</h3>
      <div className="mt-3 space-y-3 min-[750px]:hidden">
        {loading ? (
          <div className="rounded-xl px-4 py-6 text-center text-sm" style={{ background: 'var(--app-bg)', color: 'var(--app-text-subtle)' }}>
            Loading utilization history...
          </div>
        ) : error ? (
          <div className="rounded-xl px-4 py-6 text-center text-sm" style={{ background: 'var(--app-bg)', color: 'var(--app-negative)' }}>
            Utilization history could not load.
          </div>
        ) : periodHistory.map(({ period, spent, remaining }) => (
          <div key={period.id} className="rounded-xl px-4 py-3" style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}>
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                {formatBudgetPeriod(period)}
              </p>
              <p className="shrink-0 text-right text-sm font-semibold" style={{ color: remaining < 0 ? 'var(--app-negative)' : 'var(--app-positive)' }}>
                {remaining < 0 ? 'Over ' : 'Left '}
                {formatCurrency(Math.abs(remaining), currency)}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>Used</p>
                <p className="mt-1" style={{ color: 'var(--app-text-muted)' }}>{formatCurrency(spent, currency)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>Budgeted</p>
                <p className="mt-1" style={{ color: 'var(--app-text-muted)' }}>{formatCurrency(period.overall_limit, currency)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 hidden overflow-hidden min-[750px]:block min-[1050px]:min-h-0 min-[1050px]:flex-1 min-[1050px]:flex-col" style={{ borderTop: '1px solid var(--app-border)' }}>
        <div className="max-h-[12rem] overflow-y-auto pr-3 min-[1050px]:h-full min-[1050px]:max-h-none min-[1050px]:min-h-0">
          <table className="w-full text-sm">
            <thead
              className="sticky top-0 z-10"
              style={{ background: 'var(--app-surface-soft)', color: 'var(--app-text-subtle)' }}
            >
              <tr>
                <th className="px-4 py-3 text-left font-medium">Period</th>
                <th className="px-4 py-3 text-right font-medium">Used</th>
                <th className="px-4 py-3 text-right font-medium">Budgeted</th>
                <th className="px-4 py-3 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-center" colSpan={4} style={{ color: 'var(--app-text-subtle)' }}>
                    Loading utilization history...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td className="px-4 py-6 text-center" colSpan={4} style={{ color: 'var(--app-negative)' }}>
                    Utilization history could not load.
                  </td>
                </tr>
              ) : periodHistory.map(({ period, spent, remaining }) => (
                <tr key={period.id} style={{ borderTop: '1px solid var(--app-border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--app-text)' }}>
                    {formatBudgetPeriod(period)}
                  </td>
                  <td className="px-4 py-3 text-right" style={{ color: 'var(--app-text-muted)' }}>
                    {formatCurrency(spent, currency)}
                  </td>
                  <td className="px-4 py-3 text-right" style={{ color: 'var(--app-text-muted)' }}>
                    {formatCurrency(period.overall_limit, currency)}
                  </td>
                  <td className="px-4 py-3 text-right" style={{ color: remaining < 0 ? 'var(--app-negative)' : 'var(--app-positive)' }}>
                    {remaining < 0 ? 'Over ' : 'Left '}
                    {formatCurrency(Math.abs(remaining), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
