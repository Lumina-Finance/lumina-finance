import { useMemo, useState } from 'react'
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
import type { SpendingRange } from '@/api/dashboard'
import {
  useInsightsIncomeExpenseBreakdown,
  useInsightsIncomeExpenseFlow,
  useInsightsMerchantDistribution,
  useInsightsMerchantRanking,
  useInsightsNetWorth,
  useInsightsPeriodGlance,
  useInsightsSavingsRateTrend,
  type InsightsBreakdownEntry,
  type InsightsCategoryTrendEntry,
  type InsightsFlowEntry,
  type InsightsIncomeExpenseBreakdownResponse,
  type InsightsIncomeExpenseFlowResponse,
  type InsightsMerchantDistributionResponse,
  type InsightsMerchantRankingResponse,
  type InsightsNetWorthResponse,
  type InsightsPeriodGlanceResponse,
  type InsightsSavingsRateTrendResponse,
} from '@/api/insights'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { formatCurrency } from '@/utils/formatCurrency'
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
import { InsightsRangeSelector, type InsightsRangeSelectorOption } from './components/InsightsRangeSelector'
import {
  MerchantDistributionCard,
  type MerchantMarketTile,
} from './components/MerchantDistributionCard'
import {
  MerchantRankingCard,
  type MerchantRankingRow,
} from './components/MerchantRankingCard'
import {
  IncomeExpenseSankeyCard,
  type IncomeExpenseFlowData,
  type IncomeExpenseFlowNode,
} from './components/IncomeExpenseSankeyCard'
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

type InsightsRangePreset = 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_YEAR' | 'LAST_WEEK' | 'LAST_MONTH' | 'CUSTOM'

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

