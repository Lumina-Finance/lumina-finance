import type { CSSProperties } from 'react'
import type { FxStatus } from '@/api/shared/fx'
import { InsightFxStatusBadge } from '@/pages/insights/components/InsightFxStatusBadge'
import type { PeriodGlancePrimaryMetric } from '@/pages/insights/types/periodGlance'
import { getPeriodIncomeExpenseFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { formatCurrency } from '@/utils/formatCurrency'
import { InsightCalculationTooltip } from '../InsightCalculationTooltip'
import { getPeriodGlanceToneClass } from './display'
import { useFittedPrimaryAmount } from './useFittedPrimaryAmount'

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
  const [primaryAmountRef, primaryAmountFontSizeRem, primaryAmountMaxRem] = useFittedPrimaryAmount(primaryMetric.value)
  const primaryAmountStyle: CSSProperties | undefined =
    primaryAmountFontSizeRem < primaryAmountMaxRem ? { fontSize: `${primaryAmountFontSizeRem}rem` } : undefined

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
            <InsightFxStatusBadge
              label="Income and expense FX status"
              status={incomeExpenseFxStatus}
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
        <div>
          <p className="app-label app-label-compact inline-flex items-center gap-2">
            Income
            <InsightCalculationTooltip
              label="Income"
              calculation="Total money in for this range after refunds and reversals are netted. Transfers are excluded"
            />
          </p>
          <p className="mt-1 font-financial text-lg">{formatCurrency(income, displayCurrency)}</p>
        </div>
        <div>
          <p className="app-label app-label-compact inline-flex items-center gap-2">
            Expenses
            <InsightCalculationTooltip
              label="Expenses"
              calculation="Total money out for this range after refunds and reversals are netted. Shown as a positive amount. Transfers are excluded"
            />
          </p>
          <p className="mt-1 font-financial text-lg">{formatCurrency(expenses, displayCurrency)}</p>
        </div>
      </div>
    </div>
  )
}
