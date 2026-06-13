import { useMemo } from 'react'
import {
  useAccountCashFlow,
  type Account,
} from '@/api/accounts'
import {
  CASH_FLOW_AVG_MONTHS,
  CASH_FLOW_CHART_MONTHS,
  getCashFlowDomainMax,
  getCompletedCashFlowAverage,
  getMonthlyCashFlowBars,
  type CashFlowBar,
} from '@/pages/accounts/detail/utils/cashFlowChartViewModel'
import { MonthlyCashFlowBarChart } from './MonthlyCashFlowBarChart'
import { MonthlyCashFlowLegend } from './MonthlyCashFlowLegend'

/**
 * Renders monthly cash flow history alongside a completed-month average bar
 */
export default function MonthlyCashFlowCard({ account }: { account: Account }) {
  const { data } = useAccountCashFlow(account.id, CASH_FLOW_CHART_MONTHS)

  const chartData = useMemo(
    () => getMonthlyCashFlowBars(data),
    [data],
  )
  const hasActivity = chartData.some((m) => m.income > 0 || m.expense > 0)
  const { avgIn, avgOut } = useMemo(
    () => getCompletedCashFlowAverage(data),
    [data],
  )
  const yMax = useMemo(
    () => getCashFlowDomainMax(chartData, { avgIn, avgOut }),
    [chartData, avgIn, avgOut],
  )
  const avgData: CashFlowBar[] = [
    { label: `${CASH_FLOW_AVG_MONTHS} Mo Avg`, income: avgIn, expense: avgOut },
  ]
  const monthlyLabelByKey = new Map(chartData.map((m) => [m.label, m.tooltipLabel]))

  return (
    <section className="app-card flex h-[400px] flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">Monthly Cash Flow</p>
        <MonthlyCashFlowLegend />
      </div>

      <div className="relative flex-1 min-h-[200px] w-full flex gap-4">
        <div className="flex-1 min-w-0">
          {!hasActivity ? (
            <div
              className="h-full w-full flex items-center justify-center text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              No cash flow yet
            </div>
          ) : (
            <MonthlyCashFlowBarChart
              data={chartData}
              domain={[0, yMax]}
              currency={account.currency}
              tooltipLabel={(label) => monthlyLabelByKey.get(label) ?? label}
            />
          )}
        </div>

        {hasActivity && (
          <>
            <div
              className="shrink-0 self-stretch"
              style={{ borderLeft: '1px dashed var(--app-border-strong)' }}
              aria-hidden
            />
            <div className="shrink-0" style={{ width: 72 }}>
              <MonthlyCashFlowBarChart
                data={avgData}
                domain={[0, yMax]}
                currency={account.currency}
                tooltipLabel={() => `${CASH_FLOW_AVG_MONTHS}-month average`}
              />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
