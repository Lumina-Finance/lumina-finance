import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeftRight,
  ArrowUpToLine,
  CalendarDays,
  ListChecks,
  Network,
  PieChart as PieChartIcon,
  Repeat,
  Sparkles,
  Store,
  Wallet,
} from 'lucide-react'
import {
  useInsightsCashFlow,
  useInsightsIncomeExpenseBreakdown,
  useInsightsFundFlow,
  useInsightsMerchantDistribution,
  useInsightsMerchantRanking,
  useInsightsNetWorth,
  useInsightsPeriodGlance,
  useInsightsSavingsRateTrend,
  type InsightsBreakdownEntry,
  type InsightsCashFlowResponse,
  type InsightsCategoryTrendEntry,
  type InsightsFlowEntry,
  type InsightsIncomeExpenseBreakdownResponse,
  type InsightsFundFlowResponse,
  type InsightsMerchantDistributionResponse,
  type InsightsMerchantRankingResponse,
  type InsightsNetWorthResponse,
  type InsightsPeriodGlanceResponse,
  type InsightsSavingsRateTrendResponse,
} from '@/api/insights'
import { formatCurrency } from '@/utils/formatCurrency'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { useAuth } from '@/hooks/useAuth'
import {
  CashFlowCard,
  type CashFlowBarBucket,
  type CashFlowGranularity,
} from './components/CashFlowCard'
import {
  IncomeExpenseBreakdownCard,
  type BreakdownEntry,
  type BreakdownMode,
  type CategoryDriver,
  type CategoryTrendSection,
} from './components/IncomeExpenseBreakdownCard'
import {
  InsightsFloatingRangeControl,
  type InsightsRangePreset,
} from './components/InsightsFloatingRangeControl'
import {
  MerchantDistributionCard,
  type MerchantMarketTile,
} from './components/MerchantDistributionCard'
import {
  MerchantRankingCard,
  type MerchantRankingRow,
} from './components/MerchantRankingCard'
import {
  FundFlowCard,
  type FundFlowData,
  type FundFlowNode,
} from './components/FundFlowCard'
import {
  NetWorthCard,
  type NetWorthGroup,
  type NetWorthPoint,
  type NetWorthViewMode,
} from './components/NetWorthCard'
import { PeriodGlanceCard } from './components/PeriodGlanceCard'
import {
  SavingsRateTrendCard,
  type SavingsRateHistoryPoint,
} from './components/SavingsRateTrendCard'

type MerchantMarketEntry = {
  id: string
  name: string
  totalAmount: number
  changePct: number | null
  changeAmount: number | null
}

type InsightSignal = {
  label: string
  value: string
  detail: string
  tone: 'positive' | 'neutral' | 'negative'
}

type NetWorthGranularity = 'day' | 'week' | 'month'

type PeriodBrief = {
  metrics: Array<{
    label: string
    value: number
    detail: string
    tone: InsightSignal['tone']
    signed?: boolean
  }>
  signals: Array<{
    label: string
    value: string
    detail: string
  }>
}

function useInsightCardVisibility() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined

    if (typeof IntersectionObserver === 'undefined') {
      const frameId = window.requestAnimationFrame(() => setIsVisible(true))
      return () => window.cancelAnimationFrame(frameId)
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting)
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, isVisible] as const
}

const EMPTY_FLOW_ENTRIES: InsightsFlowEntry[] = []

