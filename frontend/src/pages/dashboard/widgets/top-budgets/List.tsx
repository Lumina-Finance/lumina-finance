import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { TopBudget } from '@/pages/dashboard/types/dashboard'
import { formatDashboardShortDate } from '@/pages/dashboard/utils/formatDashboardShortDate'
import { getTopBudgetAttentionState } from '@/pages/dashboard/utils/getTopBudgetAttentionState'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

type TopBudgetsListProps = {
  budgets: TopBudget[]
}

type TopBudgetRowProps = {
  budget: TopBudget
  showDivider: boolean
}

// The status reads its attention colour, and a tinted variant while its row is under the pointer, since the plain green
// falls under 4.5:1 on the tint in the light theme
const STATUS_TEXT_CLASS =
  'text-[var(--status-text)] transition-control group-hover/row:text-[var(--status-tinted-text)]'

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
  const { formatCurrency } = useMoneyFormatters()
  // The status and the bar read the exact usage, as the budgets page does, because the shown percent
  // rounds up and would call a budget at 99.4% needing attention
  const exactPct = budget.usageRatio * 100
  const attention = getTopBudgetAttentionState(exactPct)
  const barPct = getBudgetProgressWidth(exactPct)
  const statusStyle = {
    '--status-text': attention.textColor,
    '--status-tinted-text': attention.tintedTextColor,
  } as CSSProperties

  // The divider is a line of its own rather than the row's bottom border, which a rounded row would curl up at both ends
  return (
    <>
      <Link
        to={`/budgets?budget=${encodeURIComponent(budget.base_budget_id)}`}
        className="group/row block rounded-xl px-1 py-2 transition-control app-focus-inset focus-visible:bg-transparent! hover:bg-[var(--app-accent-soft)]"
        aria-label={`Open ${budget.name} budget`}
      >
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold max-[1000px]:text-[0.9rem]">{budget.name}</p>
            <p className="mt-0.5 text-base max-[1000px]:text-[0.9rem]" style={{ color: 'var(--app-text-muted)' }}>
              {formatCurrency(budget.total_spent, budget.currency)}
              {' / '}
              {formatCurrency(budget.overall_limit, budget.currency)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={`text-base font-semibold leading-none max-[1000px]:text-[0.9rem] ${STATUS_TEXT_CLASS}`}
              style={statusStyle}
            >
              {budget.usagePct}%
            </p>
            <p
              className={`mt-1 text-xs font-medium max-[1000px]:text-[0.675rem] ${STATUS_TEXT_CLASS}`}
              style={statusStyle}
            >
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
          <span className="shrink-0 text-sm text-[var(--app-text-subtle)] transition-control group-hover/row:text-[var(--app-text-subtle-on-accent)] max-[1000px]:text-xs">
            Ends {formatDashboardShortDate(budget.period_end)}
          </span>
        </div>
      </Link>
      {showDivider && <div className="h-px" style={{ background: 'var(--app-border)' }} aria-hidden />}
    </>
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
          <TopBudgetRow key={budget.budget_id} budget={budget} showDivider={index < budgets.length - 1} />
        ))}
      </div>
      <Link to="/budgets" className="app-secondary-button mt-3 h-9 text-xs max-[1000px]:text-[0.675rem]">
        View all budgets
      </Link>
    </>
  )
}
