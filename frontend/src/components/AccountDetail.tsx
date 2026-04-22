import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Pencil, TrendingDown, TrendingUp } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  useAccount,
  useAccountSnapshots,
  type Account,
  type AccountBalanceSnapshot,
  type SnapshotGranularity,
} from '@/api/accounts'
import { useTransactionsOverview } from '@/api/transactions'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency } from '@/utils/formatCurrency'

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

// Period-to-date ranges for the spending breakdown. Mirrors the dashboard's
// SpendingRange so the two reads feel coherent.
type SpendingRange = 'WTD' | 'MTD' | 'QTD' | 'YTD'
const SPENDING_RANGES: SpendingRange[] = ['WTD', 'MTD', 'QTD', 'YTD']

// Compute the [from, to] date window for a period-to-date range in the user's
// timezone. `to` is always today; `from` snaps to the period's start.
function rangeToDates(range: SpendingRange, tz: string): { from_date: string; to_date: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz,
  })
  const todayStr = fmt.format(new Date())
  const [y, m, d] = todayStr.split('-').map(Number)
  const today = new Date(y, m - 1, d)

  let from: Date
  if (range === 'WTD') {
    from = new Date(today)
    const day = from.getDay() // 0=Sunday
    const toMonday = day === 0 ? -6 : 1 - day
    from.setDate(from.getDate() + toMonday)
  } else if (range === 'MTD') {
    from = new Date(today.getFullYear(), today.getMonth(), 1)
  } else if (range === 'QTD') {
    from = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)
  } else {
    from = new Date(today.getFullYear(), 0, 1)
  }

  return { from_date: toISODate(from), to_date: toISODate(today) }
}

function SpendingByCategoryCard({ account }: { account: Account }) {
  const { user } = useAuth()
  const [range, setRange] = useState<SpendingRange>('MTD')

  const { from_date, to_date } = useMemo(
    () => rangeToDates(range, user!.tz),
    [range, user],
  )

  const { data: overview, isLoading } = useTransactionsOverview({
    account_id: account.id,
    from_date,
    to_date,
  })

  // Show at most 5 rows total — the card's height is sized to fit exactly
  // five. When the account has more categories, reserve the last row for
  // "Other" and roll the tail into it.
  const MAX_ROWS = 5
  const categories = overview?.top_categories ?? []
  const normalized = categories.map((c) => ({
    key: c.category_id,
    name: c.category_name,
    total: c.total,
    isOther: false,
  }))
  const hasOther = normalized.length > MAX_ROWS
  const visibleCount = hasOther ? MAX_ROWS - 1 : normalized.length
  const visible = normalized.slice(0, visibleCount)
  const rest = normalized.slice(visibleCount)
  const otherTotal = rest.reduce((sum, c) => sum + c.total, 0)
  const rows = hasOther
    ? [...visible, { key: 'other', name: `Other (${rest.length})`, total: otherTotal, isOther: true }]
    : visible
  const grandTotal = categories.reduce((sum, c) => sum + c.total, 0)

  return (
    <section
      className="rounded-2xl p-6 flex flex-col"
      style={{
        background: 'var(--app-surface-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">Spending by category</p>
        <div
          className="flex rounded-lg p-0.5"
          style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}
          role="tablist"
          aria-label="Spending range"
        >
          {SPENDING_RANGES.map((r) => {
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

      {isLoading ? (
        <div className="flex-1" />
      ) : rows.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-sm"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          No spending in this range
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {rows.map((item, idx) => {
              // Bar width = this category's share of total spending — so a
              // category at 50% of total fills the row halfway. 4% minimum
              // keeps tiny slivers visible. Uses absolute values because
              // spending totals are stored as signed negatives.
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
                    {formatCurrency(item.total, account.currency)}
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
              {formatCurrency(grandTotal, account.currency)}
            </span>
          </div>
        </>
      )}
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

      {/* Secondary row: 3 equal columns. Column 1 is the spending breakdown;
          columns 2 and 3 are placeholders for upcoming widgets. */}
      <div className="mt-5 grid grid-cols-3 gap-5">
        <SpendingByCategoryCard account={account} />
        <div
          className="rounded-2xl"
          style={{
            background: 'var(--app-surface-soft)',
            border: '1px solid var(--app-border)',
            minHeight: 364,
          }}
        />
        <div
          className="rounded-2xl"
          style={{
            background: 'var(--app-surface-soft)',
            border: '1px solid var(--app-border)',
            minHeight: 364,
          }}
        />
      </div>
    </div>
  )
}
