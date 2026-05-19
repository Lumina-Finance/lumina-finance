import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SpendingRange } from '@/api/dashboard'
import {
  useInsightsIncomeExpenseBreakdown,
  useInsightsIncomeExpenseFlow,
  useInsightsNetWorth,
  useInsightsPeriodGlance,
  type InsightsBreakdownEntry,
  type InsightsCategoryTrendEntry,
  type InsightsFlowEntry,
  type InsightsIncomeExpenseBreakdownResponse,
  type InsightsIncomeExpenseFlowResponse,
  type InsightsNetWorthResponse,
  type InsightsPeriodGlanceResponse,
} from '@/api/insights'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { SavingsCurrentBoundary } from '@/dashboard/components/SavingsCurrentBoundary'
import { formatCurrency } from '@/utils/formatCurrency'
import { useAuth } from '@/hooks/useAuth'
import {
  IncomeExpenseBreakdownCard,
  type BreakdownEntry,
  type BreakdownMode,
  type CategoryDriver,
  type CategoryTrendSection,
} from './components/IncomeExpenseBreakdownCard'
import { InsightsRangeSelector, type InsightsRangeSelectorOption } from './components/InsightsRangeSelector'
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

type InsightsRangePreset = 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_YEAR' | 'LAST_WEEK' | 'LAST_MONTH' | 'CUSTOM'

type MerchantBubble = {
  id: string
  name: string
  totalAmount: number
  transactionCount: number
  averageAmount: number
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
  merchantBubbles: MerchantBubble[]
}

type NetWorthGranularity = 'day' | 'week' | 'month'

type CashFlowGranularity = 'day' | 'week' | 'month'

type CashFlowBarBucket = {
  label: string
  rangeLabel: string
  inflow: number
  outflow: number
  net: number
}

type SavingsRateHistoryPoint = {
  monthKey: string
  monthLabel: string
  tickLabel: string
  fullLabel: string
  rate: number | null
  income: number
  expenses: number
  isCurrent: boolean
}

type SavingsRateYAxisTickProps = {
  x?: number
  y?: number
  payload?: {
    value?: number | string
  }
  maximum: number
}

type MerchantMarketTile = MerchantBubble & {
  x: number
  y: number
  width: number
  height: number
  changePct: number
  changeAmount: number | null
}

type MerchantMarketHover = {
  merchant: MerchantMarketTile
  x: number
  y: number
}

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

const savingsRateHistoryLimit = 12

const savingsRateHistoryScaffold = [
  { income: 642000, expenses: 528000 },
  { income: 651000, expenses: 492000 },
  { income: 636000, expenses: 548000 },
  { income: 664000, expenses: 501000 },
  { income: 702000, expenses: 593000 },
  { income: 648000, expenses: 486000 },
  { income: 672000, expenses: 559000 },
  { income: 689000, expenses: 511000 },
  { income: 655000, expenses: 534000 },
  { income: 714000, expenses: 608000 },
  { income: 682000, expenses: 497000 },
  { income: 735000, expenses: 574000 },
  { income: 694000, expenses: 522000 },
  { income: 758000, expenses: 585000 },
]

