import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CreditCard,
  LifeBuoy,
  PieChart as PieChartIcon,
  Repeat,
  Wallet,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
} from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import {
  type SpendingRange,
  useDashboard,
  useDashboardCredit,
  useDashboardNetWorth,
  useSpendingBreakdown,
  useSpendingComparison,
} from '@/api/dashboard'
import {
  useLatestBudgetUtilizations,
} from '@/api/budgets'
import { useAccounts } from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useRunway, useRunwayAccounts } from '@/api/user'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  RUNWAY_BAND_STYLE,
  formatCompactRunway,
  runwayBand,
} from '@/utils/runway'
import { AppSlotMachineText } from './AppSlotMachineText'
import { AppScrambledNumber } from './AppScrambledNumber'

// Palette for the spending breakdown donut. Ordered to harmonize with the
// warm-earth theme — first two swatches mirror the dark-mode accent and
// positive tokens, remaining entries fill out the wheel with muted hues.
const BREAKDOWN_COLORS = [
  '#C9A96A', '#6CA07B', '#D4906A', '#9B8FC8', '#C97982', '#7AAEC8', '#8C8074',
]

const TIME_SELECTOR_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 } as const
const BREAKDOWN_DONUT_TRANSITION = { duration: 0.36, ease: [0.16, 1, 0.3, 1] } as const
const BREAKDOWN_PIE_ANIMATION_MS = 650

type CreditTier = 'positive' | 'accent' | 'negative'
type TopBudget = {
  budget_id: string
  base_budget_id: string
  name: string
  currency: string
  period_end: string
  overall_limit: number
  total_spent: number
  usageRatio: number
  usagePct: number
}

function getCreditTier(utilization: number): CreditTier {
  if (utilization <= 30) return 'positive'
  if (utilization <= 70) return 'accent'
  return 'negative'
}

type SavingsTier = 'positive' | 'accent' | 'negative'
type DashboardMoneyFormat = 'raw' | 'netWorth' | 'credit' | 'breakdown'
type CompactMoneyRule = {
  threshold: number
  divisor: number
  suffix: 'K' | 'M'
  fractionDigits: number
  rounding?: 'ceil'
}

const DASHBOARD_MONEY_RULES: Record<DashboardMoneyFormat, CompactMoneyRule[]> = {
  raw: [],
  netWorth: [
    { threshold: 100_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 0 },
    { threshold: 10_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 2 },
  ],
  credit: [
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 0 },
    { threshold: 100_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 },
  ],
  breakdown: [
    { threshold: 100_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 0 },
    { threshold: 10_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 2 },
    { threshold: 100_000, divisor: 1_000, suffix: 'K', fractionDigits: 0, rounding: 'ceil' },
    { threshold: 10_000, divisor: 1_000, suffix: 'K', fractionDigits: 1, rounding: 'ceil' },
    { threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 0, rounding: 'ceil' },
  ],
}

// Pick the 3-tier bucket for a savings rate, matching the thresholds used on Accounts.
// Null means the rate is −∞ (no income, some expenses) — the bar is a gap anyway,
// so the bucket is only used as a fallback if recharts ever queries it.
function savingsTier(rate: number | null): SavingsTier {
  if (rate === null) return 'negative'
  if (rate >= 20) return 'positive'
  if (rate >= 10) return 'accent'
  return 'negative'
}

function formatShortDate(value: string) {
  const [datePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  if (!year || !month || !day) return 'Unknown'
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function getCurrencyExponent(currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency })
    .resolvedOptions()
    .maximumFractionDigits ?? 2
}

function formatCurrencyWithSuffix(
  value: number,
  currency: string,
  suffix: CompactMoneyRule['suffix'],
  fractionDigits: number,
) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  const parts = formatter.formatToParts(value)
  const numberPartTypes = new Set(['integer', 'group', 'decimal', 'fraction'])
  const suffixIndex = parts.findLastIndex((part) => numberPartTypes.has(part.type))
  return parts
    .map((part, index) => `${part.value}${index === suffixIndex ? suffix : ''}`)
    .join('')
}

function applyCompactRule(value: number, rule: CompactMoneyRule) {
  const scaled = Math.abs(value) / rule.divisor
  const signed = value < 0 ? -1 : 1
  if (rule.rounding !== 'ceil') return value / rule.divisor

  const multiplier = 10 ** rule.fractionDigits
  return signed * (Math.ceil(scaled * multiplier) / multiplier)
}

function formatDashboardMoney(minorUnits: number, currency: string, format: DashboardMoneyFormat) {
  if (format === 'raw') return formatCurrency(minorUnits, currency)

  const exponent = getCurrencyExponent(currency)
  const majorUnits = minorUnits / Math.pow(10, exponent) || 0
  const rule = DASHBOARD_MONEY_RULES[format].find(({ threshold }) => Math.abs(majorUnits) >= threshold)
  if (!rule) return formatCurrency(minorUnits, currency)

  return `≈${formatCurrencyWithSuffix(
    applyCompactRule(majorUnits, rule),
    currency,
    rule.suffix,
    rule.fractionDigits,
  )}`
}

