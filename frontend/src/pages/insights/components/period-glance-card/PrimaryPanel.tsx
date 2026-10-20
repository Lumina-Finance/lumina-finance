import type { FxStatus } from '@/api/shared/fx'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import type { PeriodGlancePrimaryMetric } from '@/pages/insights/types/periodGlance'
import { getPeriodIncomeExpenseFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { InsightCalculationTooltip } from '@/pages/insights/components/CalculationTooltip'
import { getPeriodGlanceToneClass } from './display'
import { getFittedAmountStyle, useFittedAmount } from '@/pages/insights/hooks/useFittedAmount'

// The headline's `text-5xl` size, and the smallest it shrinks to, `text-xl`, which keeps an amount
// as long as "(IQD 1,246,913,569.001)" inside the panel at phone width
const PRIMARY_AMOUNT_MAX_REM = 3
const PRIMARY_AMOUNT_MIN_REM = 1.25

// The Income and Expenses figures' `text-lg` size, and the smallest they shrink to, `text-xs`, the
// smallest named type size. Checked at 390px wide only, where it keeps an amount as long as
// "IQD 1,246,913,569.001" inside its half of the panel. The figures' `leading-7` is `text-lg`'s own
// line height, fixed so the row keeps its height when a long amount shrinks them
const FIGURE_MAX_REM = 1.125
const FIGURE_MIN_REM = 0.75

type PeriodGlancePrimaryPanelProps = {
  primaryMetric: PeriodGlancePrimaryMetric
  income: number
  expenses: number
  incomeExpenseFxStatus: FxStatus | undefined
  displayCurrency: string
}

/**
 * Renders the main period-glance metric with income and expense totals
 */
export function PeriodGlancePrimaryPanel({
  primaryMetric,
  income,
  expenses,
  incomeExpenseFxStatus,
  displayCurrency,
}: PeriodGlancePrimaryPanelProps) {
  const { formatCurrency } = useMoneyFormatters()
  const [primaryAmountRef, primaryAmountFillRatio] = useFittedAmount(
    primaryMetric.value,
    PRIMARY_AMOUNT_MAX_REM,
    PRIMARY_AMOUNT_MIN_REM,
  )
  const primaryAmountStyle = getFittedAmountStyle(primaryAmountFillRatio, PRIMARY_AMOUNT_MAX_REM, PRIMARY_AMOUNT_MIN_REM)
  const formattedIncome = formatCurrency(income, displayCurrency)
  const formattedExpenses = formatCurrency(expenses, displayCurrency)
  const [incomeRef, incomeFillRatio] = useFittedAmount(formattedIncome, FIGURE_MAX_REM, FIGURE_MIN_REM)
  const [expensesRef, expensesFillRatio] = useFittedAmount(formattedExpenses, FIGURE_MAX_REM, FIGURE_MIN_REM)

  // Both figures take the smaller fitted size, so a long amount never sits beside a larger short one.
  // Their containers are always equally wide, so the smaller fill ratio fits both
  const figureFillRatio = incomeFillRatio === null || expensesFillRatio === null
    ? null
    : Math.min(incomeFillRatio, expensesFillRatio)
  const figureStyle = getFittedAmountStyle(figureFillRatio, FIGURE_MAX_REM, FIGURE_MIN_REM)

  return (
    <div className="grid gap-5 rounded-xl border border-[var(--app-accent-border)] bg-[var(--app-accent-soft)] p-4 min-[750px]:grid-cols-[minmax(0,60fr)_minmax(0,40fr)] min-[750px]:items-center min-[1500px]:flex min-[1500px]:min-h-52 min-[1500px]:flex-col min-[1500px]:items-stretch min-[1500px]:justify-between">
      <div className="min-w-0 [container-type:inline-size]">
        <p className="app-label inline-flex items-center gap-2">
          {primaryMetric.label}
          <InsightCalculationTooltip
            label={primaryMetric.label}
            calculation={primaryMetric.calculation}
          />
          {incomeExpenseFxStatus && (
            <FxStatusBadge
              label="Income and expense FX status"
              fxStatus={incomeExpenseFxStatus}
              getMessage={getPeriodIncomeExpenseFxStatusMessage}
            />
          )}
        </p>
        <p
          ref={primaryAmountRef}
          className={[
            'mt-3 max-w-full whitespace-nowrap font-financial text-5xl font-normal leading-none',
            getPeriodGlanceToneClass(primaryMetric.tone),
          ].join(' ')}
          style={primaryAmountStyle}
        >
          {primaryMetric.value}
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-text-muted)]">
          {primaryMetric.detail}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-[var(--app-border)] pt-3 min-[750px]:grid-cols-1 min-[750px]:border-l min-[750px]:border-t-0 min-[750px]:pl-5 min-[750px]:pt-0 min-[1500px]:mt-5 min-[1500px]:grid-cols-2 min-[1500px]:border-l-0 min-[1500px]:border-t min-[1500px]:pl-0 min-[1500px]:pt-3">
        <div className="min-w-0 [container-type:inline-size]">
          <p className="app-label app-label-compact inline-flex items-center gap-2">
            Income
            <InsightCalculationTooltip
              label="Income"
              calculation="Total money in for this range after refunds and reversals are netted. Transfers are excluded"
            />
          </p>
          <p ref={incomeRef} className="mt-1 whitespace-nowrap font-financial text-lg leading-7" style={figureStyle}>
            {formattedIncome}
          </p>
        </div>
        <div className="min-w-0 [container-type:inline-size]">
          <p className="app-label app-label-compact inline-flex items-center gap-2">
            Expenses
            <InsightCalculationTooltip
              label="Expenses"
              calculation="Total money out for this range after refunds and reversals are netted. Shown as a positive amount. Transfers are excluded"
            />
          </p>
          <p ref={expensesRef} className="mt-1 whitespace-nowrap font-financial text-lg leading-7" style={figureStyle}>
            {formattedExpenses}
          </p>
        </div>
      </div>
    </div>
  )
}
