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
import {
  DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
  DASHBOARD_NET_WORTH_X_AXIS_TICK_COUNT,
  DASHBOARD_X_AXIS_TICK_FONT_SIZE,
} from '@/dashboard/constants/chart'
import { formatCurrency } from '@/utils/formatCurrency'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import { getNetWorthSeries } from '@/dashboard/utils/getNetWorthSeries'
import type { NetWorthSeriesPoint } from '@/dashboard/types/dashboard'

type NetWorthWidgetProps = {
  displayCurrency: string
}

function formatNetWorthChange(amount: number, currency: string) {
  if (amount === 0) return formatDashboardMoney(0, currency, 'netWorth')
  return `${amount > 0 ? '+' : '-'}${formatDashboardMoney(Math.abs(amount), currency, 'netWorth')}`
}

function getNetWorthXAxisTicks(data: NetWorthSeriesPoint[]) {
  const tickCount = Math.min(DASHBOARD_NET_WORTH_X_AXIS_TICK_COUNT, data.length)
  if (tickCount <= 1) return data.map((point) => point.date)

  const lastIndex = data.length - 1
  return Array.from({ length: tickCount }, (_, index) => (
    data[Math.round((lastIndex * index) / (tickCount - 1))].date
  ))
}

export function NetWorthWidget({ displayCurrency }: NetWorthWidgetProps) {
  const { data: dashboardNetWorth } = useDashboardNetWorth()
  const netWorthData = useMemo(
    () => getNetWorthSeries(dashboardNetWorth),
    [dashboardNetWorth],
  )
  const netWorthXAxisTicks = useMemo(
    () => getNetWorthXAxisTicks(netWorthData),
    [netWorthData],
  )
  const netWorth = dashboardNetWorth?.current_net_worth ?? 0
  const netWorthChange = netWorthData.length >= 2 ? netWorth - netWorthData[0].value : null
  const netWorthColor = netWorth < 0 ? 'var(--app-negative)' : 'var(--app-text)'
  const netWorthChangeColor =
    netWorthChange == null || netWorthChange === 0
      ? 'var(--app-text-muted)'
      : netWorthChange > 0
        ? 'var(--app-positive)'
        : 'var(--app-negative)'
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
      <div className="inline-flex max-w-full items-end gap-2">
        <p
          className="min-w-0 font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]"
          style={{ color: netWorthColor }}
        >
          {formatDashboardMoney(netWorth, displayCurrency, 'netWorth')}
        </p>
        {netWorthChange != null && (
          <p
            className="shrink-0 pb-0.5 font-financial text-sm font-medium leading-none max-[1000px]:text-xs"
            style={{ color: netWorthChangeColor }}
            aria-label={`Net worth change ${formatNetWorthChange(netWorthChange, displayCurrency)}`}
          >
            {formatNetWorthChange(netWorthChange, displayCurrency)}
          </p>
        )}
      </div>
      {netWorthData.length >= 2 && (
        <div className="mt-3 flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={netWorthData}
              margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            >
              <XAxis
                xAxisId="plot"
                dataKey="date"
                hide
              />
              <XAxis
                xAxisId="labels"
                dataKey="date"
                axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                tickLine={false}
                interval={0}
                ticks={netWorthXAxisTicks}
                padding={{
                  left: DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
                  right: DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
                }}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: DASHBOARD_X_AXIS_TICK_FONT_SIZE }}
                tickMargin={3}
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                wrapperClassName="app-chart-tooltip-default"
                formatter={(value) => [formatCurrency(Number(value), displayCurrency), 'Net Worth']}
                cursor={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
              />
              <Line
                xAxisId="plot"
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
