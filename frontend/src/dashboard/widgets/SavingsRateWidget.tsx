import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowUpToLine, Repeat } from 'lucide-react'
import { useDashboardSavingsRate } from '@/api/dashboard'
import { SavingsCurrentBoundary } from '@/dashboard/components/SavingsCurrentBoundary'
import { getSavingsRateSeries } from '@/dashboard/utils/getSavingsRateSeries'

function getSavingsTier(rate: number | null) {
  if (rate === null) return 'negative'
  if (rate >= 20) return 'positive'
  if (rate >= 10) return 'accent'
  return 'negative'
}

function clampSavingsRate(rate: number | null) {
  if (rate === null) return null
  return Math.max(-100, Math.min(100, rate))
}

export function SavingsRateWidget() {
  const [capSavingsRateChart, setCapSavingsRateChart] = useState(false)
  const { data: dashboardSavingsRate } = useDashboardSavingsRate()
  const savingsData = useMemo(
    () => getSavingsRateSeries(dashboardSavingsRate),
    [dashboardSavingsRate],
  )
  const chartData = useMemo(() => savingsData.map((point) => ({
    ...point,
    chartRate: capSavingsRateChart ? clampSavingsRate(point.rate) : point.rate,
  })), [capSavingsRateChart, savingsData])

  return (
    <div className="app-card h-[14rem] pb-2 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <Repeat size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Savings Rate</span>
        <button
          type="button"
          onClick={() => setCapSavingsRateChart((current) => !current)}
          title={capSavingsRateChart ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
          aria-label={capSavingsRateChart ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
          className="app-icon-button ml-auto"
        >
          <ArrowUpToLine
            size={12}
            className={`transition-transform duration-150 motion-reduce:transition-none ${capSavingsRateChart ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {chartData.length > 0 && (
        <div className="flex-1 min-h-0 relative">
          {/* Pattern definitions live beside the chart so Recharts can resolve
              the url(#id) fills regardless of its internal SVG structure. */}
          <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
            <defs>
              {(['positive', 'accent', 'negative'] as const).map((tier) => (
                <pattern
                  key={tier}
                  id={`savings-stripes-${tier}`}
                  patternUnits="userSpaceOnUse"
                  width={6}
                  height={6}
                  patternTransform="rotate(45)"
                >
                  <rect
                    width={3}
                    height={6}
                    style={{ fill: `var(--app-${tier})` }}
                  />
                </pattern>
              ))}
            </defs>
          </svg>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="monthLabel"
                axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                tickLine={false}
                interval={0}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 9 }}
                tickMargin={3}
              />
              <YAxis
                hide
                domain={capSavingsRateChart ? [-100, 100] : [
                  (dataMin: number) => Math.min(0, dataMin),
                  (dataMax: number) => Math.max(0, dataMax),
                ]}
              />
              <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
              <SavingsCurrentBoundary
                currentLabel={chartData[chartData.length - 1].monthLabel}
              />
              <Tooltip
                wrapperClassName="app-chart-tooltip-default"
                cursor={{ fill: 'var(--app-border)', opacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const { fullLabel, income, expenses } = payload[0].payload as {
                    fullLabel: string
                    income: number
                    expenses: number
                  }
                  if (income === 0 && expenses === 0) return null
                  const display =
                    income > 0
                      ? `${Math.round(((income - expenses) / income) * 100)}%`
                      : '−∞%'
                  return (
                    <div className="app-chart-tooltip-default-content">
                      <div style={{ color: 'var(--app-text-subtle)' }}>{fullLabel}</div>
                      <div style={{ color: 'var(--app-text)' }}>Savings Rate: {display}</div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="chartRate" radius={[3, 3, 0, 0]} maxBarSize={28}>
                {chartData.map((entry, index) => {
                  const tier = getSavingsTier(entry.rate)
                  return (
                    <Cell
                      key={index}
                      fill={
                        entry.isCurrent
                          ? `url(#savings-stripes-${tier})`
                          : `var(--app-${tier})`
                      }
                    />
                  )
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
