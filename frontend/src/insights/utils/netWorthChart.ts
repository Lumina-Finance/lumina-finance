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

export function formatSignedNetWorthCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

export function formatNetWorthAxisMoney(value: number, currency: string) {
  return formatCompactMoney(value, currency, netWorthAxisMoneyRules, { prefix: '' })
}

export function formatNetWorthAxisDate(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function getValueKey(index: number) {
  return `series${index}Value`
}

export function getChangeKey(index: number) {
  return `series${index}Change`
}

export function getChartKey(index: number) {
  return `series${index}Chart`
}

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
