import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'

export type NetWorthAccountKey = 'chequing' | 'savings' | 'investments' | 'retirement'

type NetWorthAccount = {
  key: NetWorthAccountKey
  label: string
  color: string
}

export type NetWorthPoint = Record<NetWorthAccountKey, number> & {
  date: string
  dateLabel: string
  tooltipLabel: string
  total: number
}

type NetWorthChangeKey = `${NetWorthAccountKey}Change`

type NetWorthDeltaPoint = NetWorthPoint & Record<NetWorthChangeKey, number> & {
  startTotal: number
  totalChange: number
}

type NetWorthCardProps = {
  header: ReactNode
  series: NetWorthPoint[]
  displayCurrency: string
}

const netWorthAccounts: NetWorthAccount[] = [
  { key: 'chequing', label: 'Chequing', color: 'var(--app-accent)' },
  { key: 'savings', label: 'Savings', color: 'var(--app-positive)' },
  { key: 'investments', label: 'Investments', color: 'var(--app-warning)' },
  { key: 'retirement', label: 'Retirement', color: 'var(--app-text-muted)' },
]

const netWorthChartLeftMargin = 8

function formatSignedCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

function getNetWorthChangeKey(key: NetWorthAccountKey): NetWorthChangeKey {
  return `${key}Change` as NetWorthChangeKey
}

function getNetWorthDeltaSeries(series: NetWorthPoint[]): NetWorthDeltaPoint[] {
  const start = series[0]
  if (!start) return []

  return series.map((point) => {
    const deltaPoint = {
      ...point,
      startTotal: start.total,
      totalChange: point.total - start.total,
    } as NetWorthDeltaPoint

    for (const account of netWorthAccounts) {
      deltaPoint[getNetWorthChangeKey(account.key)] = point[account.key] - start[account.key]
    }

    return deltaPoint
  })
}

function NetWorthChartTooltip({
  active,
  payload,
  displayCurrency,
}: {
  active?: boolean
  payload?: Array<{ payload?: NetWorthDeltaPoint }>
  displayCurrency: string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="app-chart-tooltip-default-content min-w-64">
      <p className="app-tooltip-muted">{point.tooltipLabel}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span>Net Worth</span>
        <span className="font-financial">{formatCurrency(point.total, displayCurrency)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Change</span>
        <span className="font-financial">{formatSignedCurrency(point.totalChange, displayCurrency)}</span>
      </div>
      <div className="mt-2 space-y-1 border-t border-[var(--app-border)] pt-2">
        {netWorthAccounts.map((account) => {
          const changeKey = getNetWorthChangeKey(account.key)
          return (
            <div key={account.key} className="flex justify-between gap-4">
              <span className="app-tooltip-muted">{account.label}</span>
              <span className="font-financial">
                {formatCurrency(point[account.key], displayCurrency)}
                {' '}
                ({formatSignedCurrency(point[changeKey], displayCurrency)})
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function NetWorthCard({
  header,
  series,
  displayCurrency,
}: NetWorthCardProps) {
  const latest = series.at(-1)
  const deltaSeries = getNetWorthDeltaSeries(series)

  return (
    <section className="app-card">
      {header}
      <div className="flex h-[360px] flex-col">
        <div
          className="mb-3 flex flex-wrap items-end justify-between gap-3"
        >
          <div className="pl-4">
            <p className="app-label app-label-compact">Current Net Worth</p>
            <p className="mt-1 font-financial text-3xl leading-none tracking-tight">
              {formatCurrency(latest?.total ?? 0, displayCurrency)}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {netWorthAccounts.map((account) => (
              <div key={account.key} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                <span className="h-2 w-2 rounded-full" style={{ background: account.color }} />
                <span>{account.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={deltaSeries} margin={{ top: 4, right: 8, bottom: 0, left: netWorthChartLeftMargin }}>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                tickMargin={4}
                tickFormatter={(value: string) =>
                  deltaSeries.find((point) => point.date === value)?.dateLabel ?? value
                }
              />
              <YAxis
                hide
                axisLine={false}
                tickLine={false}
                domain={[(dataMin: number) => Math.min(dataMin, 0), (dataMax: number) => Math.max(dataMax, 0)]}
              />
              <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
              <Tooltip
                wrapperClassName="app-chart-tooltip-default"
                cursor={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
                content={<NetWorthChartTooltip displayCurrency={displayCurrency} />}
              />
              {netWorthAccounts.map((account) => (
                <Area
                  key={account.key}
                  type="monotone"
                  dataKey={getNetWorthChangeKey(account.key)}
                  stackId="net-worth"
                  stroke={account.color}
                  strokeWidth={1.25}
                  fill={account.color}
                  fillOpacity={0.34}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}