type InsightScaffoldData = {
  periodLabel: string
  income: number
  expenses: number
  cashInflow: number
  cashOutflow: number
  transactionCount: number
  activeMerchants: number
  incomeBreakdown: BreakdownEntry[]
  expenseBreakdown: BreakdownEntry[]
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

const INSIGHTS_RANGE_OPTIONS: InsightsRangeSelectorOption<InsightsRangePreset>[] = [
  { value: 'THIS_WEEK', label: 'WTD', description: 'This week' },
  { value: 'THIS_MONTH', label: 'MTD', description: 'This month' },
  { value: 'THIS_YEAR', label: 'YTD', description: 'This year' },
  { value: 'LAST_WEEK', label: 'LW', description: 'Last week' },
  { value: 'LAST_MONTH', label: 'LM', description: 'Last month' },
  { value: 'CUSTOM', label: 'Custom' },
]

const presetScaffoldRange: Record<Exclude<InsightsRangePreset, 'CUSTOM'>, SpendingRange> = {
  THIS_WEEK: 'WTD',
  THIS_MONTH: 'MTD',
  THIS_YEAR: 'YTD',
  LAST_WEEK: 'WTD',
  LAST_MONTH: 'MTD',
}

const insightDataByRange: Record<SpendingRange, InsightScaffoldData> = {
  WTD: {
    periodLabel: 'This week',
    income: 285000,
    expenses: 112400,
    cashInflow: 297000,
    cashOutflow: 134400,
    transactionCount: 34,
    activeMerchants: 16,
    incomeBreakdown: [
      { id: 'salary', name: 'Salary', amount: 250000 },
      { id: 'freelance', name: 'Freelance', amount: 30000 },
      { id: 'interest', name: 'Interest', amount: 5000 },
    ],
    expenseBreakdown: [
      { id: 'groceries', name: 'Groceries', amount: 31800 },
      { id: 'dining', name: 'Dining', amount: 19600 },
      { id: 'transportation', name: 'Transportation', amount: 18400 },
      { id: 'subscriptions', name: 'Subscriptions', amount: 15400 },
      { id: 'shopping', name: 'Shopping', amount: 15200 },
      { id: 'health', name: 'Health', amount: 12000 },
    ],
  },
  MTD: {
    periodLabel: 'This month',
    income: 787600,
    expenses: 456300,
    cashInflow: 852600,
    cashOutflow: 521300,
    transactionCount: 126,
    activeMerchants: 42,
    incomeBreakdown: [
      { id: 'salary', name: 'Salary', amount: 650000 },
      { id: 'freelance', name: 'Freelance', amount: 104000 },
      { id: 'dividends', name: 'Dividends', amount: 21600 },
      { id: 'interest', name: 'Interest', amount: 12000 },
    ],
    expenseBreakdown: [
      { id: 'housing', name: 'Housing', amount: 210000 },
      { id: 'groceries', name: 'Groceries', amount: 74200 },
      { id: 'dining', name: 'Dining', amount: 38600 },
      { id: 'shopping', name: 'Shopping', amount: 35200 },
      { id: 'transportation', name: 'Transportation', amount: 28600 },
      { id: 'subscriptions', name: 'Subscriptions', amount: 18800 },
      { id: 'health', name: 'Health', amount: 14900 },
      { id: 'software', name: 'Software', amount: 36000 },
    ],
  },
  QTD: {
    periodLabel: 'This quarter',
    income: 2246800,
    expenses: 1394500,
    cashInflow: 2394800,
    cashOutflow: 1590500,
    transactionCount: 362,
    activeMerchants: 68,
    incomeBreakdown: [
      { id: 'salary', name: 'Salary', amount: 1950000 },
      { id: 'freelance', name: 'Freelance', amount: 214000 },
      { id: 'dividends', name: 'Dividends', amount: 52600 },
      { id: 'interest', name: 'Interest', amount: 30200 },
    ],
    expenseBreakdown: [
      { id: 'housing', name: 'Housing', amount: 630000 },
      { id: 'groceries', name: 'Groceries', amount: 225600 },
      { id: 'dining', name: 'Dining', amount: 116900 },
      { id: 'shopping', name: 'Shopping', amount: 114200 },
      { id: 'transportation', name: 'Transportation', amount: 92800 },
      { id: 'travel', name: 'Travel', amount: 88000 },
      { id: 'subscriptions', name: 'Subscriptions', amount: 54500 },
      { id: 'health', name: 'Health', amount: 42600 },
      { id: 'software', name: 'Software', amount: 29900 },
    ],
  },
  YTD: {
    periodLabel: 'This year',
    income: 5872400,
    expenses: 3698600,
    cashInflow: 6258400,
    cashOutflow: 4196600,
    transactionCount: 914,
    activeMerchants: 96,
    incomeBreakdown: [
      { id: 'salary', name: 'Salary', amount: 4875000 },
      { id: 'freelance', name: 'Freelance', amount: 704000 },
      { id: 'dividends', name: 'Dividends', amount: 182400 },
      { id: 'interest', name: 'Interest', amount: 111000 },
    ],
    expenseBreakdown: [
      { id: 'housing', name: 'Housing', amount: 1680000 },
      { id: 'groceries', name: 'Groceries', amount: 584400 },
      { id: 'dining', name: 'Dining', amount: 312800 },
      { id: 'shopping', name: 'Shopping', amount: 284700 },
      { id: 'transportation', name: 'Transportation', amount: 244500 },
      { id: 'travel', name: 'Travel', amount: 228000 },
      { id: 'subscriptions', name: 'Subscriptions', amount: 141300 },
      { id: 'health', name: 'Health', amount: 132900 },
      { id: 'software', name: 'Software', amount: 90000 },
    ],
  },
}

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

function getCustomScaffoldRange(from: string, to: string): SpendingRange {
  const days = getCustomRangeDays(from, to)
  if (days === null) return 'MTD'
  if (days <= 14) return 'WTD'
  if (days <= 45) return 'MTD'
  if (days <= 120) return 'QTD'
  return 'YTD'
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

function getScaffoldRange(preset: InsightsRangePreset, customFrom: string, customTo: string) {
  return preset === 'CUSTOM'
    ? getCustomScaffoldRange(customFrom, customTo)
    : presetScaffoldRange[preset]
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

function groupDatesByCashFlowGranularity(dates: Date[], granularity: CashFlowGranularity) {
  if (granularity === 'day') {
    return dates.map((date) => [date])
  }

  const groups: Date[][] = []
  let currentKey = ''
  for (const date of dates) {
    const key = granularity === 'week'
      ? `${date.getFullYear()}-${getIsoWeek(date)}`
      : `${date.getFullYear()}-${date.getMonth()}`
    if (key !== currentKey) {
      groups.push([])
      currentKey = key
    }
    groups[groups.length - 1].push(date)
  }
  return groups
}

function distributeByWeights(total: number, weights: number[]) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1
  let allocated = 0
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return total - allocated
    const value = Math.round((total * weight) / totalWeight)
    allocated += value
    return value
  })
}

