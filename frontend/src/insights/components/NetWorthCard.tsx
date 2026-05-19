import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  Bar,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'

export type NetWorthViewMode = 'overview' | 'composition'

export type NetWorthGroup = {
  id: string
  name: string
  kind: 'asset' | 'debt'
}

export type NetWorthPoint = {
  date: string
  dateLabel: string
  tooltipLabel: string
  total: number
  values: number[]
}

type NetWorthChartItem = {
  id: string
  name: string
  color: string
  kind: 'asset' | 'debt'
  getValue: (point: NetWorthPoint) => number
}

type NetWorthDeltaPoint = NetWorthPoint & {
  startTotal: number
  totalChange: number
  [key: string]: string | number | number[]
}

type NetWorthCardProps = {
  header: ReactNode
  mode: NetWorthViewMode
  groups: NetWorthGroup[]
  series: NetWorthPoint[]
  displayCurrency: string
  emptyLabel?: string
}

const groupColors: Record<string, string> = {
  cash: '#2F80A7',
  tax_advantaged: 'var(--app-chart-positive)',
  term_deposits: '#D67A45',
  investments: '#37434F',
  other_assets: '#8F989F',
  revolving_debt: 'var(--app-chart-negative)',
  loans: '#D0717D',
  mortgages: '#9E4F4A',
  other_debt: '#7F4D52',
}

const netWorthChartLeftMargin = 8
const netWorthChangeColor = '#1F3F73'
const assetContributionColor = 'var(--app-chart-positive)'
const debtContributionColor = 'var(--app-chart-negative)'
const compositionAssetFallbackColor = '#6F98B7'
const compositionDebtFallbackColor = 'var(--app-chart-negative)'

const netWorthLegendContainerVariants = {
  initial: { transition: { staggerChildren: 0.035, staggerDirection: 1 } },
  enter: { transition: { staggerChildren: 0.045, staggerDirection: 1, delayChildren: 0.03 } },
  exit: { transition: { staggerChildren: 0.035, staggerDirection: 1 } },
} as const

const netWorthLegendItemVariants = {
  initial: { opacity: 0, x: -10 },
  enter: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 10 },
} as const

const netWorthLegendItemTransition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] } as const

function formatSignedCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

function getValueKey(index: number) {
  return `series${index}Value`
}

function getChangeKey(index: number) {
  return `series${index}Change`
}

function getChartKey(index: number) {
  return `series${index}Chart`
}

function getOverviewItems(groups: NetWorthGroup[]): NetWorthChartItem[] {
  return [
    {
      id: 'assets',
      name: 'Assets',
      color: assetContributionColor,
      kind: 'asset',
      getValue: (point) => groups.reduce((sum, group, index) => (
        group.kind === 'asset' ? sum + (point.values[index] ?? 0) : sum
      ), 0),
    },
    {
      id: 'debt',
      name: 'Debt',
      color: debtContributionColor,
      kind: 'debt',
      getValue: (point) => groups.reduce((sum, group, index) => (
        group.kind === 'debt' ? sum + (point.values[index] ?? 0) : sum
      ), 0),
    },
  ]
}

function getCompositionItems(groups: NetWorthGroup[]): NetWorthChartItem[] {
  return groups.map((group, index) => ({
    id: group.id,
    name: group.name,
    kind: group.kind,
    color: groupColors[group.id] ?? (
      group.kind === 'asset' ? compositionAssetFallbackColor : compositionDebtFallbackColor
    ),
    getValue: (point) => point.values[index] ?? 0,
  }))
}

function getChartData(series: NetWorthPoint[], items: NetWorthChartItem[]): NetWorthDeltaPoint[] {
  const start = series[0]
  if (!start) return []
  const startValues = items.map((item) => item.getValue(start))

  return series.map((point) => {
    const deltaPoint: NetWorthDeltaPoint = {
      ...point,
      startTotal: start.total,
      totalChange: point.total - start.total,
    }

    items.forEach((item, index) => {
      const value = item.getValue(point)
      const change = value - startValues[index]
      deltaPoint[getValueKey(index)] = value
      deltaPoint[getChangeKey(index)] = change
      deltaPoint[getChartKey(index)] = change
    })

    return deltaPoint
  })
}

