import { useMemo } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Wallet } from 'lucide-react'
import { useDashboardNetWorth } from '@/api/dashboard'
import { formatCurrency } from '@/utils/formatCurrency'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import { getNetWorthSeries } from '@/dashboard/utils/getNetWorthSeries'

type NetWorthWidgetProps = {
  displayCurrency: string
}

export function NetWorthWidget({ displayCurrency }: NetWorthWidgetProps) {
  const { data: dashboardNetWorth } = useDashboardNetWorth()
  const netWorthData = useMemo(
    () => getNetWorthSeries(dashboardNetWorth),
    [dashboardNetWorth],
  )
  const netWorth = dashboardNetWorth?.current_net_worth ?? 0
  const netWorthColor = netWorth < 0 ? 'var(--app-negative)' : 'var(--app-text)'
  const netWorthTrendUp =
    netWorthData.length >= 2 &&
    netWorthData[netWorthData.length - 1].value >= netWorthData[0].value
  const netWorthLineColor = netWorthTrendUp ? 'var(--app-positive)' : 'var(--app-negative)'

  return (
    <div className="app-card h-[14rem] pb-2 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <Wallet size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Net Worth</span>
      </div>
      <p
        className="font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]"
        style={{ color: netWorthColor }}
      >
        {formatDashboardMoney(netWorth, displayCurrency, 'netWorth')}
      </p>
      {netWorthData.length >= 2 && (
        <div className="mt-3 flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={netWorthData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="date"
                axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 9 }}
                tickMargin={3}
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                wrapperClassName="app-chart-tooltip-default"
                formatter={(value) => [formatCurrency(Number(value), displayCurrency), 'Net Worth']}
                cursor={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={netWorthLineColor}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
