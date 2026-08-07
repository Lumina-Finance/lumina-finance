import type { BaseBudget, Budget, BudgetUtilization } from '@/api/budgets'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import BudgetCategoryRow from '@/pages/budgets/components/budget-card/CategoryRow'
import ArchivedPill from '@/pages/budgets/components/shared/ArchivedPill'
import BudgetAttentionIcon from '@/pages/budgets/components/shared/AttentionIcon'
import BudgetFxStatusBadge from '@/pages/budgets/components/shared/FxStatusBadge'
import { budgetCadenceLabel, formatBudgetPeriod, nextBudgetPeriods } from '@/pages/budgets/utils/budgetPeriods'
import { attentionState } from '@/pages/budgets/utils/budgetStatus'
import { getBudgetUtilizationPercent } from '@/pages/budgets/utils/utilization'

/**
 * Renders a single budget summary card with current spending, period context, and tracked categories
 */
export default function BudgetCard({
  baseBudget,
  latestPeriod,
  categoryNames,
  utilization,
  isArchived = false,
  onOpen,
}: {
  baseBudget: BaseBudget
  latestPeriod: Budget | undefined
  categoryNames: string[]
  utilization: BudgetUtilization | undefined
  isArchived?: boolean
  onOpen: () => void
}) {
  const { formatCurrency } = useMoneyFormatters()
  const shownCategories = categoryNames.length > 3 ? categoryNames.slice(0, 2) : categoryNames.slice(0, 3)
  const extraCategoryCount = Math.max(categoryNames.length - shownCategories.length, 0)
  const spent = utilization?.total_spent ?? 0
  const remaining = latestPeriod ? latestPeriod.overall_limit - spent : 0
  const isOverBudget = remaining < 0
  const displayBalance = isOverBudget ? Math.abs(remaining) : remaining
  const progress = latestPeriod ? Math.min(Math.max(getBudgetUtilizationPercent(spent, latestPeriod.overall_limit), 0), 100) : 0
  const attention = attentionState(latestPeriod, utilization)
  const upcomingPeriods = nextBudgetPeriods(baseBudget, latestPeriod)

  return (
    <article
      className={`app-card app-budget-card flex w-full min-w-0 cursor-pointer flex-col transition-transform duration-150 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)] ${
        isArchived ? 'opacity-80 transition-opacity hover:opacity-100' : 'min-h-[21.5rem]'
      }`}
      style={{
        borderTop: `5px solid ${isArchived ? 'var(--app-text-muted)' : attention.indicatorColor}`,
      }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-semibold" style={{ color: 'var(--app-text)' }}>
              {baseBudget.name}
            </h2>
            <BudgetFxStatusBadge
              fxStatus={utilization?.fx_status}
              label="Budget FX status"
              stopPropagation
            />
          </div>
          <p className="mt-1 truncate text-sm" style={{ color: 'var(--app-text-subtle)' }}>
            {budgetCadenceLabel(baseBudget)} · {baseBudget.group_id ? 'Shared' : 'Personal'} · {baseBudget.currency}
          </p>
        </div>
        {isArchived ? (
          <ArchivedPill />
        ) : (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium"
            style={{ background: attention.background, color: attention.textColor }}
          >
            <BudgetAttentionIcon label={attention.label} />
            {attention.label}
          </span>
        )}
      </div>

      {/* An archived budget no longer tracks a live period, so an over or left reading would be stale noise */}
      {!isArchived && (
        <div className="mt-5">
          <div className="app-budget-card-summary">
            <p className="flex min-w-0 items-baseline gap-2 text-3xl font-semibold tracking-tight" style={{ color: 'var(--app-text)' }}>
              <span className="truncate">{latestPeriod ? formatCurrency(displayBalance, baseBudget.currency) : 'Not set'}</span>
              {latestPeriod && (
                <span className="shrink-0 text-lg font-bold uppercase">
                  {isOverBudget ? 'over' : 'left'}
                </span>
              )}
            </p>
            <p className="app-budget-card-used text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              {latestPeriod
                ? `${formatCurrency(spent, baseBudget.currency)} used of ${formatCurrency(latestPeriod.overall_limit, baseBudget.currency)}`
                : 'Create a period to start tracking spending.'}
            </p>
          </div>
          <div className="mt-3 h-2 rounded-full" style={{ background: 'var(--app-border)' }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${progress}%`, background: attention.indicatorColor }}
            />
          </div>
        </div>
      )}

      <div className="app-budget-card-details mt-5">
        <div className="app-budget-card-periods min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--app-text-subtle)' }}>
            Current period
          </p>
          <div className="mt-2 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
            <p className="truncate">{formatBudgetPeriod(latestPeriod)}</p>
          </div>
          <p className="mt-4 text-sm font-medium" style={{ color: 'var(--app-text-subtle)' }}>
            Upcoming periods
          </p>
          <div className="mt-2 space-y-1.5 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
            {upcomingPeriods.length > 0
              ? upcomingPeriods.map((period) => (
                <p key={period} className="truncate">{period}</p>
              ))
              : <p className="truncate">No upcoming periods</p>}
          </div>
        </div>

        <div className="app-budget-card-categories min-w-0">
          <p className="mb-2 text-sm font-medium" style={{ color: 'var(--app-text-subtle)' }}>
            Categories
          </p>
          <div className="grid gap-2">
            {shownCategories.length > 0 ? shownCategories.map((name) => (
              <BudgetCategoryRow key={name} label={name} />
            )) : (
              <BudgetCategoryRow label="No categories selected" />
            )}
            {extraCategoryCount > 0 && <BudgetCategoryRow label={`+${extraCategoryCount} more`} />}
          </div>
        </div>
      </div>
    </article>
  )
}