function budgetAttentionState(usagePct: number) {
  if (usagePct >= 100) {
    return {
      label: 'Needs attention',
      background: 'var(--app-negative-soft)',
      textColor: 'var(--app-negative)',
      indicatorColor: 'var(--app-negative)',
    }
  }
  if (usagePct >= 80) {
    return {
      label: 'Watch',
      background: 'var(--app-warning-soft)',
      textColor: 'var(--app-warning-text)',
      indicatorColor: 'var(--app-warning)',
    }
  }
  return {
    label: 'On track',
    background: 'var(--app-positive-soft)',
    textColor: 'var(--app-positive)',
    indicatorColor: 'var(--app-positive)',
  }
}

function TopBudgetsWidget({ budgets, loading }: { budgets: TopBudget[]; loading: boolean }) {
  return (
    <div className="app-card h-[400px] flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <PieChartIcon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Top Budgets</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="app-spinner" />
        </div>
      ) : budgets.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-sm italic"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          No budgets
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0">
            {budgets.map((budget, index) => {
              const attention = budgetAttentionState(budget.usagePct)
              const barPct = Math.min(Math.max(budget.usagePct, 0), 100)
              return (
                <Link
                  key={budget.budget_id}
                  to={`/budgets?budget=${encodeURIComponent(budget.base_budget_id)}`}
                  className="block px-1 py-3 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                  style={{
                    borderBottom: index < budgets.length - 1 ? '1px solid var(--app-border)' : undefined,
                  }}
                  aria-label={`Open ${budget.name} budget`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{budget.name}</p>
                      <p
                        className="mt-0.5 text-xs"
                        style={{ color: 'var(--app-text-muted)' }}
                      >
                        {formatCurrency(budget.total_spent, budget.currency)}
                        {' / '}
                        {formatCurrency(budget.overall_limit, budget.currency)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-semibold leading-none" style={{ color: attention.textColor }}>
                        {budget.usagePct}%
                      </p>
                      <p className="mt-1 text-xs font-medium" style={{ color: attention.textColor }}>
                        {attention.label}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full"
                      style={{ background: 'var(--app-border)' }}
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${barPct}%`,
                          background: attention.indicatorColor,
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                      Ends {formatShortDate(budget.period_end)}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
          <Link
            to="/budgets"
            className="app-secondary-button mt-3 h-9 text-xs"
          >
            View all budgets
          </Link>
        </>
      )}
    </div>
  )
}

// Dashed vertical divider drawn at the left edge of the given category band.
// Uses the v3 hook APIs to read the plot area + x-axis scale so it stays aligned
// across chart sizes; recharts 3 retired the `Customized` props we'd normally use.
function SavingsCurrentBoundary({ currentLabel }: { currentLabel: string }) {
  const plotArea = usePlotArea()
  const xScale = useXAxisScale() as ((label: string) => number) & { bandwidth?: () => number }
  if (!plotArea || !xScale) return null
  const center = xScale(currentLabel)
  if (typeof center !== 'number' || !Number.isFinite(center)) return null
  const bandwidth = xScale.bandwidth ? xScale.bandwidth() : 0
  // D3 band scales return the band *start* for category c; some recharts builds
  // adjust to center. Compute the leftmost edge by subtracting half the bandwidth
  // only if the scale is centered (center is the midpoint), otherwise leave as-is.
  const leftEdge = center - bandwidth / 2
  return (
    <line
      x1={leftEdge}
      x2={leftEdge}
      y1={plotArea.y}
      y2={plotArea.y + plotArea.height}
      stroke="var(--app-text-subtle)"
      strokeDasharray="3 3"
      strokeWidth={1}
    />
  )
}

export default function Dashboard() {
  const shouldReduceMotion = useReducedMotion()
  const hour = new Date().getHours()
  const greeting =
    hour >= 1 && hour < 4 ? 'Still Up?' :
    hour < 12 ? 'Good Morning' :
    hour < 17 ? 'Good Afternoon' :
    'Good Evening'
  const subtitle =
    hour >= 1 && hour < 4
      ? 'Your finances can wait, your sleep can\u2019t.'
      : 'Here is your financial overview.'

  const { user } = useAuth()
  const { data: dashboard } = useDashboard()
  const { data: dashboardCredit, isLoading: dashboardCreditLoading } = useDashboardCredit()
  const { data: dashboardNetWorth } = useDashboardNetWorth()
  const { data: latestBudgetUtilizations, isLoading: latestBudgetUtilizationsLoading } = useLatestBudgetUtilizations()
  const { data: categories } = useCategories()
  const [creditMode, setCreditMode] = useState<'used' | 'available'>('used')
  // Runway tooltip tracks the cursor's position inside the bar (0–100%) so it
  // can slide smoothly from one segment to another. null means "not hovering."
  const [runwayHoverXPct, setRunwayHoverXPct] = useState<number | null>(null)
  const runwayBarRef = useRef<HTMLDivElement>(null)
  // Pie tooltips don't follow the cursor by default — they anchor to the
  // hovered slice. We track cursor position manually so the breakdown tooltip
  // tracks the mouse and the CSS transition on the wrapper smooths motion.
  const [breakdownTipPos, setBreakdownTipPos] = useState<{ x: number; y: number } | null>(null)
  const [spendingRange, setSpendingRange] = useState<SpendingRange>('MTD')
  const { data: spendingComparison, isLoading: spendingComparisonLoading } = useSpendingComparison(spendingRange)
  const [breakdownMode, setBreakdownMode] = useState<'spending' | 'income'>('spending')
  const [breakdownRange, setBreakdownRange] = useState<SpendingRange>('MTD')
  const { data: spendingBreakdown, isLoading: spendingBreakdownLoading } = useSpendingBreakdown(breakdownRange)

  const displayCurrency = user!.base_currency

  // Net worth history — backend returns a forward-filled day-by-day series
  // over the trailing window_days. We attach dates client-side for the x-axis.
  const netWorthData = useMemo(() => {
    const history = dashboardNetWorth?.net_worth_history ?? []
    if (history.length === 0) return []
    const today = new Date()
    return history.map((value, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() - (history.length - 1 - i))
      return {
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value,
      }
    })
  }, [dashboardNetWorth])

  const netWorth = dashboardNetWorth?.current_net_worth ?? 0
  const netWorthColor = netWorth < 0 ? 'var(--app-negative)' : 'var(--app-text)'
  const netWorthTrendUp =
    netWorthData.length >= 2 &&
    netWorthData[netWorthData.length - 1].value >= netWorthData[0].value
  const netWorthLineColor = netWorthTrendUp ? 'var(--app-positive)' : 'var(--app-negative)'

  // Credit data — backend returns base-currency-scoped totals.
  const creditLimit = dashboardCredit?.credit_limit_total ?? 0
  const creditUsed = dashboardCredit?.credit_used ?? 0
  const utilization = creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0
  const hasCredit = creditLimit > 0

  // Credit available is the limit-only base. Used is clamped by the backend,
  // and remaining is derived from that used amount.
  const creditAvailable = creditLimit
  const creditRemaining = creditAvailable - creditUsed
  const remainingPct = creditAvailable > 0 ? 100 - utilization : 0
  const displayPct = creditMode === 'used' ? utilization : remainingPct
  const displayAmount = creditMode === 'used' ? creditUsed : creditRemaining
  const amountLoadingText = formatCurrency(888888, displayCurrency)
  const creditLoadingText = formatDashboardMoney(88888800, displayCurrency, 'credit')
  const breakdownLoadingText = formatDashboardMoney(88888800, displayCurrency, 'breakdown')

  // Donut geometry — bg ring plus a stroke-dashed arc that fills to displayPct.
  // Color tier always derives from utilization so the risk signal stays consistent:
  // 70% available reads green because 30% used is low-risk.
  const size = 120
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (Math.max(0, Math.min(displayPct, 100)) / 100) * circumference
  const tier = getCreditTier(utilization)
  const tierColor = `var(--app-${tier})`
  const tierSoft = `var(--app-${tier}-soft)`

  // Savings-rate chart data — one entry per calendar month (oldest-first), with
  // the last entry being the current in-progress month. The `rate` we hand to
  // recharts is the *plotted* value: null means "don't draw a bar" (no income,
  // no expenses), -100 anchors the expense-only (−∞) case to the bottom so it
  // still reads as a negative bar. The tooltip relies on the raw totals to
  // show the true rate, including −∞%.
  const savingsData = useMemo(() => {
    const history = dashboard?.savings_rate_history ?? []
    return history.map((row, i, arr) => {
      let rate: number | null
      if (row.income > 0) {
        rate = Math.round(((row.income - row.expenses) / row.income) * 100)
      } else if (row.expenses > 0) {
        rate = -100
      } else {
        rate = null
      }
      const monthDate = new Date(`${row.month}T00:00:00`)
      return {
        monthLabel: monthDate.toLocaleDateString('en-US', { month: 'short' }),
        fullLabel: monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        rate,
        income: row.income,
        expenses: row.expenses,
        isCurrent: i === arr.length - 1,
      }
    })
  }, [dashboard])

  // Spending comparison — the selected range maps to a cumulative current-vs-prior
  // series the backend returns in positive minor units. slot_labels drives the
  // x-axis; current and previous only carry real data, so we zip them by index
  // and let recharts render undefined entries as gaps.
  const spendingChartData = useMemo(() => {
    if (!spendingComparison) return []
    const { slot_labels, current, previous } = spendingComparison
    return slot_labels.map((label, i) => ({
      label,
      current: i < current.length ? current[i] : null,
      previous: i < previous.length ? previous[i] : null,
    }))
  }, [spendingComparison])

  const currentSeries = spendingComparison?.current ?? []
  const previousSeries = spendingComparison?.previous ?? []
  const currentHasData = currentSeries.some((v) => v > 0)
  const previousHasData = previousSeries.some((v) => v > 0)
  const spentToDate = currentSeries.at(-1) ?? 0
  // Compare against the prior period at the same elapsed offset; fall back to
  // the prior period's final value if it ended earlier (e.g., MTD Mar 30 vs. Feb).
  const previousAtSameOffset =
    currentSeries.length === 0
      ? null
      : previousSeries[Math.min(currentSeries.length, previousSeries.length) - 1] ?? null
  const spendingDeltaPct =
    previousAtSameOffset != null && previousAtSameOffset > 0
      ? ((spentToDate - previousAtSameOffset) / previousAtSameOffset) * 100
      : null
  const spendingDeltaText =
    spendingDeltaPct == null
      ? '+00.0%'
      : `${spendingDeltaPct >= 0 ? '+' : ''}${spendingDeltaPct.toFixed(1)}%`
  // Recent activity widget — top 5 transactions from the dashboard payload.
  // Transaction rows already include merchant names; categories still come
  // from the shared category lookup for labels and kind coloring.
  const categoryMap = useMemo(() => {
    const m = new Map<string, { name: string; kind: 'expense' | 'income' | 'transfer' }>()
    categories?.forEach((c) => m.set(c.id, { name: c.name, kind: c.kind }))
    return m
  }, [categories])
  const recentActivity = (dashboard?.recent_transactions ?? []).slice(0, 5)

  // Runway — months of expense coverage from the user's selected liquid
  // accounts. Computed server-side so the dashboard card only needs the
  // summary numbers. Null months with a reason covers the "no accounts picked"
  // and "not enough expense history" states.
  const { data: runway } = useRunway()
  const { data: runwayAccountIds } = useRunwayAccounts()
  const { data: accounts } = useAccounts()
  const runwayMonths = runway?.months ?? null
  const runwayBandKey = runwayBand(runwayMonths)
  const runwayStyle = runwayBandKey ? RUNWAY_BAND_STYLE[runwayBandKey] : null
  const runwayCaption = !runway
    ? ''
    : runway.reason === 'no_accounts'
      ? 'Choose accounts in Settings'
      : runway.reason === 'insufficient_history'
        ? 'Need 1+ month of expense data'
        : `${formatCurrency(runway.avg_monthly_expense, displayCurrency)}/mo · ${runway.months_covered}mo basis`

  // Segments for the runway contribution bar. Each selected account with a
  // positive balance becomes a proportionally-sized slice, colored from the
  // shared breakdown palette so the same institution lands on the same swatch
  // as the spending donut when it appears there.
  const runwaySegments = useMemo(() => {
    if (!runway || runway.reason !== null) return []
    const ids = new Set(runwayAccountIds ?? [])
    const rows = (accounts ?? [])
      .filter((a) => ids.has(a.id) && !a.is_hidden && a.current_balance > 0)
      .sort((a, b) => b.current_balance - a.current_balance)
    const total = rows.reduce((sum, a) => sum + a.current_balance, 0)
    if (total === 0) return []
    // `centerPct` lets the hover tooltip anchor itself above the middle of
    // whatever segment the cursor is over without measuring DOM rects.
    let cursor = 0
    return rows.map((a, i) => {
      const pct = (a.current_balance / total) * 100
      const centerPct = cursor + pct / 2
      cursor += pct
      return {
        id: a.id,
        name: a.name,
        amount: a.current_balance,
        pct,
        centerPct,
        color: BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length],
      }
    })
  }, [accounts, runwayAccountIds, runway])
  // Derive which segment the cursor is over by walking cumulative percents
  // until we find the one that contains `runwayHoverXPct`.
  const hoveredSegment = useMemo(() => {
    if (runwayHoverXPct === null || runwaySegments.length === 0) return null
    let cursor = 0
    for (const s of runwaySegments) {
      cursor += s.pct
      if (runwayHoverXPct <= cursor) return s
    }
    return runwaySegments[runwaySegments.length - 1]
  }, [runwayHoverXPct, runwaySegments])

  // Active breakdown entries for the selected mode. The API always returns
  // both expense and income buckets so the toggle doesn't need to refetch.
  const breakdownEntries = useMemo(() => {
    if (!spendingBreakdown) return []
    return breakdownMode === 'spending' ? spendingBreakdown.expense : spendingBreakdown.income
  }, [spendingBreakdown, breakdownMode])
  const breakdownTotal = breakdownEntries.reduce((sum, e) => sum + e.amount, 0)
  const breakdownChartKey = `${breakdownMode}-${breakdownRange}`
  const previousLabel: Record<SpendingRange, string> = {
    WTD: 'Last Week',
    MTD: 'Last Month',
    QTD: 'Last Quarter',
    YTD: 'Last Year',
  }
  const previousPeriodLabel: Record<SpendingRange, string> = {
    WTD: 'Week',
    MTD: 'Month',
    QTD: 'Quarter',
    YTD: 'Year',
  }
  const currentLabel: Record<SpendingRange, string> = {
    WTD: 'This Week',
    MTD: 'This Month',
    QTD: 'This Quarter',
    YTD: 'This Year',
  }
  const rangeOptions: SpendingRange[] = ['WTD', 'MTD', 'QTD', 'YTD']
  const topBudgets = useMemo(() => {
    return (latestBudgetUtilizations ?? [])
      .map((utilization): TopBudget => {
        const usageRatio = utilization.overall_limit > 0
          ? utilization.total_spent / utilization.overall_limit
          : 0
        const usagePct = Math.round(usageRatio * 100)
        return {
          budget_id: utilization.budget_id,
          base_budget_id: utilization.base_budget_id,
          name: utilization.name,
          currency: utilization.currency,
          period_end: utilization.period_end,
          overall_limit: utilization.overall_limit,
          total_spent: utilization.total_spent,
          usageRatio,
          usagePct,
        }
      })
      .sort((a, b) => {
        if (b.usageRatio !== a.usageRatio) return b.usageRatio - a.usageRatio
        return b.total_spent - a.total_spent
      })
      .slice(0, 3)
  }, [latestBudgetUtilizations])
  const topBudgetsLoading = latestBudgetUtilizationsLoading

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">
          {greeting}
        </h1>
        <p className="app-page-description">{subtitle}</p>
      </header>

      <div className="space-y-6">
        {/* Row 1 — Hero metric strip */}
        <div className="grid grid-cols-1 gap-4 grid-cols-4">
          {/* Net Worth — current value + sparkline over trailing window */}
          <div
            className="app-card h-[14rem] pb-2 flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
                <Wallet size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
              </div>
              <span className="app-label">Net Worth</span>
            </div>
            <p
              className="font-financial font-normal tracking-tight leading-none text-3xl"
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

          {/* Credit Used / Available donut */}
          <div
            className="app-card h-[14rem] flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: tierSoft }}>
                <CreditCard size={16} style={{ color: tierColor }} aria-hidden />
              </div>
              <span className="app-label">
                Credit <AppSlotMachineText text={creditMode === 'used' ? 'Used' : 'Remaining'} reserveText="Remaining" />
              </span>
              {hasCredit && (
                <button
                  type="button"
                  onClick={() => setCreditMode((m) => (m === 'used' ? 'available' : 'used'))}
                  title={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
                  aria-label={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
                  className="app-icon-button ml-auto"
                >
                  <Repeat size={12} />
                </button>
              )}
            </div>

            {dashboardCreditLoading || hasCredit ? (
              <div className="flex flex-1 min-h-0 items-center justify-center gap-4">
                <div className="relative shrink-0 aspect-square h-full">
                  <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
                    <circle
                      cx={size / 2} cy={size / 2} r={radius}
                      fill="none"
                      stroke="var(--app-border)"
                      strokeWidth={strokeWidth}
                    />
                    <circle
                      cx={size / 2} cy={size / 2} r={radius}
                      fill="none"
                      stroke={tierColor}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference - filled}
                      style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-financial font-medium tracking-tight text-2xl">
                      <AppScrambledNumber
                        text={`${displayPct}%`}
                        loading={dashboardCreditLoading}
                        loadingText="00%"
                      />
                    </span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="font-financial font-normal tracking-tight leading-none text-3xl">
                    <AppScrambledNumber
                      text={formatDashboardMoney(displayAmount, displayCurrency, 'credit')}
                      loading={dashboardCreditLoading}
                      loadingText={creditLoadingText}
                    />
                  </p>
                  <p className="font-financial mt-1.5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                    of{' '}
                    <AppScrambledNumber
                      text={formatDashboardMoney(creditAvailable, displayCurrency, 'credit')}
                      loading={dashboardCreditLoading}
                      loadingText={creditLoadingText}
                    />
                  </p>
                </div>
              </div>
            ) : (
              <p
                className="my-auto text-center text-sm italic"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                No credit accounts
              </p>
            )}
          </div>

          {/* Savings rate — per-month bars for the last 7 months; current month is lighter. */}
          <div
            className="app-card h-[14rem] pb-2 flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
                <Repeat size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
              </div>
              <span className="app-label">Savings Rate</span>
            </div>
            {savingsData.length > 0 && (
              <div className="flex-1 min-h-0 relative">
                {/* 45° diagonal-stripe pattern for the current (in-progress) month bar.
                    Hosted in a sibling hidden SVG so `url(#id)` resolves regardless
                    of where recharts inserts children in its own SVG. */}
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
                  <BarChart data={savingsData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
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
                      domain={[
                        (dataMin: number) => Math.min(0, dataMin),
                        (dataMax: number) => Math.max(0, dataMax),
                      ]}
                    />
                    <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
                    <SavingsCurrentBoundary
                      currentLabel={savingsData[savingsData.length - 1].monthLabel}
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
                        // Months with no activity at all have no bar drawn; skip the tooltip too.
                        if (income === 0 && expenses === 0) return null
                        const display =
                          income > 0
                            ? `${Math.round(((income - expenses) / income) * 100)}%`
                            : '−∞%'
                        return (
                          <div
                            className="app-chart-tooltip-default-content"
                          >
                            <div style={{ color: 'var(--app-text-subtle)' }}>{fullLabel}</div>
                            <div style={{ color: 'var(--app-text)' }}>Savings Rate: {display}</div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="rate" radius={[3, 3, 0, 0]} maxBarSize={28}>
                      {savingsData.map((entry, i) => {
                        const tier = savingsTier(entry.rate)
                        return (
                          <Cell
                            key={i}
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

          {/* Cash Runway — months of coverage at trailing 12-mo avg expense */}
          <div
            className="app-card h-[14rem] flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
                <LifeBuoy size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
              </div>
              <span className="app-label">Runway</span>
              {runwayStyle && (
                <span
                  className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ background: runwayStyle.bg, color: runwayStyle.fg }}
                >
                  {runwayStyle.label}
                </span>
              )}
            </div>
            <p
              className="font-financial font-normal tracking-tight leading-none text-3xl"
              style={{ color: runwayMonths === null ? 'var(--app-text-subtle)' : 'var(--app-text)' }}
            >
              {formatCompactRunway(runwayMonths)}
            </p>
            {/* Segmented contribution bar — each selected account's share of
                liquid balance. Hovering anywhere on the bar shows a tooltip
                anchored to the cursor's X position; `clamp()` keeps it from
                escaping the bar's bounds, and the CSS transition on `left`
                smooths the slide when the user moves between segments. */}
            <div className="flex-1 min-h-0 flex items-center">
              <div className="relative h-12 w-full">
                <div
                  ref={runwayBarRef}
                  className="flex h-full gap-0.5 rounded-xl overflow-hidden"
                  onMouseMove={(e) => {
                    if (runwaySegments.length === 0) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const xPct = ((e.clientX - rect.left) / rect.width) * 100
                    setRunwayHoverXPct(Math.max(0, Math.min(100, xPct)))
                  }}
                  onMouseLeave={() => setRunwayHoverXPct(null)}
                >
                  {runwaySegments.length > 0 ? (
                    runwaySegments.map((s) => (
                      <div
                        key={s.id}
                        style={{ width: `${s.pct}%`, background: s.color }}
                      />
                    ))
                  ) : (
                    <div
                      className="flex-1 flex items-center justify-center text-sm italic"
                      style={{
                        background: 'var(--app-border)',
                        color: 'var(--app-text-subtle)',
                      }}
                    >
                      {runwayCaption}
                    </div>
                  )}
                </div>
                {hoveredSegment && runwayHoverXPct !== null && (
                  <div
                    className="absolute -top-2 -translate-y-full whitespace-nowrap rounded-md px-2.5 py-1.5 pointer-events-none z-10 w-[11rem]"
                    style={{
                      // clamp() keeps the tooltip fully inside the bar: never
                      // less than half-width from the left, never more than
                      // half-width from the right. Transitioning `left`
                      // produces a smooth slide across segments.
                      left: `clamp(5.5rem, ${runwayHoverXPct}%, calc(100% - 5.5rem))`,
                      transform: 'translateX(-50%)',
                      transition: 'left 280ms cubic-bezier(0.22, 1, 0.36, 1)',
                      background: 'var(--app-bg)',
                      border: '1px solid var(--app-border-strong)',
                      boxShadow: 'var(--app-shadow-soft)',
                    }}
                  >
                    <div
                      className="font-medium truncate"
                      style={{ color: 'var(--app-text)', fontSize: 13 }}
                    >
                      {hoveredSegment.name}
                    </div>
                    <div
                      className="font-financial"
                      style={{ color: 'var(--app-text-muted)', fontSize: 13 }}
                    >
                      {formatCurrency(hoveredSegment.amount, displayCurrency)}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {runwaySegments.length > 0 && (
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {runwayCaption}
              </p>
            )}
          </div>
        </div>

        {/* Row 2 — Charts */}
        <div className="grid grid-cols-1 gap-4 grid-cols-2">
          {/* Spending comparison — cumulative spend in the selected range vs. the
              matching prior period. Range is user-selectable (WTD/MTD/QTD/YTD). */}
          <div
            className="app-card h-[420px] flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
                <BarChart3 size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
              </div>
              <span className="app-label inline-flex items-baseline whitespace-nowrap">
                Spending vs. Last&nbsp;
                <AppSlotMachineText text={previousPeriodLabel[spendingRange]} />
              </span>
              <div
                className="app-segmented-control app-segmented-control-compact app-time-selector ml-auto"
                role="tablist"
                aria-label="Spending range"
              >
                <motion.span
                  className="app-time-selector-indicator"
                  aria-hidden
                  animate={{ x: `${rangeOptions.indexOf(spendingRange) * 100}%` }}
                  transition={shouldReduceMotion ? { duration: 0 } : TIME_SELECTOR_SPRING}
                />
                {rangeOptions.map((option) => {
                  const active = option === spendingRange
                  return (
                    <button
                      key={option}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSpendingRange(option)}
                      className={`app-segmented-option app-segmented-option-compact ${active ? 'app-segmented-option-active' : ''}`}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="font-financial font-normal tracking-tight leading-none text-3xl">
                <AppScrambledNumber
                  text={formatCurrency(spentToDate, displayCurrency)}
                  loading={spendingComparisonLoading}
                  loadingText={amountLoadingText}
                />
              </p>
              {(spendingComparisonLoading || spendingDeltaPct != null) && (
                <div
                  className="flex items-center text-sm font-medium"
                  style={{
                    color: spendingComparisonLoading || spendingDeltaPct == null
                      ? 'var(--app-text-muted)'
                      : spendingDeltaPct <= 0
                        ? 'var(--app-positive)'
                        : 'var(--app-negative)',
                  }}
                >
                  {!spendingComparisonLoading && spendingDeltaPct != null && (
                    spendingDeltaPct <= 0 ? (
                      <ArrowDownRight size={14} aria-hidden />
                    ) : (
                      <ArrowUpRight size={14} aria-hidden />
                    )
                  )}
                  <AppScrambledNumber
                    text={spendingDeltaText}
                    loading={spendingComparisonLoading}
                    loadingText="+00.0%"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 mb-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    background: 'var(--app-accent)',
                    opacity: currentHasData ? 1 : 0.4,
                  }}
                />
                <span
                  className="text-xs"
                  style={{
                    color: 'var(--app-text-muted)',
                    fontStyle: currentHasData ? 'normal' : 'italic',
                  }}
                >
                  {currentHasData
                    ? currentLabel[spendingRange]
                    : `No data for ${currentLabel[spendingRange].toLowerCase()}`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    background: 'var(--app-text-muted)',
                    opacity: previousHasData ? 1 : 0.4,
                  }}
                />
                <span
                  className="text-xs"
                  style={{
                    color: 'var(--app-text-muted)',
                    fontStyle: previousHasData ? 'normal' : 'italic',
                  }}
                >
                  {previousHasData
                    ? previousLabel[spendingRange]
                    : `No data for ${previousLabel[spendingRange].toLowerCase()}`}
                </span>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={spendingChartData}
                  margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                >
                  <defs>
                    <linearGradient id="spendCurrentFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--app-accent)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--app-accent)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="spendPreviousFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--app-text-muted)" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="var(--app-text-muted)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={32}
                    tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                    tickMargin={4}
                  />
                  <YAxis hide />
                  <Tooltip
                    wrapperClassName="app-chart-tooltip-default"
                    cursor={{ stroke: 'var(--app-accent-border)', strokeWidth: 1 }}
                    formatter={(value, name) => [
                      formatCurrency(Number(value), displayCurrency),
                      name === 'current' ? currentLabel[spendingRange] : previousLabel[spendingRange],
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="previous"
                    stroke="var(--app-text-muted)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    fill="url(#spendPreviousFill)"
                    connectNulls={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    stroke="var(--app-accent)"
                    strokeWidth={2.5}
                    fill="url(#spendCurrentFill)"
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Spending / income breakdown — category donut for the selected range.
              One payload carries both expense and income buckets so the mode
              toggle flips instantly without refetching. */}
          <div
            className="app-card h-[420px] flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
                <PieChartIcon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
              </div>
              <span className="app-label inline-flex items-baseline whitespace-nowrap">
                <AppSlotMachineText text={breakdownMode === 'spending' ? 'Spending' : 'Income'} />
                <span className="ml-[0.25em]">Breakdown</span>
              </span>
              <button
                type="button"
                onClick={() => setBreakdownMode((m) => (m === 'spending' ? 'income' : 'spending'))}
                title={breakdownMode === 'spending' ? 'Show income breakdown' : 'Show spending breakdown'}
                aria-label={breakdownMode === 'spending' ? 'Show income breakdown' : 'Show spending breakdown'}
                className="app-icon-button ml-auto"
              >
                <Repeat size={12} />
              </button>
              <div
                className="app-segmented-control app-segmented-control-compact app-time-selector"
                role="tablist"
                aria-label="Breakdown range"
              >
                <motion.span
                  className="app-time-selector-indicator"
                  aria-hidden
                  animate={{ x: `${rangeOptions.indexOf(breakdownRange) * 100}%` }}
                  transition={shouldReduceMotion ? { duration: 0 } : TIME_SELECTOR_SPRING}
                />
                {rangeOptions.map((option) => {
                  const active = option === breakdownRange
                  return (
                    <button
                      key={option}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setBreakdownRange(option)}
                      className={`app-segmented-option app-segmented-option-compact ${active ? 'app-segmented-option-active' : ''}`}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
            </div>

            {breakdownEntries.length === 0 && !spendingBreakdownLoading ? (
              <div
                className="flex-1 flex items-center justify-center text-sm italic"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                No {breakdownMode === 'spending' ? 'expense' : 'income'} activity in this range
              </div>
            ) : (
              <>
                <div
                  className="flex-1 min-h-0 relative"
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    // Tooltip anchors at its top-left corner. Offset the cursor
                    // coords so the box sits centered above the pointer, then
                    // clamp so it never leaves the widget. Tooltip dims are
                    // estimated — slight mismatches are cosmetic.
                    const tw = 160
                    const th = 44
                    const rawX = e.clientX - rect.left
                    const rawY = e.clientY - rect.top
                    const x = Math.max(0, Math.min(rect.width - tw, rawX - tw / 2))
                    const y = Math.max(0, Math.min(rect.height - th, rawY - th - 8))
                    setBreakdownTipPos({ x, y })
                  }}
                  onMouseLeave={() => setBreakdownTipPos(null)}
                >
                  {/* Center overlay rendered BEFORE the chart so recharts'
                      tooltip (appended after) paints on top. Without this the
                      total would cover tooltips for the slices nearest the
                      donut's centerline. */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="app-label" style={{ fontSize: 12 }}>
                      Total {breakdownMode === 'spending' ? 'Expense' : 'Income'}
                    </span>
                    <span className="font-financial font-normal tracking-tight text-3xl mt-1">
                      <AppScrambledNumber
                        text={formatDashboardMoney(breakdownTotal, displayCurrency, 'breakdown')}
                        loading={spendingBreakdownLoading}
                        loadingText={breakdownLoadingText}
                      />
                    </span>
                  </div>
                  <AnimatePresence initial={false}>
                    {breakdownEntries.length > 0 && (
                      <motion.div
                        key={breakdownChartKey}
                        className="absolute inset-0"
                        initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.975 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 1.015 }}
                        transition={shouldReduceMotion ? { duration: 0 } : BREAKDOWN_DONUT_TRANSITION}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={breakdownEntries}
                              cx="50%"
                              cy="50%"
                              innerRadius="68%"
                              outerRadius="92%"
                              paddingAngle={3}
                              dataKey="amount"
                              nameKey="name"
                              stroke="none"
                              isAnimationActive={!shouldReduceMotion}
                              animationDuration={shouldReduceMotion ? 0 : BREAKDOWN_PIE_ANIMATION_MS}
                              animationEasing="ease-out"
                            >
                              {breakdownEntries.map((_, i) => (
                                <Cell key={i} fill={BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              wrapperClassName="app-chart-tooltip-default"
                              cursor={false}
                              position={breakdownTipPos ?? undefined}
                              formatter={(value, name) => [
                                formatCurrency(Number(value), displayCurrency),
                                name,
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {breakdownEntries.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-3">
                    {breakdownEntries.slice(0, 6).map((entry, i) => (
                      <div key={entry.category_id} className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length] }}
                        />
                        <span
                          className="text-xs font-medium whitespace-nowrap"
                          style={{ color: 'var(--app-text-muted)' }}
                        >
                          {entry.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Row 3 — Quick insight cards */}
        <div className="grid grid-cols-1 gap-4 grid-cols-2">
          <TopBudgetsWidget budgets={topBudgets} loading={topBudgetsLoading} />

          {/* Recent Activity — the 5 most recent transactions inside the
              dashboard's rolling window. Amount color follows the category
              kind rather than the signed amount so refunds on expense
              categories still read as expense-colored. */}
          <div
            className="app-card h-[400px] flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
                <Activity size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
              </div>
              <span className="app-label">Recent Activity</span>
            </div>

            {recentActivity.length === 0 ? (
              <div
                className="flex-1 flex items-center justify-center text-sm italic"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                No recent transactions
              </div>
            ) : (
              <>
                <div className="flex-1 min-h-0">
                  {recentActivity.map((t, idx) => {
                    const category = categoryMap.get(t.category_id)
                    const merchantName = t.merchant_name
                    const isIncome = category?.kind === 'income'
                    const title = merchantName ?? t.notes ?? category?.name ?? 'Transaction'
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-2 py-2"
                        style={
                          idx < recentActivity.length - 1
                            ? { borderBottom: '1px solid var(--app-border)' }
                            : undefined
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {title}
                            {category && (
                              <>
                                <span className="mx-1.5" style={{ color: 'var(--app-text-subtle)' }}>·</span>
                                <span style={{ color: 'var(--app-text-muted)' }}>{category.name}</span>
                              </>
                            )}
                          </p>
                          <p
                            className="text-xs mt-0.5"
                            style={{ color: 'var(--app-text-muted)' }}
                          >
                            {new Date(`${t.dt}T00:00:00`).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                        <span
                          className="font-financial font-medium text-sm shrink-0 tabular-nums"
                          style={{ color: isIncome ? 'var(--app-positive)' : 'var(--app-text)' }}
                        >
                          {t.amount >= 0 ? '+' : '-'}
                          {formatCurrency(Math.abs(t.amount), t.currency)}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <Link
                  to="/transactions"
                  className="app-secondary-button mt-3 h-9 text-xs"
                >
                  View all transactions
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
