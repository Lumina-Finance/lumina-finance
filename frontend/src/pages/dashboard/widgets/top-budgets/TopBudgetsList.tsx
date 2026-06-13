import { Link } from 'react-router-dom'
import type { TopBudget } from '@/pages/dashboard/types/dashboard'
import { formatDashboardShortDate } from '@/pages/dashboard/utils/formatDashboardShortDate'
import { getTopBudgetAttentionState } from '@/pages/dashboard/utils/getTopBudgetAttentionState'
import { formatCurrency } from '@/utils/formatCurrency'

type TopBudgetsListProps = {
  budgets: TopBudget[]
}

type TopBudgetRowProps = {
  budget: TopBudget
  showDivider: boolean
}

/**
 * Clamps budget progress bar width to valid CSS percentage bounds
 */
function getBudgetProgressWidth(usagePct: number) {
  return Math.min(Math.max(usagePct, 0), 100)
}

/**
 * Renders a linked top budget row with its usage status and progress bar
 */
function TopBudgetRow({ budget, showDivider }: TopBudgetRowProps) {
  const attention = getTopBudgetAttentionState(budget.usagePct)
  const barPct = getBudgetProgressWidth(budget.usagePct)

  return (
    <Link
      to={`/budgets?budget=${encodeURIComponent(budget.base_budget_id)}`}
      className="block px-1 py-2 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
      style={{
        borderBottom: showDivider ? '1px solid var(--app-border)' : undefined,
      }}
      aria-label={`Open ${budget.name} budget`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold max-[1000px]:text-[0.9rem]">{budget.name}</p>
          <p
            className="mt-0.5 text-base max-[1000px]:text-[0.9rem]"
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
      <div className="mt-2 flex items-center gap-3">
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
        <span className="shrink-0 text-sm max-[1000px]:text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          Ends {formatDashboardShortDate(budget.period_end)}
        </span>
      </div>
    </Link>
  )
}

/**
 * Renders top budget rows, the empty state, and the full budgets link
 */
export function TopBudgetsList({ budgets }: TopBudgetsListProps) {
  if (budgets.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
        style={{ color: 'var(--app-text-subtle)' }}
      >
        No budgets
      </div>
    )
  }

  return (
    <>
      <div className="min-h-0 flex-1">
        {budgets.map((budget, index) => (
          <TopBudgetRow
            key={budget.budget_id}
            budget={budget}
            showDivider={index < budgets.length - 1}
          />
        ))}
      </div>
      <Link
        to="/budgets"
        className="app-secondary-button mt-3 h-9 text-xs max-[1000px]:text-[0.675rem]"
      >
        View all budgets
      </Link>
    </>
  )
}
