import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  useAccountCashFlow,
  type Account,
  type AccountMonthlyCashFlow,
} from '@/api/accounts'
import { formatCurrency } from '@/utils/formatCurrency'
import { parseYmdLocal } from '@/accounts/detail/utils/date'

// Shows recent monthly cash flow plus a completed-month average. One extra
// month is fetched so the chart includes the current partial month, while the
// average excludes it.
const CASH_FLOW_AVG_MONTHS = 6
const CASH_FLOW_CHART_MONTHS = CASH_FLOW_AVG_MONTHS + 1

// Reused for both the monthly history and the average bar. Both callers pass
// the same `domain` so heights stay comparable.
interface CashFlowBar {
  label: string
  income: number
  expense: number
}

function CashFlowBarChart({
  data,
  domain,
  currency,
  tooltipLabel,
}: {
  data: CashFlowBar[]
  domain: [number, number]
  currency: string
  tooltipLabel: (label: string) => string
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap="18%"
      >
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
          tickMargin={4}
          interval={0}
        />
        <YAxis hide domain={domain} />
        <Tooltip
          cursor={{ fill: 'var(--app-accent-soft)', radius: 4 }}
          wrapperClassName="app-chart-tooltip-default"
          labelFormatter={(label) => tooltipLabel(String(label))}
          formatter={(value, name) => [
            formatCurrency(Number(value), currency),
            name === 'income' ? 'In' : 'Out',
          ]}
        />
        <Bar
          dataKey="income"
          fill="var(--app-positive)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          opacity={0.85}
        />
        <Bar
          dataKey="expense"
          fill="var(--app-negative)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          opacity={0.85}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function MonthlyCashFlowCard({ account }: { account: Account }) {
  const { data } = useAccountCashFlow(account.id, CASH_FLOW_CHART_MONTHS)

  const chartData = useMemo(
    () =>
      (data ?? []).map((row: AccountMonthlyCashFlow) => ({
        label: parseYmdLocal(row.month).toLocaleDateString('en-US', { month: 'short' }),
        tooltipLabel: parseYmdLocal(row.month).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        }),
        income: row.income,
        expense: row.expenses,
      })),
    [data],
  )
  const hasActivity = chartData.some((m) => m.income > 0 || m.expense > 0)

  // Average completed months only. Dormant months still count as $0 so the
  // value stays stable across the month.
  const { avgIn, avgOut } = useMemo(() => {
    if (!data || data.length <= 1) return { avgIn: 0, avgOut: 0 }
    const completed = data.slice(0, -1)
    const totalIn = completed.reduce((sum, m) => sum + m.income, 0)
    const totalOut = completed.reduce((sum, m) => sum + m.expenses, 0)
    return {
      avgIn: Math.round(totalIn / completed.length),
      avgOut: Math.round(totalOut / completed.length),
    }
  }, [data])

  // Shared Y-axis ceiling keeps the average bar comparable to monthly bars.
  const yMax = useMemo(() => {
    const monthlyPeak = chartData.reduce(
      (peak, m) => Math.max(peak, m.income, m.expense),
      0,
    )
    // Prevent Recharts from collapsing to a zero-height domain.
    return Math.max(monthlyPeak, avgIn, avgOut, 1)
  }, [chartData, avgIn, avgOut])

  const avgData: CashFlowBar[] = [
    { label: `${CASH_FLOW_AVG_MONTHS} Mo Avg`, income: avgIn, expense: avgOut },
  ]
  const monthlyLabelByKey = new Map(chartData.map((m) => [m.label, m.tooltipLabel]))

  return (
    <section
      className="app-card flex h-[400px] flex-col"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">Monthly Cash Flow</p>
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--app-positive)' }} />
            In
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--app-negative)' }} />
            Out
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-[200px] w-full flex gap-4">
        <div className="flex-1 min-w-0">
          {!hasActivity ? (
            <div
              className="h-full w-full flex items-center justify-center text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              No cash flow yet
            </div>
          ) : (
            <CashFlowBarChart
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
              <CashFlowBarChart
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