const merchantChangeByRange: Record<SpendingRange, Record<string, number>> = {
  WTD: {
    'green-market': 11,
    'metro-ride': -6,
    'cafe-luna': 8,
    streamline: 0,
    'north-pharmacy': 14,
    'urban-outfit': -5,
    'book-nook': 18,
    'city-parking': -9,
    'fit-studio': 0,
    'home-hardware': 6,
  },
  MTD: {
    rentco: 0,
    'green-market': 18,
    'cafe-luna': 27,
    'ride-grid': -4,
    streamline: 6,
    cloudforge: 0,
    'north-pharmacy': 13,
    'urban-outfit': -9,
    'book-nook': 16,
    'city-parking': -7,
    'fit-studio': 0,
    'pet-pantry': 11,
  },
  QTD: {
    rentco: 0,
    'green-market': 10,
    'cafe-luna': 19,
    'ride-grid': -12,
    'skyline-air': 34,
    streamline: 3,
    'north-pharmacy': 9,
    'urban-outfit': -10,
    'book-nook': 14,
    'city-parking': -8,
    'fit-studio': 0,
    'pet-pantry': 12,
    'home-hardware': 7,
  },
  YTD: {
    rentco: 0,
    'green-market': 7,
    'cafe-luna': 13,
    'ride-grid': -18,
    'skyline-air': 29,
    streamline: 6,
    'north-pharmacy': 12,
    'urban-outfit': -11,
    'book-nook': 10,
    'city-parking': -9,
    'fit-studio': 0,
    'pet-pantry': 8,
    'home-hardware': 13,
  },
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
    merchantBubbles: [
      { id: 'green-market', name: 'Green Market', totalAmount: 28200, transactionCount: 5, averageAmount: 5640 },
      { id: 'metro-ride', name: 'Metro Ride', totalAmount: 18400, transactionCount: 8, averageAmount: 2300 },
      { id: 'cafe-luna', name: 'Cafe Luna', totalAmount: 12100, transactionCount: 4, averageAmount: 3025 },
      { id: 'streamline', name: 'Streamline', totalAmount: 15400, transactionCount: 2, averageAmount: 7700 },
      { id: 'north-pharmacy', name: 'North Pharmacy', totalAmount: 12000, transactionCount: 1, averageAmount: 12000 },
      { id: 'urban-outfit', name: 'Urban Outfit', totalAmount: 8200, transactionCount: 1, averageAmount: 8200 },
      { id: 'book-nook', name: 'Book Nook', totalAmount: 5400, transactionCount: 2, averageAmount: 2700 },
      { id: 'city-parking', name: 'City Parking', totalAmount: 4800, transactionCount: 3, averageAmount: 1600 },
      { id: 'fit-studio', name: 'Fit Studio', totalAmount: 3900, transactionCount: 1, averageAmount: 3900 },
      { id: 'home-hardware', name: 'Neighbourhood Home Hardware', totalAmount: 4000, transactionCount: 1, averageAmount: 4000 },
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
    merchantBubbles: [
      { id: 'rentco', name: 'RentCo Living', totalAmount: 210000, transactionCount: 1, averageAmount: 210000 },
      { id: 'green-market', name: 'Green Market', totalAmount: 74200, transactionCount: 9, averageAmount: 8244 },
      { id: 'cafe-luna', name: 'Cafe Luna', totalAmount: 28600, transactionCount: 10, averageAmount: 2860 },
      { id: 'ride-grid', name: 'Ride Grid', totalAmount: 24800, transactionCount: 14, averageAmount: 1771 },
      { id: 'streamline', name: 'Streamline', totalAmount: 18800, transactionCount: 4, averageAmount: 4700 },
      { id: 'cloudforge', name: 'CloudForge', totalAmount: 36000, transactionCount: 2, averageAmount: 18000 },
      { id: 'north-pharmacy', name: 'North Pharmacy', totalAmount: 14900, transactionCount: 2, averageAmount: 7450 },
      { id: 'urban-outfit', name: 'Urban Outfit', totalAmount: 35200, transactionCount: 3, averageAmount: 11733 },
      { id: 'book-nook', name: 'Book Nook', totalAmount: 4200, transactionCount: 2, averageAmount: 2100 },
      { id: 'city-parking', name: 'City Parking', totalAmount: 3600, transactionCount: 4, averageAmount: 900 },
      { id: 'fit-studio', name: 'Fit Studio', totalAmount: 3200, transactionCount: 1, averageAmount: 3200 },
      { id: 'pet-pantry', name: 'Pet Pantry', totalAmount: 2800, transactionCount: 1, averageAmount: 2800 },
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
    merchantBubbles: [
      { id: 'rentco', name: 'RentCo Living', totalAmount: 630000, transactionCount: 3, averageAmount: 210000 },
      { id: 'green-market', name: 'Green Market', totalAmount: 225600, transactionCount: 29, averageAmount: 7779 },
      { id: 'cafe-luna', name: 'Cafe Luna', totalAmount: 85100, transactionCount: 32, averageAmount: 2659 },
      { id: 'ride-grid', name: 'Ride Grid', totalAmount: 74200, transactionCount: 46, averageAmount: 1613 },
      { id: 'skyline-air', name: 'Skyline Air', totalAmount: 88000, transactionCount: 2, averageAmount: 44000 },
      { id: 'streamline', name: 'Streamline', totalAmount: 54500, transactionCount: 12, averageAmount: 4542 },
      { id: 'north-pharmacy', name: 'North Pharmacy', totalAmount: 42600, transactionCount: 6, averageAmount: 7100 },
      { id: 'urban-outfit', name: 'Urban Outfit', totalAmount: 114200, transactionCount: 9, averageAmount: 12689 },
      { id: 'book-nook', name: 'Book Nook', totalAmount: 18600, transactionCount: 6, averageAmount: 3100 },
      { id: 'city-parking', name: 'City Parking', totalAmount: 14200, transactionCount: 17, averageAmount: 835 },
      { id: 'fit-studio', name: 'Fit Studio', totalAmount: 9600, transactionCount: 3, averageAmount: 3200 },
      { id: 'pet-pantry', name: 'Pet Pantry', totalAmount: 12900, transactionCount: 4, averageAmount: 3225 },
      { id: 'home-hardware', name: 'Neighbourhood Home Hardware', totalAmount: 25000, transactionCount: 3, averageAmount: 8333 },
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
    merchantBubbles: [
      { id: 'rentco', name: 'RentCo Living', totalAmount: 1680000, transactionCount: 8, averageAmount: 210000 },
      { id: 'green-market', name: 'Green Market', totalAmount: 584400, transactionCount: 73, averageAmount: 8005 },
      { id: 'cafe-luna', name: 'Cafe Luna', totalAmount: 215600, transactionCount: 89, averageAmount: 2422 },
      { id: 'ride-grid', name: 'Ride Grid', totalAmount: 188900, transactionCount: 117, averageAmount: 1615 },
      { id: 'skyline-air', name: 'Skyline Air', totalAmount: 228000, transactionCount: 5, averageAmount: 45600 },
      { id: 'streamline', name: 'Streamline', totalAmount: 141300, transactionCount: 31, averageAmount: 4558 },
      { id: 'north-pharmacy', name: 'North Pharmacy', totalAmount: 132900, transactionCount: 17, averageAmount: 7818 },
      { id: 'urban-outfit', name: 'Urban Outfit', totalAmount: 284700, transactionCount: 24, averageAmount: 11863 },
      { id: 'book-nook', name: 'Book Nook', totalAmount: 42800, transactionCount: 13, averageAmount: 3292 },
      { id: 'city-parking', name: 'City Parking', totalAmount: 32400, transactionCount: 39, averageAmount: 831 },
      { id: 'fit-studio', name: 'Fit Studio', totalAmount: 25600, transactionCount: 8, averageAmount: 3200 },
      { id: 'pet-pantry', name: 'Pet Pantry', totalAmount: 37400, transactionCount: 11, averageAmount: 3400 },
      { id: 'home-hardware', name: 'Neighbourhood Home Hardware', totalAmount: 104600, transactionCount: 12, averageAmount: 8717 },
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

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
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

function getSavingsTier(rate: number | null) {
  if (rate === null) return 'negative'
  if (rate >= 20) return 'positive'
  if (rate > 0) return 'accent'
  return 'negative'
}

function formatSavingsRateValue(rate: number | null) {
  return rate === null ? 'N/A' : `${rate}%`
}

function clampSavingsRate(rate: number | null) {
  if (rate === null) return null
  return Math.max(-100, Math.min(100, rate))
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

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function getStartOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
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

function getSavingsRateHistory(): SavingsRateHistoryPoint[] {
  const rows = savingsRateHistoryScaffold.slice(-savingsRateHistoryLimit)
  const newestMonth = getStartOfMonth(new Date())

  return rows.map((row, index) => {
    const month = addMonths(newestMonth, index - rows.length + 1)
    const income = row.income
    const expenses = row.expenses
    const rate = income > 0
      ? Math.round(((income - expenses) / income) * 100)
      : expenses > 0
        ? -100
        : null
    const monthKey = getMonthKey(month)
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

function getMerchantChange(merchant: MerchantBubble, range: SpendingRange) {
  return merchantChangeByRange[range][merchant.id] ?? 0
}

function getMerchantChangeAmount(totalAmount: number, changePct: number) {
  if (changePct === 0) return 0
  const previousMultiplier = 1 + (changePct / 100)
  if (previousMultiplier <= 0) return null
  return Math.round(totalAmount - (totalAmount / previousMultiplier))
}

function getMerchantMarketColor(changePct: number) {
  if (changePct === 0) {
    return 'color-mix(in srgb, var(--app-accent) 14%, var(--app-input-bg))'
  }
  const variable = changePct < 0 ? 'var(--app-positive)' : 'var(--app-negative)'
  const mix = Math.min(72, 24 + Math.abs(changePct) * 2.2)
  return `color-mix(in srgb, ${variable} ${mix}%, var(--app-input-bg))`
}

function getMerchantTileColor(merchant: MerchantMarketTile) {
  if (merchant.id === 'other-merchants') {
    return 'color-mix(in srgb, var(--app-text-muted) 24%, var(--app-input-bg))'
  }
  return getMerchantMarketColor(merchant.changePct)
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

function getMerchantMarketLayout(merchants: MerchantBubble[], range: SpendingRange): MerchantMarketTile[] {
  const rankedMerchants = [...merchants]
    .sort((a, b) => b.totalAmount - a.totalAmount)
  const topMerchants = rankedMerchants.slice(0, 8)
  const remainingMerchants = rankedMerchants.slice(8)
  const otherTotal = remainingMerchants.reduce((sum, merchant) => sum + merchant.totalAmount, 0)
  const otherTransactionCount = remainingMerchants.reduce((sum, merchant) => sum + merchant.transactionCount, 0)
  const otherWeightedChange = otherTotal > 0
    ? Math.round(
      remainingMerchants.reduce((sum, merchant) => (
        sum + (getMerchantChange(merchant, range) * merchant.totalAmount)
      ), 0) / otherTotal,
    )
    : 0
  const entries = [
    ...topMerchants.map((merchant) => {
      const changePct = getMerchantChange(merchant, range)
      return {
        ...merchant,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        changePct,
        changeAmount: getMerchantChangeAmount(merchant.totalAmount, changePct),
      }
    }),
    ...(remainingMerchants.length > 0
      ? [{
        id: 'other-merchants',
        name: 'Other',
        totalAmount: otherTotal,
        transactionCount: otherTransactionCount,
        averageAmount: otherTransactionCount > 0 ? Math.round(otherTotal / otherTransactionCount) : 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        changePct: otherWeightedChange,
        changeAmount: null,
      }]
      : []),
  ]

  return splitTreemapItems(entries, 0, 0, 1000, 460)
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

function CashFlowBarTooltip({
  active,
  payload,
  displayCurrency,
}: {
  active?: boolean
  payload?: Array<{ payload?: CashFlowBarBucket }>
  displayCurrency: string
}) {
  const bucket = payload?.[0]?.payload
  if (!active || !bucket) return null

  return (
    <div className="app-chart-tooltip-default-content min-w-48">
      <p className="app-tooltip-muted">{bucket.rangeLabel}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span>Net</span>
        <span className="font-financial">{formatSignedCurrency(bucket.net, displayCurrency)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Inflow</span>
        <span className="font-financial">{formatCurrency(bucket.inflow, displayCurrency)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Outflow</span>
        <span className="font-financial">{formatCurrency(bucket.outflow, displayCurrency)}</span>
      </div>
    </div>
  )
}

function CashFlowBarChart({
  granularity,
  buckets,
  displayCurrency,
}: {
  granularity: CashFlowGranularity
  buckets: CashFlowBarBucket[]
  displayCurrency: string
}) {
  const label = granularity === 'day' ? 'Daily' : granularity === 'week' ? 'Weekly' : 'Monthly'
  const hasActivity = buckets.some((bucket) => bucket.inflow > 0 || bucket.outflow > 0)
  const totalInflow = buckets.reduce((sum, bucket) => sum + bucket.inflow, 0)
  const totalOutflow = buckets.reduce((sum, bucket) => sum + bucket.outflow, 0)
  const totalNet = totalInflow - totalOutflow

  return (
    <div className="flex h-[390px] flex-col">
      <div className="mb-3 pl-4">
        <p className="app-label app-label-compact">Net Cash Flow</p>
        <p
          className="mt-1 font-financial text-3xl leading-none tracking-tight"
          style={{ color: totalNet >= 0 ? 'var(--app-positive)' : 'var(--app-negative)' }}
        >
          {formatSignedCurrency(totalNet, displayCurrency)}
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {!hasActivity ? (
          <div
            className="flex h-full w-full items-center justify-center text-sm"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            No cash flow in this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={buckets}
              margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
              barCategoryGap="22%"
            >
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={32}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                tickMargin={4}
              />
              <YAxis
                width={92}
                axisLine={false}
                tickLine={false}
                domain={[
                  (dataMin: number) => Math.min(dataMin, 0),
                  (dataMax: number) => Math.max(dataMax, 0),
                ]}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                tickFormatter={(value) => formatCurrency(Number(value), displayCurrency)}
              />
              <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
              <Tooltip
                cursor={{ fill: 'var(--app-accent-soft)', radius: 4 }}
                wrapperClassName="app-chart-tooltip-default"
                content={<CashFlowBarTooltip displayCurrency={displayCurrency} />}
              />
              <Bar dataKey="net" radius={4} maxBarSize={40}>
                {buckets.map((bucket) => (
                  <Cell
                    key={bucket.rangeLabel}
                    fill={bucket.net >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'}
                    opacity={0.82}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
        <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {label} net cash flow, including transfers. Hover a bar for inflow, outflow, and net.
        </p>
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-positive)' }} />
            Net positive
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-negative)' }} />
            Net negative
          </span>
        </div>
      </div>
    </div>
  )
}

function SavingsRateHistoryTooltip({
  active,
  payload,
  displayCurrency,
}: {
  active?: boolean
  payload?: Array<{ payload?: SavingsRateHistoryPoint }>
  displayCurrency: string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="app-chart-tooltip-default-content min-w-48">
      <p className="app-tooltip-muted">{point.fullLabel}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span>Savings Rate</span>
        <span className="font-financial">{formatSavingsRateValue(point.rate)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Income</span>
        <span className="font-financial">{formatCurrency(point.income, displayCurrency)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Expenses</span>
        <span className="font-financial">{formatCurrency(point.expenses, displayCurrency)}</span>
      </div>
    </div>
  )
}

function SavingsRateYAxisTick({
  x = 0,
  y = 0,
  payload,
  maximum,
}: SavingsRateYAxisTickProps) {
  const value = Number(payload?.value)
  const isMaximum = value === maximum

  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={isMaximum ? 13 : 11}
      fontWeight={isMaximum ? 700 : 500}
      fill={isMaximum ? 'var(--app-text)' : 'var(--app-text-subtle)'}
    >
      {Number.isFinite(value) ? `${value}%` : ''}
    </text>
  )
}

function SavingsRateHistoryChart({
  series,
  displayCurrency,
  capRates,
}: {
  series: SavingsRateHistoryPoint[]
  displayCurrency: string
  capRates: boolean
}) {
  const shouldReduceMotion = useReducedMotion()
  const hasActivity = series.some((point) => point.income > 0 || point.expenses > 0)
  const currentPoint = series.find((point) => point.isCurrent)
  const tickLabels = new Map(series.map((point) => [point.monthKey, point.tickLabel]))
  const ratedPoints = series.filter((point) => point.rate !== null)
  const averageRate = ratedPoints.length > 0
    ? Math.round(ratedPoints.reduce((sum, point) => sum + (point.rate ?? 0), 0) / ratedPoints.length)
    : null
  const latestPoint = series.at(-1)
  const latestDelta = latestPoint?.rate !== null && latestPoint?.rate !== undefined && averageRate !== null
    ? latestPoint.rate - averageRate
    : null
  const bestPoint = ratedPoints.reduce<SavingsRateHistoryPoint | null>(
    (best, point) => (best === null || (point.rate ?? -Infinity) > (best.rate ?? -Infinity) ? point : best),
    null,
  )
  const worstPoint = ratedPoints.reduce<SavingsRateHistoryPoint | null>(
    (worst, point) => (worst === null || (point.rate ?? Infinity) < (worst.rate ?? Infinity) ? point : worst),
    null,
  )
  const windowMonths = Math.min(savingsRateHistoryLimit, series.length)
  const firstPoint = series[0]
  const averagePeriodLabel = firstPoint && latestPoint
    ? firstPoint.fullLabel === latestPoint.fullLabel
      ? firstPoint.fullLabel
      : `${firstPoint.fullLabel} to ${latestPoint.fullLabel}`
    : 'No available history'
  const latestComparison = `${formatSavingsRateValue(latestPoint?.rate ?? null)} vs ${formatSavingsRateValue(averageRate)}`
  const chartSeries = series.map((point) => ({
    ...point,
    chartRate: capRates ? clampSavingsRate(point.rate) : point.rate,
  }))
  const chartRates = chartSeries
    .map((point) => point.chartRate)
    .filter((rate): rate is number => rate !== null)
  const averageChartRate = capRates ? clampSavingsRate(averageRate) : averageRate
  const highestRate = chartRates.length > 0 ? Math.max(...chartRates) : 100
  const lowestRate = chartRates.length > 0 ? Math.min(...chartRates) : -100
  const hasPositiveRate = chartRates.some((rate) => rate > 0)
  const hasNegativeRate = chartRates.some((rate) => rate < 0)
  const hasFullRate = chartRates.some((rate) => rate >= 100)
  const showCappedPositiveSection = capRates && (hasPositiveRate || !hasNegativeRate)
  const showCappedNegativeSection = capRates && hasNegativeRate
  const yAxisDomain = capRates
    ? [showCappedNegativeSection ? -100 : 0, showCappedPositiveSection ? 100 : 0]
    : [hasNegativeRate ? Math.min(-100, lowestRate) : 0, Math.max(highestRate, 0)]
  const yAxisTicks = Array.from(new Set([
    ...((capRates ? showCappedNegativeSection : hasNegativeRate) ? [-100] : []),
    ...(capRates ? [0] : []),
    lowestRate,
    ...(averageChartRate !== null ? [averageChartRate] : []),
    highestRate,
    ...((capRates ? showCappedPositiveSection : hasFullRate) ? [100] : []),
  ]))
    .filter((tick) => tick >= yAxisDomain[0] && tick <= yAxisDomain[1])
    .sort((a, b) => a - b)

  return (
    <div className="flex h-[430px] flex-col">
      <div className="mb-4 grid gap-4 border-b border-[var(--app-border)] pb-4 min-[760px]:grid-cols-3">
        <div className="pl-4">
          <p className="app-label">{windowMonths}-Month Average</p>
          <p className="mt-1 font-financial text-3xl leading-none tracking-tight">
            {formatSavingsRateValue(averageRate)}
          </p>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
            {averagePeriodLabel}
          </p>
        </div>
        <div>
          <p className="app-label">Latest vs Average</p>
          <p
            className="mt-1 font-financial text-3xl leading-none tracking-tight"
            style={{
              color: latestDelta === null || latestDelta === 0
                ? 'var(--app-text)'
                : latestDelta > 0
                  ? 'var(--app-positive)'
                  : 'var(--app-negative)',
            }}
          >
            {latestComparison}
          </p>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
            {latestPoint?.fullLabel ?? 'No recent month'}
          </p>
        </div>
        <div>
          <p className="app-label">Best / Worst</p>
          <p className="mt-1 font-financial text-3xl leading-none tracking-tight">
            {formatSavingsRateValue(bestPoint?.rate ?? null)} / {formatSavingsRateValue(worstPoint?.rate ?? null)}
          </p>
          <p className="mt-2 truncate text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
            {bestPoint?.fullLabel ?? 'N/A'} high, {worstPoint?.fullLabel ?? 'N/A'} low
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {!hasActivity ? (
          <div
            className="flex h-full w-full items-center justify-center text-sm"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            No savings-rate history in this range
          </div>
        ) : (
          <div className="relative h-full">
            <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
              <defs>
                {(['positive', 'accent', 'negative'] as const).map((tier) => (
                  <pattern
                    key={tier}
                    id={`insights-savings-stripes-${tier}`}
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
              <BarChart data={chartSeries} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <XAxis
                  dataKey="monthKey"
                  axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={28}
                  tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                  tickFormatter={(value) => tickLabels.get(String(value)) ?? String(value)}
                  tickMargin={4}
                />
                <YAxis
                  width={52}
                  axisLine={false}
                  tickLine={false}
                  domain={yAxisDomain}
                  ticks={yAxisTicks}
                  tick={<SavingsRateYAxisTick maximum={highestRate} />}
                />
                <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
                {averageChartRate !== null && (
                  <ReferenceLine
                    y={averageChartRate}
                    stroke="var(--app-accent)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.72}
                    strokeWidth={1}
                  />
                )}
                {currentPoint && <SavingsCurrentBoundary currentLabel={currentPoint.monthKey} />}
                <Tooltip
                  wrapperClassName="app-chart-tooltip-default"
                  cursor={{ fill: 'var(--app-border)', opacity: 0.4 }}
                  content={<SavingsRateHistoryTooltip displayCurrency={displayCurrency} />}
                />
                <Bar dataKey="chartRate" radius={[3, 3, 0, 0]} maxBarSize={30}>
                  {chartSeries.map((entry) => {
                    const tier = getSavingsTier(entry.rate)
                    return (
                      <Cell
                        key={entry.monthKey}
                        fill={
                          entry.isCurrent
                            ? `url(#insights-savings-stripes-${tier})`
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
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
        <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
          <span>Latest 12 months, up to available data.</span>
          {' '}
          <AnimatePresence initial={false}>
            {capRates && (
              <motion.span
                className="inline-block font-semibold"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                Chart scale is capped at 100%.
              </motion.span>
            )}
          </AnimatePresence>
        </p>
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-positive)' }} />
            20%+
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-accent)' }} />
            1-19%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-negative)' }} />
            0% or less
          </span>
        </div>
      </div>
    </div>
  )
}

function MerchantMarketMap({
  merchants,
  currency,
}: {
  merchants: MerchantMarketTile[]
  currency: string
}) {
  const [hoveredTile, setHoveredTile] = useState<MerchantMarketHover | null>(null)

  return (
    <div className="relative min-h-0 flex-1">
      <div className="h-full overflow-hidden rounded-lg border border-[var(--app-border)]">
        <svg
          viewBox="0 0 1000 460"
          preserveAspectRatio="none"
          role="img"
          aria-label="Merchant market map"
          className="h-full w-full"
        >
          {merchants.map((merchant) => {
            const area = merchant.width * merchant.height
            const labelSize = area > 90000 ? 24 : area > 42000 ? 17 : 12
            const amountSize = Math.max(labelSize - 5, 10)
            const amountText = formatCurrency(merchant.totalAmount, currency)
            return (
              <g
                key={merchant.id}
                onMouseEnter={(event) => {
                  const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
                  if (!rect) return
                  setHoveredTile({
                    merchant,
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  })
                }}
                onMouseMove={(event) => {
                  const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
                  if (!rect) return
                  setHoveredTile({
                    merchant,
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  })
                }}
                onMouseLeave={() => setHoveredTile(null)}
              >
                <rect
                  x={merchant.x + 2}
                  y={merchant.y + 2}
                  width={Math.max(merchant.width - 4, 0)}
                  height={Math.max(merchant.height - 4, 0)}
                  rx={6}
                  fill={getMerchantTileColor(merchant)}
                  stroke="var(--app-surface-soft)"
                  strokeWidth={4}
                />
                <foreignObject
                  x={merchant.x + 10}
                  y={merchant.y + 10}
                  width={Math.max(merchant.width - 20, 0)}
                  height={Math.max(merchant.height - 20, 0)}
                >
                  <div
                    className="flex h-full min-w-0 flex-col items-center justify-center text-center"
                    style={{ color: 'var(--app-text)' }}
                  >
                    <p
                      className="max-w-full break-words font-bold leading-tight"
                      style={{ fontSize: labelSize }}
                    >
                      {merchant.name}
                    </p>
                    <p
                      className="mt-1 max-w-full break-words font-financial leading-tight"
                      style={{ color: 'var(--app-text-muted)', fontSize: amountSize }}
                    >
                      {amountText}
                    </p>
                  </div>
                </foreignObject>
              </g>
            )
          })}
        </svg>
      </div>
      {hoveredTile && (
        <div
          className="app-chart-tooltip-default-content pointer-events-none absolute z-20 min-w-56"
          style={{
            left: hoveredTile.x,
            top: hoveredTile.y,
            transform: 'translate(-50%, calc(-100% - 10px))',
          }}
        >
          <p className="app-tooltip-muted">{hoveredTile.merchant.name}</p>
          <div className="mt-1 flex justify-between gap-4">
            <span>Total Spend</span>
            <span className="font-financial">{formatCurrency(hoveredTile.merchant.totalAmount, currency)}</span>
          </div>
          {hoveredTile.merchant.changeAmount === null ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Change not shown because this group changes by period.
            </p>
          ) : (
            <div className="mt-1 flex justify-between gap-4">
              <span>Change</span>
              <span className="font-financial">
                {formatSignedCurrency(hoveredTile.merchant.changeAmount, currency)}
                {' '}
                ({hoveredTile.merchant.changePct > 0 ? '+' : ''}{hoveredTile.merchant.changePct}%)
              </span>
            </div>
          )}
        </div>
      )}
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
  const savingsRateHistory = useMemo(() => getSavingsRateHistory(), [])
  const merchantMarketLayout = useMemo(() => getMerchantMarketLayout(data.merchantBubbles, range), [data.merchantBubbles, range])
  const rankedMerchants = [...data.merchantBubbles].sort((a, b) => b.totalAmount - a.totalAmount)
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

        <section className="app-card">
          <SectionHeader icon={CalendarDays} label="Cash Flow" />
          <CashFlowBarChart
            granularity={cashFlowBars.granularity}
            buckets={cashFlowBars.buckets}
            displayCurrency={displayCurrency}
          />
        </section>

        <section className="app-card">
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
          <SavingsRateHistoryChart
            series={savingsRateHistory}
            displayCurrency={displayCurrency}
            capRates={capSavingsRateChart}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_360px]">
          <div className="app-card flex min-h-[560px] flex-col">
            <SectionHeader icon={Store} label="Spending Distribution by Merchant" />
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              <span>Tile size shows total spend. Color shows change vs. the comparable period.</span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-positive)' }} />
                  Spend down
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-negative)' }} />
                  Spend up
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-accent)' }} />
                  Flat
                </span>
              </div>
            </div>
            <MerchantMarketMap merchants={merchantMarketLayout} currency={displayCurrency} />
          </div>

          <div className="app-card">
            <SectionHeader icon={ListChecks} label="Merchant Ranking" />
            <div className="space-y-3">
              {rankedMerchants.slice(0, 6).map((merchant, index) => (
                <div key={merchant.id} className="flex items-center gap-3">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {merchant.name}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
                      {merchant.transactionCount} transactions | avg {formatCurrency(merchant.averageAmount, displayCurrency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-financial text-sm">
                      {formatCurrency(merchant.totalAmount, displayCurrency)}
                    </p>
                    <p
                      className="font-financial text-xs"
                      style={{
                        color: getMerchantChange(merchant, range) > 0
                          ? 'var(--app-negative)'
                          : getMerchantChange(merchant, range) < 0
                            ? 'var(--app-positive)'
                            : 'var(--app-text-muted)',
                      }}
                    >
                      {getMerchantChange(merchant, range) > 0 ? '+' : ''}{getMerchantChange(merchant, range)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
