import { formatCurrency } from '@/utils/formatCurrency'
import { formatCompactMoney, type CompactMoneyRule } from '@/utils/formatCompactMoney'

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

export type NetWorthChartItem = {
  id: string
  name: string
  color: string
  kind: 'asset' | 'debt'
  getValue: (point: NetWorthPoint) => number
}

export type NetWorthDeltaPoint = NetWorthPoint & {
  dateMs: number
  startTotal: number
  totalChange: number
  [key: string]: string | number | number[]
}

export const netWorthChartLeftMargin = 0
export const netWorthChangeColor = '#1F3F73'
export const NET_WORTH_AXIS_TICK_COUNT = 5

const DAY_MS = 24 * 60 * 60 * 1000
const assetContributionColor = 'var(--app-chart-positive)'
const debtContributionColor = 'var(--app-chart-negative)'
const compositionAssetFallbackColor = '#6F98B7'
const compositionDebtFallbackColor = 'var(--app-chart-negative)'

const groupColors: Record<string, string> = {
  cash: '#2F80A7',
  term_deposits: '#D67A45',
  investments: '#37434F',
  other_assets: '#8F989F',
  revolving_debt: 'var(--app-chart-negative)',
  loans: '#D0717D',
  mortgages: '#9E4F4A',
  other_debt: '#7F4D52',
}

const netWorthAxisMoneyRules: CompactMoneyRule[] = [
  { threshold: 100_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 0 },
  { threshold: 10_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
  { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
  { threshold: 100_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 },
  { threshold: 10_000, divisor: 1_000, suffix: 'K', fractionDigits: 1 },
  { threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 },
]

/**
 * Formats signed currency changes without showing a sign for unchanged values
 */
export function formatSignedNetWorthCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

/**
 * Formats a net worth chart axis value with K/M compaction rules and no currency prefix
 */
export function formatNetWorthAxisMoney(value: number, currency: string) {
  return formatCompactMoney(value, currency, netWorthAxisMoneyRules, { prefix: '' })
}

/**
 * Formats an axis tick timestamp as a short month and day, read in UTC so the label matches the
 * underlying data point's calendar date rather than the viewer's local timezone
 */
export function formatNetWorthAxisDate(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

/**
 * Builds the per-series data key that holds a chart item's raw value at each point
 */
export function getValueKey(index: number) {
  return `series${index}Value`
}

/**
 * Builds the per-series data key that holds a chart item's change from the baseline point
 */
export function getChangeKey(index: number) {
  return `series${index}Change`
}

/**
 * Builds the per-series data key the chart actually plots, which holds the raw value or the
 * change from baseline depending on which key was written for the active view mode
 */
export function getChartKey(index: number) {
  return `series${index}Chart`
}

/**
 * Builds the chart items for the active view mode: one item per account group in composition
 * mode, or two combined items, assets and debt, that each sum their member groups in overview
 * mode
 */
export function getNetWorthChartItems(
  groups: NetWorthGroup[],
  mode: NetWorthViewMode,
): NetWorthChartItem[] {
  if (mode === 'composition') {
    return groups.map((group, index) => ({
      id: group.id,
      name: group.name,
      kind: group.kind,
      color: getGroupColor(group),
      getValue: (point) => point.values[index] ?? 0,
    }))
  }

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

/**
 * Turns the raw series into chart points with values relative to a baseline, writing each item's
 * raw value, its change from baseline, and the key the chart plots for the active view mode
 *
 * The baseline is the explicit baseline values when given, otherwise the first series point, so
 * a caller can pin the comparison to a day before the range without changing the plotted series
 */
export function getNetWorthChartData(
  series: NetWorthPoint[],
  items: NetWorthChartItem[],
  mode: NetWorthViewMode,
  baselineValues: number[] = [],
): NetWorthDeltaPoint[] {
  const start = series[0]
  if (!start) return []
  const effectiveBaselineValues = baselineValues.length > 0 ? baselineValues : start.values
  const baselinePoint: NetWorthPoint = {
    ...start,
    total: effectiveBaselineValues.reduce((sum, value) => sum + value, 0),
    values: effectiveBaselineValues,
  }
  const startValues = items.map((item) => item.getValue(baselinePoint))

  return series.map((point) => {
    const deltaPoint: NetWorthDeltaPoint = {
      ...point,
      dateMs: dateStringToUtcMs(point.date),
      startTotal: baselinePoint.total,
      totalChange: point.total - baselinePoint.total,
    }

    items.forEach((item, index) => {
      const value = item.getValue(point)
      const change = value - startValues[index]
      deltaPoint[getValueKey(index)] = value
      deltaPoint[getChangeKey(index)] = change
      deltaPoint[getChartKey(index)] = mode === 'composition' ? value : change
    })

    return deltaPoint
  })
}

/**
 * Builds the chart legend entries, prefixing a net worth change swatch ahead of the chart items
 * in overview mode
 */
export function getNetWorthLegendItems(
  mode: NetWorthViewMode,
  items: NetWorthChartItem[],
) {
  return [
    ...(mode === 'overview'
      ? [{ id: 'net-worth-change', name: 'Net Worth Change', color: netWorthChangeColor }]
      : []),
    ...items.map((item) => ({ id: item.id, name: item.name, color: item.color })),
  ]
}

/**
 * Picks evenly spaced tick timestamps across the series' date range, always keeping the first
 * and last points so the axis anchors on the range boundaries
 */
export function getNetWorthDateAxisTicks(
  series: NetWorthDeltaPoint[],
  tickCount: number,
): number[] {
  const startMs = series[0]?.dateMs
  const endMs = series.at(-1)?.dateMs
  if (startMs === undefined || endMs === undefined) return []
  if (tickCount <= 1 || startMs >= endMs) return [startMs]

  const totalDays = Math.round((endMs - startMs) / DAY_MS)
  return [...new Set(Array.from({ length: tickCount }, (_, index) => {
    if (index === 0) return startMs
    if (index === tickCount - 1) return endMs
    const dayOffset = Math.round((totalDays * index) / (tickCount - 1))
    return startMs + dayOffset * DAY_MS
  }))]
}

function getGroupColor(group: NetWorthGroup) {
  return groupColors[group.id] ?? (
    group.kind === 'asset' ? compositionAssetFallbackColor : compositionDebtFallbackColor
  )
}

function dateStringToUtcMs(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  if (year && month && day) return Date.UTC(year, month - 1, day)

  const parsed = new Date(date)
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
}