function formatYmd(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseYmd(ymd: string) {
  const [year, month, day] = ymd.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function getDefaultCustomRange() {
  const today = new Date()
  return {
    from: formatYmd(addDays(today, -29)),
    to: formatYmd(today),
  }
}

function getCustomRangeDays(from: string, to: string) {
  const fromDate = parseYmd(from)
  const toDate = parseYmd(to)
  if (!fromDate || !toDate || fromDate > toDate) return null
  return Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1)
}

function getSavingsRate(income: number, expenses: number) {
  if (income <= 0) return null
  return Math.round(((income - expenses) / income) * 100)
}

function formatSavingsRateValue(rate: number | null) {
  return rate === null ? 'N/A' : `${rate}%`
}

function formatSignedCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

function getStartOfWeek(date: Date) {
  const day = date.getDay()
  return addDays(date, -(day === 0 ? 6 : day - 1))
}

function getRangeDates(preset: InsightsRangePreset, customFrom: string, customTo: string) {
  if (preset === 'CUSTOM') {
    const fromDate = parseYmd(customFrom)
    const toDate = parseYmd(customTo)
    if (fromDate && toDate && fromDate <= toDate) {
      const dates: Date[] = []
      let cursor = fromDate
      while (cursor <= toDate) {
        dates.push(cursor)
        cursor = addDays(cursor, 1)
      }
      return dates
    }
  }

  const today = new Date()
  const rangeBoundary = (() => {
    switch (preset) {
      case 'THIS_WEEK':
        return { start: getStartOfWeek(today), end: today }
      case 'THIS_MONTH':
        return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today }
      case 'THIS_YEAR':
        return { start: new Date(today.getFullYear(), 0, 1), end: today }
      case 'LAST_WEEK': {
        const start = addDays(getStartOfWeek(today), -7)
        return { start, end: addDays(start, 6) }
      }
      case 'LAST_MONTH': {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        return { start, end: new Date(today.getFullYear(), today.getMonth(), 0) }
      }
      case 'CUSTOM':
        return { start: addDays(today, -29), end: today }
      default:
        return { start: addDays(today, -29), end: today }
    }
  })()

  const dates: Date[] = []
  let cursor = rangeBoundary.start
  while (cursor <= rangeBoundary.end) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
}

function getRangeInputDates(preset: InsightsRangePreset, customFrom: string, customTo: string) {
  if (preset === 'CUSTOM') {
    return { from: customFrom, to: customTo }
  }

  const dates = getRangeDates(preset, customFrom, customTo)
  const firstDate = dates[0]
  const lastDate = dates.at(-1)
  return {
    from: firstDate ? formatYmd(firstDate) : customFrom,
    to: lastDate ? formatYmd(lastDate) : customTo,
  }
}

function getShortDateLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getMonthLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short' })
}

function getNetWorthGranularity(dayCount: number): NetWorthGranularity {
  if (dayCount <= 30) return 'day'
  if (dayCount <= 90) return 'week'
  return 'month'
}