function getCashFlowBarData(data: InsightScaffoldData, dates: Date[]) {
  const granularity = getCashFlowGranularity(dates.length)
  const groups = groupDatesByCashFlowGranularity(dates, granularity)
  const inflowWeights = groups.map((_, index) => {
    if (granularity === 'day') return index % 14 === 0 || index === groups.length - 1 ? 3.4 : 0.28
    if (granularity === 'week') return index % 2 === 0 ? 2.2 : 0.75
    return 1 + (index % 3 === 0 ? 0.42 : 0)
  })
  const outflowWeights = groups.map((_, index) => (
    1 + Math.max(0, Math.sin(index * 1.35)) * 0.45 + (index % 4 === 0 ? 0.32 : 0)
  ))
  const inflowValues = distributeByWeights(data.cashInflow, inflowWeights)
  const outflowValues = distributeByWeights(data.cashOutflow, outflowWeights)

  return {
    granularity,
    buckets: groups.map((group, index): CashFlowBarBucket => {
      const firstDate = group[0]
      const lastDate = group[group.length - 1]
      const inflow = inflowValues[index]
      const outflow = outflowValues[index]
      const label = granularity === 'day'
        ? getShortDateLabel(firstDate)
        : granularity === 'week'
          ? `W${getIsoWeek(firstDate)}`
          : getMonthLabel(firstDate)
      const rangeLabel = firstDate.getTime() === lastDate.getTime()
        ? getShortDateLabel(firstDate)
        : `${getShortDateLabel(firstDate)}-${getShortDateLabel(lastDate)}`

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
): IncomeExpenseFlowData {
  if (incomeEntries.length === 0 && expenseEntries.length === 0) {
    return { nodes: [], links: [] }
  }

  const incomeTotal = incomeEntries.reduce((sum, [, amount]) => sum + amount, 0)
  const expenseTotal = expenseEntries.reduce((sum, [, amount]) => sum + amount, 0)
  const nodes: IncomeExpenseFlowNode[] = [
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

function getFlowData(data: InsightsIncomeExpenseFlowResponse | undefined): IncomeExpenseFlowData {
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
          ? 'Recorded income exceeds recorded expenses in the selected range, excluding transfers.'
          : 'Recorded expenses exceed recorded income in the selected range, excluding transfers.',
        tone: netSavings >= 0 ? 'positive' : 'negative',
      },
      {
        label: 'Net Worth Changed By',
        value: data.net_worth_change,
        detail: 'Across tracked account balances in the selected range.',
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
          : 'No comparable category movement in this range.',
      },
      {
        label: 'Top Category',
        value: data.top_category_name ?? 'N/A',
        detail: data.top_category_share_pct === undefined
          ? 'No recorded expenses in this range.'
          : `${data.top_category_share_pct}% of recorded expenses.`,
      },
      {
        label: 'Savings Rate',
        value: formatSavingsRateValue(savingsRate),
        detail: savingsRate === null
          ? 'No recorded income in the selected range.'
          : 'Income kept after recorded expenses, excluding transfers.',
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
        detail: 'Loading period summary...',
        tone: 'neutral',
      },
      {
        label: 'Net Worth Changed By',
        value: 0,
        detail: 'Loading tracked balance movement...',
        tone: 'neutral',
        signed: true,
      },
    ],
    signals: [
      {
        label: 'Biggest Change',
        value: 'Loading',
        detail: 'Fetching comparable category movement.',
      },
      {
        label: 'Top Category',
        value: 'Loading',
        detail: 'Fetching recorded expense categories.',
      },
      {
        label: 'Savings Rate',
        value: 'Loading',
        detail: 'Fetching income and expense totals.',
      },
    ],
  }
}

function getPeriodGlanceChangeDetail(changeAmount: number, changePct: number | undefined, displayCurrency: string) {
  const amount = formatSignedCurrency(changeAmount, displayCurrency)
  if (changePct === undefined) {
    return `${amount} compared with no spend in the previous matching period.`
  }
  return `${amount} (${changePct > 0 ? '+' : ''}${changePct}%) vs the previous matching period.`
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

function InsightsFloatingRangeControl({
  preset,
  customFrom,
  customTo,
  customInvalid,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
}: {
  preset: InsightsRangePreset
  customFrom: string
  customTo: string
  customInvalid: boolean
  onPresetChange: (value: InsightsRangePreset) => void
  onCustomFromChange: (value: string) => void
  onCustomToChange: (value: string) => void
}) {
  const inputDates = getRangeInputDates(preset, customFrom, customTo)

  function handleCustomFromChange(value: string) {
    if (preset !== 'CUSTOM') {
      onCustomToChange(inputDates.to)
      onPresetChange('CUSTOM')
    }
    onCustomFromChange(value)
  }

  function handleCustomToChange(value: string) {
    if (preset !== 'CUSTOM') {
      onCustomFromChange(inputDates.from)
      onPresetChange('CUSTOM')
    }
    onCustomToChange(value)
  }

  const dateFields = (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <input
          type="date"
          className={`app-input app-date-input-balanced min-w-0 ${customInvalid ? 'app-input-error' : ''}`}
          aria-label="Insights start date"
          value={inputDates.from}
          onChange={(event) => handleCustomFromChange(event.target.value)}
        />
        <span className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
          to
        </span>
        <input
          type="date"
          className={`app-input app-date-input-balanced min-w-0 ${customInvalid ? 'app-input-error' : ''}`}
          aria-label="Insights end date"
          value={inputDates.to}
          onChange={(event) => handleCustomToChange(event.target.value)}
        />
      </div>
      {customInvalid && (
        <p className="mt-1 text-xs" style={{ color: 'var(--app-negative)' }}>
          Start date must be on or before end date.
        </p>
      )}
    </div>
  )

  const renderControl = (dropdownPlacement?: 'bottom' | 'top') => (
    <div className="app-card rounded-xl p-3">
      <InsightsRangeSelector
        value={preset}
        options={INSIGHTS_RANGE_OPTIONS}
        onChange={onPresetChange}
        ariaLabel="Insights date range"
        className="w-full"
        sheetTitle="Insights date range"
        dropdownPlacement={dropdownPlacement}
      />
      <div className="mt-2">
        {dateFields}
      </div>
    </div>
  )

  return (
    <>
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-20 min-[760px]:hidden">
        <div className="pointer-events-auto">
          {renderControl('top')}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 z-40 hidden min-[760px]:block">
        <div className="sticky top-6 flex justify-end">
          <div className="pointer-events-auto w-[24rem]">
            {renderControl()}
          </div>
        </div>
      </div>
    </>
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
  const range = getScaffoldRange(rangePreset, customFrom, customTo)
  const customInvalid = rangePreset === 'CUSTOM'
    && customFrom !== ''
    && customTo !== ''
    && getCustomRangeDays(customFrom, customTo) === null
  const rangeInputDates = useMemo(() => getRangeInputDates(rangePreset, customFrom, customTo), [rangePreset, customFrom, customTo])
  const insightsCardQueriesEnabled = !customInvalid && rangeInputDates.from !== '' && rangeInputDates.to !== ''
  const periodGlanceQuery = useInsightsPeriodGlance(rangeInputDates.from, rangeInputDates.to, insightsCardQueriesEnabled)
  const incomeExpenseFlowQuery = useInsightsIncomeExpenseFlow(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled,
  )
  const incomeExpenseBreakdownQuery = useInsightsIncomeExpenseBreakdown(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled,
  )
  const netWorthQuery = useInsightsNetWorth(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled,
  )
  const merchantDistributionQuery = useInsightsMerchantDistribution(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled,
  )
  const merchantRankingQuery = useInsightsMerchantRanking(
    rangeInputDates.from,
    rangeInputDates.to,
    insightsCardQueriesEnabled,
  )
  const savingsRateTrendQuery = useInsightsSavingsRateTrend()
  const data = insightDataByRange[range]
  const displayCurrency = user?.base_currency ?? 'CAD'
  const selectedBreakdown = useMemo(
    () => getBreakdownEntriesForMode(incomeExpenseBreakdownQuery.data, breakdownMode),
    [breakdownMode, incomeExpenseBreakdownQuery.data],
  )
  const flowData = useMemo(() => getFlowData(incomeExpenseFlowQuery.data), [incomeExpenseFlowQuery.data])
  const flowIncomeSources = incomeExpenseFlowQuery.data?.income_sources ?? []
  const flowExpenseCategories = incomeExpenseFlowQuery.data?.expense_categories ?? []
  const flowIncomeOutflows = incomeExpenseFlowQuery.data?.income_outflows ?? []
  const flowExpenseInflows = incomeExpenseFlowQuery.data?.expense_inflows ?? []
  const flowIncomeSourceCount = incomeExpenseFlowQuery.data?.income_source_count ?? 0
  const flowExpenseCategoryCount = incomeExpenseFlowQuery.data?.expense_category_count ?? 0
  const flowEmptyLabel = incomeExpenseFlowQuery.isLoading
    ? 'Loading income and expense flow...'
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
  const rangeDates = useMemo(() => getRangeDates(rangePreset, customFrom, customTo), [rangePreset, customFrom, customTo])
  const netWorthCardData = useMemo(
    () => getNetWorthCardData(netWorthQuery.data, rangeInputDates.from, rangeInputDates.to),
    [netWorthQuery.data, rangeInputDates.from, rangeInputDates.to],
  )
  const cashFlowBars = useMemo(() => getCashFlowBarData(data, rangeDates), [data, rangeDates])
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
      <header className="app-page-header min-[760px]:pr-[25rem]">
        <h1 className="app-page-title">Insights</h1>
        <p className="app-page-description">
          See where your money goes, spot patterns, and take control with confidence.
        </p>
      </header>
      <InsightsFloatingRangeControl
        preset={rangePreset}
        customFrom={customFrom}
        customTo={customTo}
        customInvalid={customInvalid}
        onPresetChange={setRangePreset}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      <div className="space-y-4">
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
        />

        <IncomeExpenseSankeyCard
          header={<SectionHeader icon={Network} label="Income to Expenses" />}
          flowData={flowData}
          incomeSources={flowIncomeSources}
          expenseCategories={flowExpenseCategories}
          incomeOutflows={flowIncomeOutflows}
          expenseInflows={flowExpenseInflows}
          incomeSourceCount={flowIncomeSourceCount}
          expenseCategoryCount={flowExpenseCategoryCount}
          displayCurrency={displayCurrency}
          emptyLabel={flowEmptyLabel}
        />

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
          animationKey={`${breakdownMode}-${range}`}
        />

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
        />

        <CashFlowCard
          header={<SectionHeader icon={CalendarDays} label="Cash Flow" />}
          granularity={cashFlowBars.granularity}
          buckets={cashFlowBars.buckets}
          displayCurrency={displayCurrency}
        />

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
        />

        <section className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_360px]">
          <MerchantDistributionCard
            header={<SectionHeader icon={Store} label="Spending Distribution by Merchant" />}
            merchants={merchantMarketLayout}
            currency={displayCurrency}
            emptyLabel={merchantDistributionQuery.isLoading ? 'Loading merchant spending...' : undefined}
          />

          <MerchantRankingCard
            header={<SectionHeader icon={ListChecks} label="Merchant Ranking" />}
            merchants={rankedMerchants}
            currency={displayCurrency}
            emptyLabel={merchantRankingQuery.isLoading ? 'Loading merchant ranking...' : undefined}
          />
        </section>

      </div>
    </div>
  )
}
