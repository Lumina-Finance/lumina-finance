import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PieChart as PieChartIcon } from 'lucide-react'
import { useLatestBudgetUtilizations } from '@/api/budgets'
import { formatCurrency } from '@/utils/formatCurrency'
import { getTopBudgets } from '@/dashboard/utils/getTopBudgets'

function formatDashboardShortDate(value: string) {
  const [datePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  if (!year || !month || !day) return 'Unknown'

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function getBudgetAttentionState(usagePct: number) {
  if (usagePct >= 100) {
    return {
      label: 'Needs attention',
      textColor: 'var(--app-negative)',
      indicatorColor: 'var(--app-negative)',
    }
  }

  if (usagePct >= 80) {
    return {
      label: 'Watch',
      textColor: 'var(--app-warning-text)',
      indicatorColor: 'var(--app-warning)',
    }
  }

  return {
    label: 'On track',
    textColor: 'var(--app-positive)',
    indicatorColor: 'var(--app-positive)',
  }
}

export function TopBudgetsWidget() {
  const { data: latestBudgetUtilizations, isLoading: loading } = useLatestBudgetUtilizations()
  const budgets = useMemo(
    () => getTopBudgets(latestBudgetUtilizations),
    [latestBudgetUtilizations],
  )

  return (
    <div className="app-card h-[410px] flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <PieChartIcon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Top Budgets</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="app-spinner" />
        </div>
      ) : budgets.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          No budgets
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0">
            {budgets.map((budget, index) => {
              const attention = getBudgetAttentionState(budget.usagePct)
              const barPct = Math.min(Math.max(budget.usagePct, 0), 100)
              return (
                <Link
                  key={budget.budget_id}
                  to={`/budgets?budget=${encodeURIComponent(budget.base_budget_id)}`}
                  className="block px-1 py-3 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                  style={{
                    borderBottom: index < budgets.length - 1 ? '1px solid var(--app-border)' : undefined,
                  }}
                  aria-label={`Open ${budget.name} budget`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold max-[1000px]:text-[0.9rem]">{budget.name}</p>
                      <p
                        className="mt-0.5 text-xs max-[1000px]:text-[0.675rem]"
                        style={{ color: 'var(--app-text-muted)' }}
                      >
                        {formatCurrency(budget.total_spent, budget.currency)}
                        {' / '}
                        {formatCurrency(budget.overall_limit, budget.currency)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-semibold leading-none max-[1000px]:text-[0.9rem]" style={{ color: attention.textColor }}>
                        {budget.usagePct}%
                      </p>
                      <p className="mt-1 text-xs font-medium max-[1000px]:text-[0.675rem]" style={{ color: attention.textColor }}>
                        {attention.label}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full"
                      style={{ background: 'var(--app-border)' }}
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${barPct}%`,
                          background: attention.indicatorColor,
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-xs max-[1000px]:text-[0.675rem]" style={{ color: 'var(--app-text-subtle)' }}>
                      Ends {formatDashboardShortDate(budget.period_end)}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
          <Link
            to="/budgets"
            className="app-secondary-button mt-3 h-9 text-xs max-[1000px]:text-[0.675rem]"
          >
            View all budgets
          </Link>
        </>
      )}
    </div>
  )
}