function getIsoWeek(date: Date) {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  normalized.setUTCDate(normalized.getUTCDate() + 4 - (normalized.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1))
  return Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getCashFlowGranularity(dayCount: number): CashFlowGranularity {
  if (dayCount <= 31) return 'day'
  if (dayCount <= 90) return 'week'
  return 'month'
}

function getCashFlowBarData(
  response: InsightsCashFlowResponse | undefined,
  fromDate: string,
  toDate: string,
) {
  const dayCount = getCustomRangeDays(fromDate, toDate) ?? 1
  const granularity = getCashFlowGranularity(dayCount)
  return {
    granularity,
    buckets: (response?.points ?? []).map(([bucketStart, bucketEnd, inflow, outflow]): CashFlowBarBucket => {
      const firstDate = parseYmd(bucketStart)
      const lastDate = parseYmd(bucketEnd)
      const label = granularity === 'day'
        ? (firstDate ? getShortDateLabel(firstDate) : bucketStart)
        : granularity === 'week'
          ? firstDate ? `W${getIsoWeek(firstDate)}` : bucketStart
          : firstDate ? getMonthLabel(firstDate) : bucketStart
      const rangeLabel = firstDate && lastDate && firstDate.getTime() === lastDate.getTime()
        ? getShortDateLabel(firstDate)
        : firstDate && lastDate
          ? `${getShortDateLabel(firstDate)}-${getShortDateLabel(lastDate)}`
          : `${bucketStart}-${bucketEnd}`

      return {
        label,
        rangeLabel,
        inflow,
        outflow,
        net: inflow - outflow,
      }
    }),
  }
}

function getSavingsRateHistory(response: InsightsSavingsRateTrendResponse | undefined): SavingsRateHistoryPoint[] {
  const rows = response?.points ?? []

  return rows.map(([monthKey, income, expenses], index) => {
    const month = new Date(`${monthKey}T00:00:00`)
    const rate = income > 0
      ? Math.round(((income - expenses) / income) * 100)
      : expenses > 0
        ? -100
        : null
    const monthLabel = getMonthLabel(month)

    return {
      monthKey,
      monthLabel,
      tickLabel: month.getMonth() === 0 ? `${monthLabel} '${String(month.getFullYear()).slice(2)}` : monthLabel,
      fullLabel: month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      rate,
      income,
      expenses,
      isCurrent: index === rows.length - 1,
    }
  })
}

function getFlowDataFromEntries(
  incomeEntries: InsightsFlowEntry[],
  expenseEntries: InsightsFlowEntry[],
): FundFlowData {
  if (incomeEntries.length === 0 && expenseEntries.length === 0) {
    return { nodes: [], links: [] }
  }

  const incomeTotal = incomeEntries.reduce((sum, [, amount]) => sum + amount, 0)
  const expenseTotal = expenseEntries.reduce((sum, [, amount]) => sum + amount, 0)
  const nodes: FundFlowNode[] = [
    ...incomeEntries.map((entry) => {
      const [name] = entry
      return {
        name,
        kind: 'income' as const,
        labelSide: 'right' as const,
      }
    }),
    { name: 'Income', kind: 'summary' },
    { name: 'Expenses', kind: 'summary' },
    ...expenseEntries.map((entry) => {
      const [name] = entry
      return {
        name,
        kind: 'expense' as const,
        labelSide: 'left' as const,
      }
    }),
  ]
  const incomeSummaryIndex = incomeEntries.length
  const expenseSummaryIndex = incomeSummaryIndex + 1
  const retainedIndex = nodes.length
  const retained = Math.max(incomeTotal - expenseTotal, 0)
  if (retained > 0) {
    nodes.push({ name: 'Retained', kind: 'retained' })
  }

  const links = [
    ...incomeEntries.map(([, amount], index) => ({
      source: index,
      target: incomeSummaryIndex,
      value: amount,
    })),
    ...(retained > 0 ? [{ source: incomeSummaryIndex, target: retainedIndex, value: retained }] : []),
    ...(incomeTotal > 0 && expenseTotal > 0 ? [{
      source: incomeSummaryIndex,
      target: expenseSummaryIndex,
      value: Math.min(incomeTotal, expenseTotal),
    }] : []),
    ...expenseEntries.map(([, amount], index) => ({
      source: expenseSummaryIndex,
      target: expenseSummaryIndex + 1 + index,
      value: amount,
    })),
  ]

  return { nodes, links }
}

function getFlowData(data: InsightsFundFlowResponse | undefined): FundFlowData {
  if (!data) {
    return { nodes: [], links: [] }
  }
  return getFlowDataFromEntries(
    data.income_sources,
    data.expense_categories,
  )
}

function getBreakdownEntries(entries: InsightsBreakdownEntry[] | undefined): BreakdownEntry[] {
  return (entries ?? []).map(([id, name, amount]) => ({ id, name, amount }))
}

function getCategoryDrivers(entries: InsightsCategoryTrendEntry[] | undefined): CategoryDriver[] {
  return (entries ?? []).map(([id, name, amount, previousAmount, changePct, transactionCount]) => ({
    id,
    name,
    amount,
    previousAmount,
    changePct,
    transactionCount,
  }))
}

function getBreakdownEntriesForMode(
  data: InsightsIncomeExpenseBreakdownResponse | undefined,
  mode: BreakdownMode,
): BreakdownEntry[] {
  return getBreakdownEntries(mode === 'expense' ? data?.expense : data?.income)
}

function getCategoryTrendSections(
  data: InsightsIncomeExpenseBreakdownResponse | undefined,
  mode: BreakdownMode,
): CategoryTrendSection[] {
  return [
    {
      id: 'increases',
      label: 'Top Increases',
      drivers: getCategoryDrivers(mode === 'expense' ? data?.expense_increases : data?.income_increases),
    },
    {
      id: 'decreases',
      label: 'Top Decreases',
      drivers: getCategoryDrivers(mode === 'expense' ? data?.expense_decreases : data?.income_decreases),
    },
  ]
}

function getNetWorthCardData(
  response: InsightsNetWorthResponse | undefined,
  fromDate: string,
  toDate: string,
): { groups: NetWorthGroup[]; series: NetWorthPoint[] } {
  if (!response) return { groups: [], series: [] }

  const groups = response.groups ?? []
  const points = response.points ?? []
  const dayCount = getCustomRangeDays(fromDate, toDate) ?? 1
  const granularity = getNetWorthGranularity(dayCount)
  return {
    groups: groups.map(([id, name, kind]) => ({ id, name, kind })),
    series: points.map(([labelDate, valueDate, values]) => {
      const label = parseYmd(labelDate)
      const tooltip = parseYmd(valueDate)
      return {
        date: labelDate,
        dateLabel: label
          ? label.toLocaleDateString('en-US', {
              month: 'short',
              day: granularity === 'month' ? undefined : 'numeric',
            })
          : labelDate,
        tooltipLabel: tooltip
          ? tooltip.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : valueDate,
        total: values.reduce((sum, value) => sum + value, 0),
        values,
      }
    }),
  }
}

function getPeriodGlanceBrief(data: InsightsPeriodGlanceResponse, displayCurrency: string): PeriodBrief {
  const netSavings = data.income - data.expenses
  const savingsRate = getSavingsRate(data.income, data.expenses)

  return {
    metrics: [
      {
        label: netSavings >= 0 ? 'You Kept' : 'You Overspent',
        value: netSavings,
        detail: netSavings >= 0
          ? 'Recorded income exceeds recorded expenses in the selected range, excluding transfers'
          : 'Recorded expenses exceed recorded income in the selected range, excluding transfers',
        tone: netSavings >= 0 ? 'positive' : 'negative',
      },
      {
        label: 'Net Worth Changed By',
        value: data.net_worth_change,
        detail: 'Across all accounts',
        tone: data.net_worth_change >= 0 ? 'positive' : 'negative',
        signed: true,
      },
    ],
    signals: [
      {
        label: 'Biggest Change',
        value: data.biggest_change_name ?? 'N/A',
        detail: data.biggest_change_name && data.biggest_change_amount !== undefined
          ? getPeriodGlanceChangeDetail(data.biggest_change_amount, data.biggest_change_pct, displayCurrency)
          : 'No comparable category movement in this range',
      },
      {
        label: 'Top Category',
        value: data.top_category_name ?? 'N/A',
        detail: data.top_category_share_pct === undefined
          ? 'No recorded expenses in this range'
          : `${data.top_category_share_pct}% of recorded expenses`,
      },
      {
        label: 'Savings Rate',
        value: formatSavingsRateValue(savingsRate),
        detail: savingsRate === null
          ? 'No recorded income in the selected range'
          : 'Income kept after expenses, excluding transfers',
      },
    ],
  }
}

function getLoadingPeriodGlanceBrief(): PeriodBrief {
  return {
    metrics: [
      {
        label: 'You Kept',
        value: 0,
        detail: 'Loading period summary',
        tone: 'neutral',
      },
      {
        label: 'Net Worth Changed By',
        value: 0,
        detail: 'Loading tracked balance movement',
        tone: 'neutral',
        signed: true,
      },
    ],
    signals: [
      {
        label: 'Biggest Change',
        value: 'Loading',
        detail: 'Fetching comparable category movement',
      },
      {
        label: 'Top Category',
        value: 'Loading',
        detail: 'Fetching recorded expense categories',
      },
      {
        label: 'Savings Rate',
        value: 'Loading',
        detail: 'Fetching income and expense totals',
      },
    ],
  }
}

function getPeriodGlanceChangeDetail(changeAmount: number, changePct: number | undefined, displayCurrency: string) {
  const amount = formatSignedCurrency(changeAmount, displayCurrency)
  if (changePct === undefined) {
    return `${amount} vs previous matching period`
  }
  return `${amount} (${changePct > 0 ? '+' : ''}${changePct}%) vs previous matching period`
}

function getMerchantDistributionEntries(
  response: InsightsMerchantDistributionResponse | undefined,
): MerchantMarketEntry[] {
  return (response?.merchants ?? []).map(([id, name, totalAmount, changePct, changeAmount]) => ({
    id,
    name,
    totalAmount,
    changePct,
    changeAmount,
  }))
}

function getMerchantRankingRows(
  response: InsightsMerchantRankingResponse | undefined,
): MerchantRankingRow[] {
  return (response?.merchants ?? []).map(([id, name, totalAmount, transactionCount, changePct]) => ({
    id,
    name,
    totalAmount,
    transactionCount,
    averageAmount: transactionCount > 0 ? Math.round(totalAmount / transactionCount) : 0,
    changePct,
  }))
}

function splitTreemapItems(
  items: MerchantMarketTile[],
  x: number,
  y: number,
  width: number,
  height: number,
): MerchantMarketTile[] {
  if (items.length <= 1) {
    const item = items[0]
    return item ? [{ ...item, x, y, width, height }] : []
  }

  const total = items.reduce((sum, item) => sum + item.totalAmount, 0)
  let running = 0
  let splitIndex = 1
  for (let index = 0; index < items.length - 1; index += 1) {
    running += items[index].totalAmount
    if (running >= total / 2) {
      splitIndex = index + 1
      break
    }
  }

  const firstGroup = items.slice(0, splitIndex)
  const secondGroup = items.slice(splitIndex)
  const firstTotal = firstGroup.reduce((sum, item) => sum + item.totalAmount, 0)
  const firstShare = total > 0 ? firstTotal / total : 0.5

  if (width >= height) {
    const firstWidth = width * firstShare
    return [
      ...splitTreemapItems(firstGroup, x, y, firstWidth, height),
      ...splitTreemapItems(secondGroup, x + firstWidth, y, width - firstWidth, height),
    ]
  }

  const firstHeight = height * firstShare
  return [
    ...splitTreemapItems(firstGroup, x, y, width, firstHeight),
    ...splitTreemapItems(secondGroup, x, y + firstHeight, width, height - firstHeight),
  ]
}

function getMerchantMarketLayout(merchants: MerchantMarketEntry[]): MerchantMarketTile[] {
  return splitTreemapItems(
    merchants.map((merchant) => ({
      ...merchant,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })),
    0,
    0,
    1000,
    460,
  )
}

function SectionHeader({
  icon: Icon,
  label,
  action,
}: {
  icon: typeof Network
  label: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
        <Icon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label">{label}</span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

export default function InsightsPage() {
  const { user } = useAuth()
  const defaultCustomRange = useMemo(() => getDefaultCustomRange(), [])
  const [rangePreset, setRangePreset] = useState<InsightsRangePreset>('THIS_MONTH')
  const [customFrom, setCustomFrom] = useState(defaultCustomRange.from)
  const [customTo, setCustomTo] = useState(defaultCustomRange.to)
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('expense')
  const [netWorthMode, setNetWorthMode] = useState<NetWorthViewMode>('overview')
  const [capSavingsRateChart, setCapSavingsRateChart] = useState(false)
  const [periodGlanceCardRef, periodGlanceCardVisible] = useInsightCardVisibility()
  const [fundFlowCardRef, fundFlowCardVisible] = useInsightCardVisibility()
  const [breakdownCardRef, breakdownCardVisible] = useInsightCardVisibility()
  const [netWorthCardRef, netWorthCardVisible] = useInsightCardVisibility()
  const [cashFlowCardRef, cashFlowCardVisible] = useInsightCardVisibility()
  const [savingsRateCardRef, savingsRateCardVisible] = useInsightCardVisibility()
  const [merchantDistributionCardRef, merchantDistributionCardVisible] = useInsightCardVisibility()
  const [merchantRankingCardRef, merchantRankingCardVisible] = useInsightCardVisibility()
  const customInvalid = rangePreset === 'CUSTOM'
    && customFrom !== ''
    && customTo !== ''
    && getCustomRangeDays(customFrom, customTo) === null
  const rangeInputDates = useMemo(() => getRangeInputDates(rangePreset, customFrom, customTo), [rangePreset, customFrom, customTo])
  const cardTransitionKey = `${rangeInputDates.from}:${rangeInputDates.to}`
  const insightsCardQueriesEnabled = !customInvalid && rangeInputDates.from !== '' && rangeInputDates.to !== ''
  const periodGlanceQuery = useInsightsPeriodGlance(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled && periodGlanceCardVisible,
  )
  const fundFlowQuery = useInsightsFundFlow(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled && fundFlowCardVisible,
  )
  const incomeExpenseBreakdownQuery = useInsightsIncomeExpenseBreakdown(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled && breakdownCardVisible,
  )
  const netWorthQuery = useInsightsNetWorth(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled && netWorthCardVisible,
  )
  const cashFlowQuery = useInsightsCashFlow(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled && cashFlowCardVisible,
  )
  const merchantDistributionQuery = useInsightsMerchantDistribution(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled && merchantDistributionCardVisible,
  )
  const merchantRankingQuery = useInsightsMerchantRanking(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled && merchantRankingCardVisible,
  )
  const savingsRateTrendQuery = useInsightsSavingsRateTrend(savingsRateCardVisible)
  const displayCurrency = user?.base_currency ?? 'CAD'
  const selectedBreakdown = useMemo(
    () => getBreakdownEntriesForMode(incomeExpenseBreakdownQuery.data, breakdownMode),
    [breakdownMode, incomeExpenseBreakdownQuery.data],
  )
  const flowData = useMemo(() => getFlowData(fundFlowQuery.data), [fundFlowQuery.data])
  const flowIncomeSources = fundFlowQuery.data?.income_sources ?? EMPTY_FLOW_ENTRIES
  const flowExpenseCategories = fundFlowQuery.data?.expense_categories ?? EMPTY_FLOW_ENTRIES
  const flowIncomeOutflows = fundFlowQuery.data?.income_outflows ?? EMPTY_FLOW_ENTRIES
  const flowExpenseInflows = fundFlowQuery.data?.expense_inflows ?? EMPTY_FLOW_ENTRIES
  const flowIncomeSourceCount = fundFlowQuery.data?.income_source_count ?? 0
  const flowExpenseCategoryCount = fundFlowQuery.data?.expense_category_count ?? 0
  const flowEmptyLabel = fundFlowQuery.isLoading
    ? 'Loading fund flow...'
    : 'No income or expenses in this range.'
  const selectedCategoryTrendSections = useMemo(
    () => getCategoryTrendSections(incomeExpenseBreakdownQuery.data, breakdownMode),
    [breakdownMode, incomeExpenseBreakdownQuery.data],
  )
  const periodBrief = useMemo(() => {
    if (periodGlanceQuery.data) {
      return getPeriodGlanceBrief(periodGlanceQuery.data, displayCurrency)
    }
    return getLoadingPeriodGlanceBrief()
  }, [displayCurrency, periodGlanceQuery.data])
  const primaryBriefMetric = periodBrief.metrics[0]
  const secondaryBriefMetric = periodBrief.metrics[1]
  const primaryBriefMetricValue = primaryBriefMetric.signed
    ? formatSignedCurrency(primaryBriefMetric.value, displayCurrency)
    : formatCurrency(primaryBriefMetric.value, displayCurrency)
  const periodGlanceIncome = periodGlanceQuery.data?.income ?? 0
  const periodGlanceExpenses = periodGlanceQuery.data?.expenses ?? 0
  const briefSupportItems = [
    {
      label: secondaryBriefMetric.label,
      value: secondaryBriefMetric.signed
        ? formatSignedCurrency(secondaryBriefMetric.value, displayCurrency)
        : formatCurrency(secondaryBriefMetric.value, displayCurrency),
      detail: secondaryBriefMetric.detail,
      tone: secondaryBriefMetric.tone,
    },
    ...periodBrief.signals.map((signal) => ({
      label: signal.label,
      value: signal.value,
      detail: signal.detail,
      tone: 'neutral' as const,
    })),
  ]
  const netWorthCardData = useMemo(
    () => getNetWorthCardData(netWorthQuery.data, rangeInputDates.from, rangeInputDates.to),
    [netWorthQuery.data, rangeInputDates.from, rangeInputDates.to],
  )
  const cashFlowBars = useMemo(
    () => getCashFlowBarData(cashFlowQuery.data, rangeInputDates.from, rangeInputDates.to),
    [cashFlowQuery.data, rangeInputDates.from, rangeInputDates.to],
  )
  const savingsRateHistory = useMemo(
    () => getSavingsRateHistory(savingsRateTrendQuery.data),
    [savingsRateTrendQuery.data],
  )
  const merchantMarketLayout = useMemo(
    () => getMerchantMarketLayout(getMerchantDistributionEntries(merchantDistributionQuery.data)),
    [merchantDistributionQuery.data],
  )
  const rankedMerchants = useMemo(
    () => getMerchantRankingRows(merchantRankingQuery.data),
    [merchantRankingQuery.data],
  )
  return (
    <div className="relative">
      <header className="app-page-header min-[1050px]:pr-[25rem]">
        <h1 className="app-page-title">Insights</h1>
        <p className="app-page-description">
          See where your money goes, spot patterns, and take control with confidence.
        </p>
      </header>
      <InsightsFloatingRangeControl
        preset={rangePreset}
        fromDateValue={rangeInputDates.from}
        toDateValue={rangeInputDates.to}
        customInvalid={customInvalid}
        onPresetChange={setRangePreset}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      <div className="space-y-4 pb-28 min-[1050px]:pb-0">
        <div ref={periodGlanceCardRef}>
          <PeriodGlanceCard
            header={<SectionHeader icon={Sparkles} label="This Period at a Glance" />}
            primaryMetric={{
              label: primaryBriefMetric.label,
              value: primaryBriefMetricValue,
              detail: primaryBriefMetric.detail,
              tone: primaryBriefMetric.tone,
            }}
            supportItems={briefSupportItems}
            income={periodGlanceIncome}
            expenses={periodGlanceExpenses}
            displayCurrency={displayCurrency}
            loading={periodGlanceQuery.isFetching}
            transitionKey={cardTransitionKey}
          />
        </div>

        <div ref={fundFlowCardRef}>
          <FundFlowCard
            header={<SectionHeader icon={Network} label="Fund Flow" />}
            flowData={flowData}
            incomeSources={flowIncomeSources}
            expenseCategories={flowExpenseCategories}
            incomeOutflows={flowIncomeOutflows}
            expenseInflows={flowExpenseInflows}
            incomeSourceCount={flowIncomeSourceCount}
            expenseCategoryCount={flowExpenseCategoryCount}
            displayCurrency={displayCurrency}
            loading={fundFlowQuery.isFetching}
            transitionKey={cardTransitionKey}
            emptyLabel={flowEmptyLabel}
          />
        </div>

        <div ref={breakdownCardRef}>
          <IncomeExpenseBreakdownCard
            header={(
              <SectionHeader
                icon={PieChartIcon}
                label={(
                  <span className="inline-flex items-baseline whitespace-nowrap">
                    <AppSlotMachineText text={breakdownMode === 'expense' ? 'Expense' : 'Income'} />
                    <span className="ml-[0.25em]">Breakdown</span>
                  </span>
                )}
                action={(
                  <button
                    type="button"
                    onClick={() => setBreakdownMode((mode) => (mode === 'expense' ? 'income' : 'expense'))}
                    title={breakdownMode === 'expense' ? 'Show income breakdown' : 'Show expense breakdown'}
                    aria-label={breakdownMode === 'expense' ? 'Show income breakdown' : 'Show expense breakdown'}
                    className="app-icon-button"
                  >
                    <Repeat size={12} />
                  </button>
                )}
              />
            )}
            mode={breakdownMode}
            entries={selectedBreakdown}
            trendSections={selectedCategoryTrendSections}
            displayCurrency={displayCurrency}
            animationKey={`${breakdownMode}-${cardTransitionKey}`}
            loading={incomeExpenseBreakdownQuery.isFetching}
            transitionKey={cardTransitionKey}
          />
        </div>

        <div ref={netWorthCardRef}>
          <NetWorthCard
            header={(
              <SectionHeader
                icon={Wallet}
                label="Net Worth"
                action={(
                  <button
                    type="button"
                    onClick={() => setNetWorthMode((mode) => (mode === 'overview' ? 'composition' : 'overview'))}
                    title={netWorthMode === 'overview' ? 'Show grouped composition' : 'Show asset and debt overview'}
                    aria-label={netWorthMode === 'overview' ? 'Show grouped composition' : 'Show asset and debt overview'}
                    className="app-icon-button"
                  >
                    <ArrowLeftRight size={12} />
                  </button>
                )}
              />
            )}
            mode={netWorthMode}
            groups={netWorthCardData.groups}
            series={netWorthCardData.series}
            displayCurrency={displayCurrency}
            emptyLabel={netWorthQuery.isLoading ? 'Loading net worth history...' : undefined}
            loading={netWorthQuery.isFetching}
            transitionKey={cardTransitionKey}
          />
        </div>

        <div ref={cashFlowCardRef}>
          <CashFlowCard
            header={<SectionHeader icon={CalendarDays} label="Cash Flow" />}
            granularity={cashFlowBars.granularity}
            buckets={cashFlowBars.buckets}
            displayCurrency={displayCurrency}
            loading={cashFlowQuery.isFetching}
            transitionKey={cardTransitionKey}
          />
        </div>

        <div ref={savingsRateCardRef}>
          <SavingsRateTrendCard
            header={(
              <SectionHeader
                icon={Repeat}
                label="Savings Rate Trend"
                action={(
                  <button
                    type="button"
                    onClick={() => setCapSavingsRateChart((current) => !current)}
                    title={capSavingsRateChart ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
                    aria-label={capSavingsRateChart ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
                    className="app-icon-button"
                  >
                    <ArrowUpToLine
                      size={12}
                      className={`transition-transform duration-150 motion-reduce:transition-none ${capSavingsRateChart ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              />
            )}
            series={savingsRateHistory}
            displayCurrency={displayCurrency}
            capRates={capSavingsRateChart}
            emptyLabel={savingsRateTrendQuery.isLoading ? 'Loading savings-rate history...' : undefined}
            loading={savingsRateTrendQuery.isFetching}
            transitionKey="savings-rate-trend"
          />
        </div>

        <section className="grid gap-4 min-[1300px]:grid-cols-[minmax(0,1fr)_360px]">
          <div ref={merchantDistributionCardRef} className="min-w-0">
            <MerchantDistributionCard
              header={<SectionHeader icon={Store} label="Spending Distribution by Merchant" />}
              merchants={merchantMarketLayout}
              currency={displayCurrency}
              emptyLabel={merchantDistributionQuery.isLoading ? 'Loading merchant spending...' : undefined}
              loading={merchantDistributionQuery.isFetching}
              transitionKey={cardTransitionKey}
            />
          </div>

          <div ref={merchantRankingCardRef} className="min-w-0">
            <MerchantRankingCard
              header={<SectionHeader icon={ListChecks} label="Merchant Ranking" />}
              merchants={rankedMerchants}
              currency={displayCurrency}
              emptyLabel={merchantRankingQuery.isLoading ? 'Loading merchant ranking...' : undefined}
              loading={merchantRankingQuery.isFetching}
              transitionKey={cardTransitionKey}
            />
          </div>
        </section>

      </div>
    </div>
  )
}
