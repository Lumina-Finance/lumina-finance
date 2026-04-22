import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Pencil, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  useAccount,
  useAccountCashFlow,
  useAccountSnapshots,
  useAccountSpendingBreakdown,
  type Account,
  type AccountBalanceSnapshot,
  type AccountMonthlyCashFlow,
  type AccountSpendingBreakdown,
  type SnapshotGranularity,
  type SpendingRange,
} from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useMerchants } from '@/api/merchants'
import {
  useInfiniteTransactions,
  type Transaction,
} from '@/api/transactions'
import { getCategoryIcon } from '@/utils/categoryIcon'
import { formatCurrency } from '@/utils/formatCurrency'
import CreateTransactionModal from '@/components/CreateTransactionModal'

const TAX_TREATMENT_LABEL: Record<string, string> = {
  taxable: 'Taxable',
  tax_free: 'Tax-free',
  tax_deferred: 'Tax-deferred',
  tax_assisted: 'Tax-assisted',
}

const ACCOUNT_KIND_LABEL: Record<string, string> = {
  asset: 'Asset',
  revolving: 'Revolving credit',
  amortizing: 'Amortizing debt',
}

function humanizeAccountType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Balance chart range presets. Each range drives a lookback window + a
// backend bucketing granularity so payloads stay bounded — daily for 7D,
// weekly for 30D/90D, monthly for 1Y.
type BalanceRange = '7D' | '30D' | '90D' | '1Y'
const BALANCE_RANGES: BalanceRange[] = ['7D', '30D', '90D', '1Y']
const RANGE_CONFIG: Record<
  BalanceRange,
  { days: number; granularity: SnapshotGranularity }
> = {
  '7D': { days: 7, granularity: 'day' },
  '30D': { days: 30, granularity: 'day' },
  '90D': { days: 90, granularity: 'week' },
  '1Y': { days: 365, granularity: 'month' },
}

// Shared across the balance tooltip so hover position slides instead of snaps.
const TOOLTIP_WRAPPER_STYLE = {
  transition: 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease-out',
  pointerEvents: 'none' as const,
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Round a date down to the start of the bucket it falls in. Day buckets have
// no rounding; week buckets snap to Monday (ISO); month/quarter snap to the
// 1st of the bucket's calendar period.
function bucketStart(d: Date, granularity: SnapshotGranularity): Date {
  if (granularity === 'day') {
    const c = new Date(d)
    c.setHours(0, 0, 0, 0)
    return c
  }
  if (granularity === 'week') {
    const c = new Date(d)
    c.setHours(0, 0, 0, 0)
    const day = c.getDay() // 0=Sunday
    const toMonday = day === 0 ? -6 : 1 - day
    c.setDate(c.getDate() + toMonday)
    return c
  }
  if (granularity === 'month') {
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }
  // quarter
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
}

// Advance `d` to the start of the next bucket.
function advanceBucket(d: Date, granularity: SnapshotGranularity): Date {
  const c = new Date(d)
  if (granularity === 'day') c.setDate(c.getDate() + 1)
  else if (granularity === 'week') c.setDate(c.getDate() + 7)
  else if (granularity === 'month') c.setMonth(c.getMonth() + 1)
  else c.setMonth(c.getMonth() + 3)
  return c
}

// Generate per-bucket samples. Each bucket contributes one chart point: the
// X-axis position sits at the bucket's START (e.g., Jan 1 for January), while
// the balance is read at the bucket's END (Jan 31). For the current bucket
// (not yet closed), end is clipped to today so the latest data reflects.
function generateBuckets(
  fromDate: Date,
  today: Date,
  granularity: SnapshotGranularity,
): { labelDate: Date; valueDate: Date }[] {
  const buckets: { labelDate: Date; valueDate: Date }[] = []
  let cursor = bucketStart(fromDate, granularity)
  while (cursor <= today) {
    const nextStart = advanceBucket(cursor, granularity)
    const bucketEnd = new Date(nextStart)
    bucketEnd.setDate(bucketEnd.getDate() - 1) // inclusive last day of bucket
    const valueDate = bucketEnd > today ? today : bucketEnd
    buckets.push({ labelDate: new Date(cursor), valueDate })
    cursor = nextStart
  }
  return buckets
}

// Build the chart series: one point per bucket. Balance comes from the latest
// snapshot at or before the bucket's end. Buckets with no preceding data
// render at 0. Each point also carries a `tooltipLabel` that names the exact
// date the balance is read at (e.g. "Jan 31, 2026") — useful because the
// axis label sits at the bucket start ("Jan") which would otherwise be
// ambiguous on hover.
function buildChartSeries(
  snapshots: AccountBalanceSnapshot[],
  fromDate: Date,
  granularity: SnapshotGranularity,
): { date: string; dateLabel: string; tooltipLabel: string; balance: number }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets = generateBuckets(fromDate, today, granularity)
  if (buckets.length === 0) return []

  const sorted = [...snapshots].sort((a, b) => a.dt.localeCompare(b.dt))

  // Pointer walks through sorted snapshots as bucket-end dates advance.
  // Buckets before the first snapshot render at 0 (no data yet).
  let idx = 0
  let runningBalance = 0
  const points: { date: string; dateLabel: string; tooltipLabel: string; balance: number }[] = []
  for (const bucket of buckets) {
    const valueDateStr = toISODate(bucket.valueDate)
    while (idx < sorted.length && sorted[idx].dt <= valueDateStr) {
      runningBalance = sorted[idx].balance
      idx++
    }
    points.push({
      date: toISODate(bucket.labelDate),
      dateLabel: bucket.labelDate.toLocaleDateString('en-US', {
        month: 'short',
        day: granularity === 'month' ? undefined : 'numeric',
      }),
      tooltipLabel: bucket.valueDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      balance: runningBalance,
    })
  }

  return points
}

