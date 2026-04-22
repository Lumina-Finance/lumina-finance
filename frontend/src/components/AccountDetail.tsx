import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Pencil, TrendingDown, TrendingUp } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Area,
  AreaChart,
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
} from '@/api/accounts'
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

// Balance chart range presets. ALL falls back to the earliest snapshot the
// account has — no fixed lookback.
type BalanceRange = '7D' | '30D' | '90D' | '1Y' | 'ALL'
const BALANCE_RANGES: BalanceRange[] = ['7D', '30D', '90D', '1Y', 'ALL']
const RANGE_DAYS: Record<Exclude<BalanceRange, 'ALL'>, number> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '1Y': 365,
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

// Snapshots only exist for days with activity, so the chart forward-fills
// between them: every day gets the balance from the most recent snapshot at
// or before it. Returns a day-by-day series from max(fromDate, firstSnapshot)
// through today.
function buildDailySeries(
  snapshots: AccountBalanceSnapshot[],
  range: BalanceRange,
): { date: string; dateLabel: string; balance: number }[] {
  if (snapshots.length === 0) return []
  const sorted = [...snapshots].sort((a, b) => a.dt.localeCompare(b.dt))
  const byDate = new Map(sorted.map((s) => [s.dt, s.balance]))

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const firstSnapDate = new Date(sorted[0].dt)

  let start: Date
  if (range === 'ALL') {
    start = firstSnapDate
  } else {
    const lookback = new Date(today)
    lookback.setDate(lookback.getDate() - (RANGE_DAYS[range] - 1))
    start = lookback < firstSnapDate ? firstSnapDate : lookback
  }

  // Seed the running balance from the most recent snapshot at or before start.
  let currentBalance = 0
  for (const s of sorted) {
    if (s.dt <= toISODate(start)) currentBalance = s.balance
    else break
  }

  const points: { date: string; dateLabel: string; balance: number }[] = []
  const cursor = new Date(start)
  while (cursor <= today) {
    const dtStr = toISODate(cursor)
    const snap = byDate.get(dtStr)
    if (snap !== undefined) currentBalance = snap
    points.push({
      date: dtStr,
      dateLabel: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      balance: currentBalance,
    })
    cursor.setDate(cursor.getDate() + 1)
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
      style={{
        background: 'var(--app-accent-soft)',
        border: '1px solid var(--app-border)',
      }}
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

function BalanceChartCard({ account }: { account: Account }) {
  const [range, setRange] = useState<BalanceRange>('30D')
  const { data: snapshots, isLoading } = useAccountSnapshots(account.id)

  const series = useMemo(
    () => buildDailySeries(snapshots ?? [], range),
    [snapshots, range],
  )

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
  const lineColor = periodDelta === null
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
          <div className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: lineColor }}>
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
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id={`balanceFill-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="dateLabel"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                tickMargin={4}
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
                formatter={(value) => [formatCurrency(Number(value), account.currency), 'Balance']}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={lineColor}
                strokeWidth={2}
                fill={`url(#balanceFill-${account.id})`}
              />
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
    </div>
  )
}