function NetWorthChartTooltip({
  active,
  payload,
  items,
  displayCurrency,
}: {
  active?: boolean
  payload?: Array<{ payload?: NetWorthDeltaPoint }>
  items: NetWorthChartItem[]
  displayCurrency: string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const detailItems = items.map((item, index) => ({ item, index }))

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
        {detailItems.map(({ item, index }) => {
          const value = Number(point[getValueKey(index)] ?? 0)
          const change = Number(point[getChangeKey(index)] ?? 0)
          const displayValue = item.kind === 'debt' ? Math.abs(value) : value
          return (
            <div key={item.id} className="flex justify-between gap-4">
              <span className="app-tooltip-muted">{item.name}</span>
              <span className="font-financial">
                {formatCurrency(displayValue, displayCurrency)}
                {' '}
                ({formatSignedCurrency(change, displayCurrency)})
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
  mode,
  groups,
  series,
  displayCurrency,
  emptyLabel = 'No net worth history in this range.',
}: NetWorthCardProps) {
  const shouldReduceMotion = useReducedMotion()
  const latest = series.at(-1)
  const chartItems = useMemo(
    () => (mode === 'overview' ? getOverviewItems(groups) : getCompositionItems(groups)),
    [groups, mode],
  )
  const deltaSeries = useMemo(() => getChartData(series, chartItems), [chartItems, series])
  const hasChartData = groups.length > 0 && deltaSeries.length > 0
  const legendItems = useMemo(
    () => [
      { id: 'net-worth-change', name: 'Net Worth Change', color: netWorthChangeColor },
      ...chartItems.map((item) => ({ id: item.id, name: item.name, color: item.color })),
    ],
    [chartItems],
  )
  const legendAnimationKey = `${mode}-${legendItems.map((item) => item.id).join('|')}`
  const latestChange = deltaSeries.at(-1)?.totalChange ?? 0
  const netWorthTrendColor = latestChange > 0
    ? 'var(--app-positive)'
    : latestChange < 0
      ? 'var(--app-negative)'
      : 'var(--app-text-muted)'
  const NetWorthTrendIcon = latestChange > 0 ? TrendingUp : latestChange < 0 ? TrendingDown : Minus

  return (
    <section className="app-card">
      {header}
      <div className="flex h-[360px] flex-col">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="pl-4">
            <p className="app-label app-label-compact">Current Net Worth</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="font-financial text-3xl leading-none tracking-tight">
                {formatCurrency(latest?.total ?? 0, displayCurrency)}
              </p>
              <div className="flex items-center gap-1.5 pb-0.5 text-sm font-medium" style={{ color: netWorthTrendColor }}>
                <NetWorthTrendIcon size={14} aria-hidden />
                <span className="font-financial">{formatSignedCurrency(latestChange, displayCurrency)}</span>
                <span style={{ color: 'var(--app-text-subtle)' }}>since start</span>
              </div>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {!hasChartData ? (
            <div
              className="flex h-full w-full items-center justify-center rounded-lg text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {emptyLabel}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={deltaSeries}
                margin={{ top: 4, right: 8, bottom: 0, left: netWorthChartLeftMargin }}
              >
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
                  content={<NetWorthChartTooltip items={chartItems} displayCurrency={displayCurrency} />}
                />
                {chartItems.map((item, index) => (
                  <Bar
                    key={item.id}
                    dataKey={getChartKey(index)}
                    stackId="net-worth-contribution"
                    fill={item.color}
                    maxBarSize={34}
                    radius={4}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="totalChange"
                  stroke={netWorthChangeColor}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-3 overflow-hidden">
          <AnimatePresence initial={false} mode="wait">
            {hasChartData && (
              <motion.div
                key={legendAnimationKey}
                className="flex flex-wrap justify-center gap-x-4 gap-y-1"
                variants={shouldReduceMotion ? undefined : netWorthLegendContainerVariants}
                initial={shouldReduceMotion ? false : 'initial'}
                animate={shouldReduceMotion ? { opacity: 1 } : 'enter'}
                exit={shouldReduceMotion ? undefined : 'exit'}
              >
                {legendItems.map((item) => (
                  <motion.div
                    key={item.id}
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: 'var(--app-text-muted)' }}
                    variants={shouldReduceMotion ? undefined : netWorthLegendItemVariants}
                    transition={shouldReduceMotion ? { duration: 0 } : netWorthLegendItemTransition}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                    <span>{item.name}</span>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}