// Larger version of the accounts-list logo — 64px square so the detail card
// reads as "this one account" rather than a row in a list.
function DetailInstitutionLogo({ institution }: { institution: Account['institution'] }) {
  const faviconUrl = institution?.website
    ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(institution.website)}&size=256`
    : null
  return (
    <div
      className="w-16 h-16 shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
      style={
        faviconUrl
          ? undefined
          : {
              background: 'var(--app-accent-soft)',
              border: '1px solid var(--app-border)',
            }
      }
    >
      {faviconUrl ? (
        <img
          src={faviconUrl}
          alt={`${institution!.name} logo`}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      ) : (
        <span className="text-2xl font-semibold select-none" style={{ color: 'var(--app-accent)' }}>$</span>
      )}
    </div>
  )
}

// Warm-earth palette matching the dashboard spending breakdown so swatches
// feel consistent across the app.
const CATEGORY_COLORS = [
  '#C9A96A', '#6CA07B', '#D4906A', '#9B8FC8', '#C97982', '#7AAEC8', '#8C8074',
]

// Spending range tabs. `SpendingRange` is imported from the API layer so
// the select options stay in lockstep with the backend's accepted values.
const SPENDING_RANGES: SpendingRange[] = ['WTD', 'MTD', 'QTD', 'YTD']

interface BreakdownRow {
  key: string
  name: string
  total: number
  isOther: boolean
}

// Append an "Other (N)" row when the backend signals more entries exist
// beyond the top 5. Its total = grand_total - sum(top 5), which the card
// also uses to size the row's proportional fill.
function withOtherRow(rows: BreakdownRow[], otherCount: number, grandTotal: number): BreakdownRow[] {
  if (otherCount <= 0) return rows
  const topSum = rows.reduce((sum, r) => sum + r.total, 0)
  const otherTotal = Math.max(grandTotal - topSum, 0)
  return [...rows, { key: 'other', name: `Other (${otherCount})`, total: otherTotal, isOther: true }]
}

// Shared presentation for the spending-by-category and top-merchants cards.
// Each row has a colored fill proportional to its share of grandTotal,
// with "Other" rendered in neutral gray. The Total row is pinned to the
// bottom via a flex-1 spacer so sparse cards don't collapse in height.
function BreakdownCard({
  title,
  rangeLabel,
  range,
  onRangeChange,
  rows,
  grandTotal,
  currency,
  emptyLabel,
  isLoading,
}: {
  title: string
  rangeLabel: string
  range: SpendingRange
  onRangeChange: (r: SpendingRange) => void
  rows: BreakdownRow[]
  grandTotal: number
  currency: string
  emptyLabel: string
  isLoading: boolean
}) {
  return (
    <section
      className="rounded-2xl p-6 flex flex-col"
      style={{
        background: 'var(--app-surface-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">{title}</p>
        <div
          className="flex rounded-lg p-0.5"
          style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}
          role="tablist"
          aria-label={rangeLabel}
        >
          {SPENDING_RANGES.map((r) => {
            const active = range === r
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onRangeChange(r)}
                className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150"
                style={{
                  background: active ? 'var(--app-accent-soft)' : 'transparent',
                  color: active ? 'var(--app-accent)' : 'var(--app-text-muted)',
                }}
              >
                {r}
              </button>
            )
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1" />
      ) : rows.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-sm"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          {emptyLabel}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {rows.map((item, idx) => {
              // Bar width = this row's share of total — so a row at 50% of
              // total fills halfway. 4% minimum keeps tiny slivers visible.
              // Uses absolute values because totals are signed negatives.
              const totalAbs = Math.abs(grandTotal)
              const barPct = totalAbs > 0 ? Math.max((Math.abs(item.total) / totalAbs) * 100, 4) : 0
              const color = item.isOther ? '#8C8074' : CATEGORY_COLORS[idx % CATEGORY_COLORS.length]
              return (
                <div
                  key={item.key}
                  className="relative flex items-center gap-3 rounded-xl py-2.5 px-3 overflow-hidden"
                  style={{ background: 'var(--app-bg)' }}
                >
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.35 }}
                  />
                  <div
                    className="w-2 h-2 rounded-full shrink-0 relative"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className={`flex-1 truncate relative text-sm font-medium ${item.isOther ? 'italic' : ''}`}
                  >
                    {item.name}
                  </span>
                  <span className="font-financial font-medium tabular-nums relative text-sm">
                    {formatCurrency(item.total, currency)}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Spacer pushes the Total row to the bottom regardless of row count. */}
          <div className="flex-1" />

          <div
            className="flex items-center gap-3 pt-3"
            style={{ borderTop: '1px solid var(--app-border)' }}
          >
            <div className="w-2 shrink-0" />
            <span
              className="flex-1 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--app-text-muted)' }}
            >
              Total
            </span>
            <span className="font-financial font-semibold tabular-nums text-sm">
              {formatCurrency(grandTotal, currency)}
            </span>
          </div>
        </>
      )}
    </section>
  )
}

function SpendingByCategoryCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data, isLoading } = useAccountSpendingBreakdown(account.id, range)

  const rows = breakdownToRows(
    data,
    (b) => b.top_categories.map((c) => ({
      key: c.category_id, name: c.name, total: c.total, isOther: false,
    })),
    (b) => b.other_categories_count,
  )

  return (
    <BreakdownCard
      title="Spending by Category"
      rangeLabel="Spending range"
      range={range}
      onRangeChange={setRange}
      rows={rows}
      grandTotal={data?.grand_total_spend ?? 0}
      currency={account.currency}
      emptyLabel="No spending in this range"
      isLoading={isLoading}
    />
  )
}

function TopMerchantsCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data, isLoading } = useAccountSpendingBreakdown(account.id, range)

  const rows = breakdownToRows(
    data,
    (b) => b.top_merchants.map((m) => ({
      key: m.merchant_id, name: m.name, total: m.total, isOther: false,
    })),
    (b) => b.other_merchants_count,
  )

  return (
    <BreakdownCard
      title="Top Merchants"
      rangeLabel="Merchant range"
      range={range}
      onRangeChange={setRange}
      rows={rows}
      grandTotal={data?.grand_total_spend ?? 0}
      currency={account.currency}
      emptyLabel="No merchant activity in this range"
      isLoading={isLoading}
    />
  )
}

// Project the breakdown payload into BreakdownRow[] + the "Other (N)" row
// when one is needed. Each caller supplies the top-N extractor and the
// matching other-count accessor so categories and merchants share the shape.
function breakdownToRows(
  data: AccountSpendingBreakdown | undefined,
  toRows: (b: AccountSpendingBreakdown) => BreakdownRow[],
  otherCount: (b: AccountSpendingBreakdown) => number,
): BreakdownRow[] {
  if (!data) return []
  return withOtherRow(toRows(data), otherCount(data), data.grand_total_spend)
}

// Monthly cash-flow card — a compact "N months avg" summary (left) paired
// with a grouped bar chart of the recent monthly history (right). Mirrors the
// old-repo "Monthly Cash Flow" design but swaps the Recurring-vs-One-time
// sidebar for a simple In/Out average since categories don't yet carry a
// recurring signal.
//
// ``CASH_FLOW_AVG_MONTHS`` completed months are used for the average so a
// partial in-progress month can't drag it down. One extra month is fetched so
// the chart still shows the in-progress current month alongside the history.
const CASH_FLOW_AVG_MONTHS = 6
const CASH_FLOW_CHART_MONTHS = CASH_FLOW_AVG_MONTHS + 1

// Cash-flow bar chart — one BarChart used twice in the same card. Once for
// the monthly history, once for the N-month average. Both callers pass the
// same ``domain`` so bars are visually comparable at a glance.
interface CashFlowBar {
  label: string
  income: number
  expense: number
}

function CashFlowBarChart({
  data,
  domain,
  currency,
  tooltipLabel,
}: {
  data: CashFlowBar[]
  domain: [number, number]
  currency: string
  tooltipLabel: (label: string) => string
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap="18%"
      >
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
          tickMargin={4}
          interval={0}
        />
        <YAxis hide domain={domain} />
        <Tooltip
          cursor={{ fill: 'var(--app-accent-soft)', radius: 4 }}
          wrapperStyle={TOOLTIP_WRAPPER_STYLE}
          contentStyle={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            borderRadius: 8,
            boxShadow: 'var(--app-shadow-soft)',
            padding: '6px 10px',
            fontSize: 13,
          }}
          labelStyle={{ color: 'var(--app-text-subtle)' }}
          itemStyle={{ color: 'var(--app-text)' }}
          labelFormatter={(label) => tooltipLabel(String(label))}
          formatter={(value, name) => [
            formatCurrency(Number(value), currency),
            name === 'income' ? 'In' : 'Out',
          ]}
        />
        <Bar
          dataKey="income"
          fill="var(--app-positive)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          opacity={0.85}
        />
        <Bar
          dataKey="expense"
          fill="var(--app-negative)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          opacity={0.85}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function MonthlyCashFlowCard({ account }: { account: Account }) {
  const { data, isLoading } = useAccountCashFlow(account.id, CASH_FLOW_CHART_MONTHS)

  const chartData = useMemo(
    () =>
      (data ?? []).map((row: AccountMonthlyCashFlow) => ({
        label: parseYmdLocal(row.month).toLocaleDateString('en-US', { month: 'short' }),
        tooltipLabel: parseYmdLocal(row.month).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        }),
        income: row.income,
        expense: row.expenses,
      })),
    [data],
  )
  const hasActivity = chartData.some((m) => m.income > 0 || m.expense > 0)

  // Average the completed prior months only — drop the last entry (the in-
  // progress current month) so a partial month doesn't drag the stat down.
  // Dormant months in the window still count as $0 so the number stays stable
  // across the month rather than jumping each time a new month begins.
  const { avgIn, avgOut } = useMemo(() => {
    if (!data || data.length <= 1) return { avgIn: 0, avgOut: 0 }
    const completed = data.slice(0, -1)
    const totalIn = completed.reduce((sum, m) => sum + m.income, 0)
    const totalOut = completed.reduce((sum, m) => sum + m.expenses, 0)
    return {
      avgIn: Math.round(totalIn / completed.length),
      avgOut: Math.round(totalOut / completed.length),
    }
  }, [data])

  // Shared Y-axis ceiling so the avg bar's height is directly comparable to
  // the monthly bars — the whole reason the avg sits inside the same card.
  const yMax = useMemo(() => {
    const monthlyPeak = chartData.reduce(
      (peak, m) => Math.max(peak, m.income, m.expense),
      0,
    )
    // 1 floor keeps Recharts from collapsing to a zero-height domain when
    // everything is empty (which is mostly defensive — hasActivity gates this
    // branch anyway).
    return Math.max(monthlyPeak, avgIn, avgOut, 1)
  }, [chartData, avgIn, avgOut])

  const avgData: CashFlowBar[] = [
    { label: `${CASH_FLOW_AVG_MONTHS} Mo Avg`, income: avgIn, expense: avgOut },
  ]
  const monthlyLabelByKey = new Map(chartData.map((m) => [m.label, m.tooltipLabel]))

  return (
    <section
      className="rounded-2xl p-6 flex flex-col"
      style={{
        background: 'var(--app-surface-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="app-label">Monthly Cash Flow</p>
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--app-positive)' }} />
            In
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--app-negative)' }} />
            Out
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-[200px] w-full flex gap-4">
        <div className="flex-1 min-w-0">
          {isLoading || !hasActivity ? (
            <div
              className="h-full w-full flex items-center justify-center text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {isLoading ? '' : 'No cash flow yet'}
            </div>
          ) : (
            <CashFlowBarChart
              data={chartData}
              domain={[0, yMax]}
              currency={account.currency}
              tooltipLabel={(label) => monthlyLabelByKey.get(label) ?? label}
            />
          )}
        </div>

        {!isLoading && hasActivity && (
          <>
            <div
              className="shrink-0 self-stretch"
              style={{ borderLeft: '1px dashed var(--app-border-strong)' }}
              aria-hidden
            />
            <div className="shrink-0" style={{ width: 72 }}>
              <CashFlowBarChart
                data={avgData}
                domain={[0, yMax]}
                currency={account.currency}
                tooltipLabel={() => `${CASH_FLOW_AVG_MONTHS}-month average`}
              />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// Parse a "YYYY-MM-DD" calendar date as local midnight — new Date("YYYY-MM-DD")
// treats it as UTC and drifts a day in negative-offset timezones.
function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Group transactions by calendar day, preserving input order within each group.
function groupByDate(transactions: Transaction[]): { dateLabel: string; transactions: Transaction[] }[] {
  const groups: { dateLabel: string; transactions: Transaction[] }[] = []
  let currentLabel = ''
  for (const txn of transactions) {
    const label = parseYmdLocal(txn.dt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    if (label !== currentLabel) {
      groups.push({ dateLabel: label, transactions: [] })
      currentLabel = label
    }
    groups[groups.length - 1].transactions.push(txn)
  }
  return groups
}

function TransactionListCard({ account }: { account: Account }) {
  const [showModal, setShowModal] = useState(false)
  const [modalKey, setModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)

  const openCreate = () => {
    setEditingTransaction(null)
    setModalKey((k) => k + 1)
    setShowModal(true)
  }
  const openEdit = (t: Transaction) => {
    setEditingTransaction(t)
    setModalKey((k) => k + 1)
    setShowModal(true)
  }

  const {
    data: txnPages,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteTransactions({ account_id: account.id })
  const transactions = useMemo(() => txnPages?.pages.flat() ?? [], [txnPages])

  const { data: categories } = useCategories()
  const { data: merchants } = useMerchants()
  const categoryMap = useMemo(
    () => new Map(categories?.map((c) => [c.id, c]) ?? []),
    [categories],
  )
  const merchantMap = useMemo(
    () => new Map(merchants?.map((m) => [m.id, m]) ?? []),
    [merchants],
  )

  const dateGroups = useMemo(() => groupByDate(transactions), [transactions])

  // Infinite scroll — mark pending 1s before actually fetching so the user
  // sees immediate feedback when the sentinel enters the viewport. Same
  // pattern as the main Transactions page.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [pendingFetch, setPendingFetch] = useState(false)
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return
    const el = sentinelRef.current
    if (!el) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (timeoutId === null) {
          setPendingFetch(true)
          timeoutId = setTimeout(() => {
            setPendingFetch(false)
            fetchNextPage()
          }, 1000)
        }
      } else if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
        setPendingFetch(false)
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId)
      observer.disconnect()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const showPendingFetch = pendingFetch && hasNextPage && !isFetchingNextPage

  return (
    <section
      className="rounded-2xl p-6 flex flex-col"
      style={{
        background: 'var(--app-surface-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="app-label">Transactions</p>
        <button
          type="button"
          onClick={openCreate}
          className="app-secondary-button"
        >
          <Plus size={16} aria-hidden />
          Add transaction
        </button>
      </div>

      {isLoading ? (
        <div className="py-10" />
      ) : dateGroups.length === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          No transactions yet
        </p>
      ) : (
        <div className="space-y-4">
          {dateGroups.map(({ dateLabel, transactions: txns }) => {
            const dailyTotal = txns.reduce((sum, t) => sum + t.amount, 0)
            const dailyColor = dailyTotal >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
            return (
              <div key={dateLabel}>
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{
                    background: 'var(--app-input-bg)',
                    borderBottom: '1px solid var(--app-border)',
                  }}
                >
                  <p
                    className="text-sm font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    {dateLabel}
                  </p>
                  <p
                    className="font-financial text-sm font-medium"
                    style={{ color: dailyColor }}
                  >
                    {formatCurrency(dailyTotal, account.currency)}
                  </p>
                </div>

                <div>
                  {txns.map((t) => {
                    const isIncome = t.amount > 0
                    const category = categoryMap.get(t.category_id)
                    const merchantName = t.merchant_id ? merchantMap.get(t.merchant_id)?.name : null
                    const Icon = getCategoryIcon(category?.icon)
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openEdit(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openEdit(t)
                          }
                        }}
                        className="flex items-center gap-4 py-3.5 px-3 cursor-pointer transition-colors duration-100 hover:bg-[var(--app-surface-soft)]"
                        style={{ borderBottom: '1px solid var(--app-border)' }}
                      >
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            background: isIncome ? 'var(--app-positive-soft)' : 'var(--app-surface-soft)',
                            border: `1px solid ${isIncome ? 'var(--app-positive)' : 'var(--app-border)'}`,
                          }}
                        >
                          <Icon
                            size={16}
                            style={{ color: isIncome ? 'var(--app-positive)' : 'var(--app-text-muted)' }}
                            aria-hidden
                          />
                        </div>
                        {/* Merchant cell — second line kept blank (nbsp) so row
                            height matches the Transactions page, which uses it
                            for account name. */}
                        <div className="min-w-0 w-80 shrink-0">
                          <p className="font-medium truncate">{merchantName ?? 'Transfer'}</p>
                          <p
                            className="text-sm mt-0.5 truncate"
                            style={{ color: 'var(--app-text-muted)' }}
                          >
                            {' '}
                          </p>
                        </div>
                        <p
                          className="min-w-0 flex-1 truncate"
                          style={{ color: 'var(--app-text-subtle)' }}
                        >
                          {t.notes ?? ' '}
                        </p>
                        <span
                          className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
                          style={{
                            background: 'var(--app-surface-soft)',
                            color: 'var(--app-text-muted)',
                            border: '1px solid var(--app-border)',
                          }}
                        >
                          {category?.name ?? 'Uncategorized'}
                        </span>
                        <p
                          className="font-financial font-medium shrink-0 tabular-nums w-28 text-right"
                          style={{ color: isIncome ? 'var(--app-positive)' : 'var(--app-text)' }}
                        >
                          {t.amount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(t.amount), account.currency)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
          {(isFetchingNextPage || showPendingFetch) && (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              Loading more transactions...
            </p>
          )}
        </div>
      )}

      <CreateTransactionModal
        key={modalKey}
        open={showModal}
        onClose={() => setShowModal(false)}
        transaction={editingTransaction ?? undefined}
        defaultAccountId={account.id}
      />
    </section>
  )
}

function BalanceChartCard({ account }: { account: Account }) {
  const [range, setRange] = useState<BalanceRange>('30D')

  // Derive the window + granularity from the selected range. Memoized on
  // range so the query key stays stable across renders.
  const { fromDate, granularity } = useMemo(() => {
    const cfg = RANGE_CONFIG[range]
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const from = new Date(today)
    from.setDate(from.getDate() - (cfg.days - 1))
    return { fromDate: from, granularity: cfg.granularity }
  }, [range])

  const { data: snapshots, isLoading } = useAccountSnapshots(account.id, {
    fromDate: toISODate(fromDate),
    granularity,
    includeAnchor: true,
  })

  const series = useMemo(
    () => buildChartSeries(snapshots ?? [], fromDate, granularity),
    [snapshots, fromDate, granularity],
  )

  // First chart point whose year differs from the previous point — drives the
  // dashed year-boundary marker so the user can tell where one year ends.
  let yearBoundary: { dateKey: string; year: string } | null = null
  for (let i = 1; i < series.length; i++) {
    if (series[i].date.slice(0, 4) !== series[i - 1].date.slice(0, 4)) {
      yearBoundary = { dateKey: series[i].date, year: series[i].date.slice(0, 4) }
      break
    }
  }

  // Period delta — first vs last point in the visible window. Drives the
  // up/down pill and the line color.
  const periodDelta = useMemo(() => {
    if (series.length < 2) return null
    const start = series[0].balance
    const end = series[series.length - 1].balance
    const absolute = end - start
    const pct = start === 0 ? null : (absolute / Math.abs(start)) * 100
    return { absolute, pct }
  }, [series])

  const trendUp = periodDelta !== null && periodDelta.absolute >= 0
  const lineColor = account.current_balance < 0 ? 'var(--app-negative)' : 'var(--app-accent)'
  const deltaColor = periodDelta === null
    ? 'var(--app-text-muted)'
    : trendUp
      ? 'var(--app-positive)'
      : 'var(--app-negative)'

  return (
    <section
      className="rounded-2xl p-6 flex flex-col"
      style={{
        background: 'var(--app-surface-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      {/* Header — label + range pills */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <p className="app-label">Balance</p>
        <div
          className="flex rounded-lg p-0.5"
          style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}
          role="tablist"
          aria-label="Balance range"
        >
          {BALANCE_RANGES.map((r) => {
            const active = range === r
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRange(r)}
                className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150"
                style={{
                  background: active ? 'var(--app-accent-soft)' : 'transparent',
                  color: active ? 'var(--app-accent)' : 'var(--app-text-muted)',
                }}
              >
                {r}
              </button>
            )
          })}
        </div>
      </div>

      {/* Current balance + period delta */}
      <div className="mb-4">
        <p
          className="font-financial font-medium leading-none text-3xl"
          style={{ color: account.current_balance < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
        >
          {formatCurrency(account.current_balance, account.currency)}
        </p>
        {periodDelta !== null && (
          <div className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: deltaColor }}>
            {trendUp ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
            <span>
              {trendUp ? '+' : '−'}
              {formatCurrency(Math.abs(periodDelta.absolute), account.currency)}
              {periodDelta.pct !== null && (
                <>
                  {' '}
                  ({trendUp ? '+' : '−'}
                  {Math.abs(periodDelta.pct).toFixed(1)}%)
                </>
              )}
            </span>
            <span style={{ color: 'var(--app-text-subtle)' }}>· {range.toLowerCase()}</span>
          </div>
        )}
      </div>

      {/* Chart fills the remaining space. 240px min keeps it usable even on
          short identity cards; stretches taller when grid row grows. */}
      <div className="flex-1 min-h-[240px] w-full">
        {isLoading || series.length < 2 ? (
          <div
            className="h-full w-full rounded-lg flex items-center justify-center text-sm"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            {isLoading ? '' : 'Not enough history yet'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 18, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id={`balanceFill-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                tickMargin={4}
                tickFormatter={(value: string) =>
                  series.find((s) => s.date === value)?.dateLabel ?? value
                }
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                cursor={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
                contentStyle={{
                  background: 'var(--app-bg)',
                  border: '1px solid var(--app-border-strong)',
                  borderRadius: 8,
                  boxShadow: 'var(--app-shadow-soft)',
                  padding: '6px 10px',
                  fontSize: 13,
                }}
                labelStyle={{ color: 'var(--app-text-subtle)' }}
                itemStyle={{ color: 'var(--app-text)' }}
                labelFormatter={(value) =>
                  series.find((s) => s.date === value)?.tooltipLabel ?? String(value)
                }
                formatter={(value) => [formatCurrency(Number(value), account.currency), 'Balance']}
              />
              <ReferenceLine
                y={0}
                stroke="var(--app-text-subtle)"
                strokeDasharray="4 3"
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={lineColor}
                strokeWidth={2}
                fill={`url(#balanceFill-${account.id})`}
              />
              {yearBoundary && (
                <ReferenceLine
                  x={yearBoundary.dateKey}
                  stroke="var(--app-text-muted)"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  label={{
                    value: yearBoundary.year,
                    position: 'top',
                    fill: 'var(--app-text-muted)',
                    fontSize: 11,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

function BackLink() {
  return (
    <Link
      to="/accounts"
      className="inline-flex items-center gap-1.5 text-sm mb-6"
      style={{ color: 'var(--app-text-muted)' }}
    >
      <ArrowLeft size={14} aria-hidden />
      Back to accounts
    </Link>
  )
}

export default function AccountDetail() {
  const { accountId } = useParams<{ accountId: string }>()
  const { data: account, isLoading, error } = useAccount(accountId)

  // Tax-advantaged details are hidden by default so the card height stays
  // consistent. Clicking the Tax treatment row opens a floating popover
  // anchored at that row's top — extends downward without reflowing the grid.
  const [taxOpen, setTaxOpen] = useState(false)
  const taxRowRef = useRef<HTMLDivElement>(null)
  const taxPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!taxOpen) return
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (taxPanelRef.current?.contains(target)) return
      if (taxRowRef.current?.contains(target)) return
      setTaxOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTaxOpen(false)
    }
    // defer registration so the click that opened doesn't immediately close it
    const t = setTimeout(() => window.addEventListener('pointerdown', onPointer), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [taxOpen])

  if (isLoading) {
    return (
      <div>
        <BackLink />
        <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-5">
          <div className="h-96 rounded-2xl bg-[var(--app-surface-soft)]" />
          <div className="h-96 rounded-2xl bg-[var(--app-surface-soft)]" />
        </div>
      </div>
    )
  }

  if (error || !account) {
    return (
      <div>
        <BackLink />
        <h1 className="app-page-title">Account not found</h1>
        <p className="app-page-description">We couldn't load this account. It may have been deleted.</p>
      </div>
    )
  }

  const money = (value: number | null) =>
    value === null ? '—' : formatCurrency(value, account.currency)

  // Always-visible rows. Tax treatment is handled separately below because it
  // doubles as the toggle for the tax-advantaged popover.
  const coreRows: { label: string; value: string }[] = [
    { label: 'Kind', value: ACCOUNT_KIND_LABEL[account.account_kind] ?? account.account_kind },
    { label: 'Type', value: humanizeAccountType(account.account_type) },
    { label: 'Currency', value: account.currency },
    { label: 'Credit limit', value: money(account.credit_limit) },
  ]
  const taxTreatmentLabel = TAX_TREATMENT_LABEL[account.tax_treatment] ?? account.tax_treatment

  const taxRows: { label: string; value: string }[] = [
    { label: 'Contribution limit', value: money(account.current_year_contribution_limit) },
    { label: 'Lifetime limit', value: money(account.lifetime_contribution_limit) },
    { label: 'Withdrawal limit', value: money(account.current_year_withdrawal_limit) },
    { label: 'YTD contributions', value: money(account.ytd_contributions) },
    { label: 'YTD withdrawals', value: money(account.ytd_withdrawals) },
    { label: 'Lifetime contributions', value: money(account.lifetime_contributions) },
    { label: 'Lifetime withdrawals', value: money(account.lifetime_withdrawals) },
  ]

  return (
    <div>
      <BackLink />

      {/* Two-column layout: identity card (fixed) + chart area (flex).
          The chart side is a placeholder for step 4. */}
      <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-5">
        <section
          className="relative rounded-2xl p-6 flex flex-col"
          style={{
            background: 'var(--app-surface-soft)',
            border: '1px solid var(--app-border)',
          }}
        >
          {!account.closed_at && (
            <button
              type="button"
              aria-label="Edit account"
              className="absolute top-3 right-3 grid place-items-center rounded-md transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
              style={{ width: 28, height: 28, color: 'var(--app-text-muted)' }}
            >
              <Pencil size={14} aria-hidden />
            </button>
          )}

          <DetailInstitutionLogo institution={account.institution} />

          <h1 className="mt-4 font-serif font-semibold leading-tight text-2xl">{account.name}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {account.institution?.name ?? 'No institution'}
            {account.closed_at && ` · Closed ${new Date(account.closed_at).toLocaleDateString()}`}
          </p>

          <dl className="mt-5 flex-1">
            {coreRows.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between py-2 border-b"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <dt className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {row.label}
                </dt>
                <dd className="text-sm font-medium">{row.value}</dd>
              </div>
            ))}

            {/* Tax treatment — clickable, doubles as disclosure trigger. */}
            <div ref={taxRowRef} className="relative">
              <button
                type="button"
                onClick={() => setTaxOpen((o) => !o)}
                aria-expanded={taxOpen}
                className="w-full flex items-baseline justify-between py-2 border-b transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Tax treatment
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{taxTreatmentLabel}</span>
                  <ChevronDown
                    size={14}
                    aria-hidden
                    style={{
                      color: 'var(--app-text-muted)',
                      transform: taxOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 150ms ease',
                    }}
                  />
                </span>
              </button>

              {/* Popover anchored at this row's top, extending downward. Left/
                  right pulled to cancel the card's p-6 padding so the panel
                  spans the full card width. Floats over page content below. */}
              <AnimatePresence>
                {taxOpen && (
                  <motion.div
                    ref={taxPanelRef}
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
                    className="absolute z-30 rounded-2xl px-6 py-4"
                    style={{
                      top: 0,
                      left: -24,
                      right: -24,
                      background: 'var(--app-bg)',
                      border: '1px solid var(--app-border-strong)',
                      boxShadow: 'var(--app-shadow-soft)',
                    }}
                  >
                    {/* Header repeats "Tax treatment" so the popover stays
                        grounded where it opens from. */}
                    <div
                      className="flex items-baseline justify-between pb-2 border-b"
                      style={{ borderColor: 'var(--app-border)' }}
                    >
                      <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                        Tax treatment
                      </span>
                      <span className="text-sm font-medium">{taxTreatmentLabel}</span>
                    </div>

                    {taxRows.map((row, idx) => (
                      <div
                        key={row.label}
                        className={`flex items-baseline justify-between py-1.5 ${idx < taxRows.length - 1 ? 'border-b' : ''}`}
                        style={{ borderColor: 'var(--app-border)' }}
                      >
                        <span className="text-[0.8125rem]" style={{ color: 'var(--app-text-muted)' }}>
                          {row.label}
                        </span>
                        <span className="text-[0.8125rem] font-medium">{row.value}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </dl>
        </section>

        <BalanceChartCard account={account} />
      </div>

      {/* Secondary row: 3 equal columns. */}
      <div className="mt-5 grid grid-cols-3 gap-5">
        <SpendingByCategoryCard account={account} />
        <TopMerchantsCard account={account} />
        <MonthlyCashFlowCard account={account} />
      </div>

      <div className="mt-5">
        <TransactionListCard account={account} />
      </div>
    </div>
  )
}
