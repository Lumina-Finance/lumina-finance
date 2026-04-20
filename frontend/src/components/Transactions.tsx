import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Plus,
} from 'lucide-react'
import { getCategoryIcon } from '@/utils/categoryIcon'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/api/accounts'
import { useCategories, type Category } from '@/api/categories'
import { useMerchants, type Merchant } from '@/api/merchants'
import {
  useInfiniteTransactions,
  useTransactionsOverview,
  type Transaction,
} from '@/api/transactions'
import { useFocusRefetch } from '@/hooks/useFocusRefetch'
import { formatCurrency } from '@/utils/formatCurrency'
import CreateTransactionModal from '@/components/CreateTransactionModal'
import FilterChip from '@/components/FilterChip'
import FilterOptionList from '@/components/FilterOptionList'

interface TransactionFilterValues {
  account_id?: string
  category_id?: string
  from_date?: string
  to_date?: string
}

// ── Placeholder data shown when the overview has no real data ──

const PLACEHOLDER_FLOW = { total_inflow: 845000, total_outflow: -623400 }

const PLACEHOLDER_OUTLIERS = [
  { id: '1', merchant_name: 'Annual Insurance', notes: null, amount: -245000, ts: '' },
  { id: '2', merchant_name: 'Quarterly Tax', notes: null, amount: -189000, ts: '' },
  { id: '3', merchant_name: 'Emergency Vet', notes: null, amount: -87500, ts: '' },
]

const PLACEHOLDER_CATEGORIES = [
  { name: 'Housing', amount: 185000 },
  { name: 'Groceries', amount: 62000 },
  { name: 'Transport', amount: 34000 },
]

const PLACEHOLDER_DAILY_FLOW = [
  { date: 'Day 1', inflow: 320, outflow: -185 },
  { date: 'Day 2', inflow: 0, outflow: -42 },
  { date: 'Day 3', inflow: 0, outflow: -2450 },
  { date: 'Day 4', inflow: 150, outflow: -67 },
  { date: 'Day 5', inflow: 0, outflow: -23 },
  { date: 'Day 6', inflow: 0, outflow: -95 },
  { date: 'Day 7', inflow: 0, outflow: -875 },
  { date: 'Day 8', inflow: 4200, outflow: -310 },
  { date: 'Day 9', inflow: 0, outflow: -56 },
  { date: 'Day 10', inflow: 0, outflow: -128 },
  { date: 'Day 11', inflow: 0, outflow: -44 },
  { date: 'Day 12', inflow: 3780, outflow: -159 },
]

// ── Helpers ──

interface DateGroup {
  dateLabel: string
  transactions: Transaction[]
}

// Parse a "YYYY-MM-DD" calendar date as local midnight so toLocaleDateString
// doesn't shift the day in negative-offset timezones (which `new Date("YYYY-MM-DD")`
// would, since the spec parses bare dates as UTC).
function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function groupByDate(transactions: Transaction[]): DateGroup[] {
  const groups: DateGroup[] = []
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

// ── Component ──

export default function Transactions() {
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  useFocusRefetch([['transactions'], ['transactions-overview']])

  const openCreateModal = () => {
    setEditingTransaction(null)
    setCreateModalKey((k) => k + 1)
    setShowCreateModal(true)
  }
  const openEditModal = (txn: Transaction) => {
    setEditingTransaction(txn)
    setCreateModalKey((k) => k + 1)
    setShowCreateModal(true)
  }
  const [filters, setFilters] = useState<TransactionFilterValues>({})

  const setFilter = (patch: Partial<TransactionFilterValues>) => {
    setFilters((f) => {
      const next = { ...f, ...patch }
      for (const key of Object.keys(next) as (keyof TransactionFilterValues)[]) {
        if (!next[key]) delete next[key]
      }
      return next
    })
  }
  const { user } = useAuth()
  const displayCurrency = user!.base_currency

  // Default the overview window to the current calendar month (user's timezone)
  // unless the user explicitly set a date filter via the chip.
  const { monthStart, today } = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      timeZone: user!.tz,
    })
    const todayStr = fmt.format(new Date())  // "YYYY-MM-DD"
    const monthStartStr = `${todayStr.slice(0, 7)}-01`
    return { monthStart: monthStartStr, today: todayStr }
  }, [user])

  // Human label for whichever date range the metrics currently reflect.
  const rangeLabel = useMemo(() => {
    const from = filters.from_date ?? monthStart
    const to = filters.to_date ?? today
    const fmt = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    })
    const parse = (s: string) => new Date(`${s}T00:00:00Z`)
    return `${fmt.format(parse(from))} – ${fmt.format(parse(to))}`
  }, [filters.from_date, filters.to_date, monthStart, today])

  // Overview only supports account_id + date range; category filter applies to the list only
  const { data: overview } = useTransactionsOverview({
    account_id: filters.account_id,
    from_date: filters.from_date ?? monthStart,
    to_date: filters.to_date ?? today,
  })
  const {
    data: txnPages,
    isLoading: txnLoading,
    error: txnError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteTransactions({
    ...filters,
    q: search || undefined,
  })
  const transactions = useMemo(() => txnPages?.pages.flat() ?? [], [txnPages])

  // Infinite scroll: when the sentinel becomes visible, mark a fetch as
  // pending so the user sees feedback immediately, then fire fetchNextPage
  // after 1s of continuous visibility (soft throttle).
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [pendingFetch, setPendingFetch] = useState(false)
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) {
      setPendingFetch(false)
      return
    }
    const el = sentinelRef.current
    if (!el) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (timeoutId === null) {
          setPendingFetch(true)
          timeoutId = setTimeout(() => fetchNextPage(), 1000)
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
  const { data: categories } = useCategories()
  const { data: merchants } = useMerchants()
  const { data: accounts } = useAccounts()

  const hasOverviewData = overview?.total_inflow !== null && overview?.total_inflow !== undefined

  // Lookup maps for resolving IDs → display values
  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>()
    categories?.forEach((c) => map.set(c.id, c))
    return map
  }, [categories])

  const merchantMap = useMemo(() => {
    const map = new Map<string, Merchant>()
    merchants?.forEach((m) => map.set(m.id, m))
    return map
  }, [merchants])

  const accountMap = useMemo(() => {
    const map = new Map<string, string>()
    accounts?.forEach((a) => map.set(a.id, a.name))
    return map
  }, [accounts])

  const dateGroups = useMemo(
    () => groupByDate(transactions ?? []),
    [transactions],
  )

  // Resolve overview data or fall back to placeholders
  const inflow = hasOverviewData ? overview!.total_inflow! : PLACEHOLDER_FLOW.total_inflow
  const outflow = hasOverviewData ? overview!.total_outflow! : PLACEHOLDER_FLOW.total_outflow
  const netFlow = inflow + outflow
  const netColor = netFlow >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'

  const outliers = hasOverviewData
    ? (overview!.outliers ?? [])
    : PLACEHOLDER_OUTLIERS

  const categorySpend = hasOverviewData
    ? (overview!.top_categories ?? []).map((c) => ({
        name: c.category_name,
        amount: Math.abs(c.total),
      }))
    : PLACEHOLDER_CATEGORIES

  const dailyFlow = useMemo(() => {
    if (!hasOverviewData) return PLACEHOLDER_DAILY_FLOW
    const raw = overview!.daily_cash_flow ?? []
    if (raw.length === 0) return []

    // Parse "YYYY-MM-DD" as local time — new Date(str) treats it as UTC and drifts a day in negative offsets
    const toLocal = (s: string) => {
      const [y, m, d] = s.split('-').map(Number)
      return new Date(y, m - 1, d)
    }

    const byDate = new Map(raw.map((d) => [d.date, d]))
    const first = toLocal(raw[0].date)
    const last = toLocal(raw[raw.length - 1].date)
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1)  // Pad to the 1st of the earliest month

    const result: { date: string; inflow: number; outflow: number }[] = []
    while (cursor <= last) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const entry = byDate.get(iso)
      result.push({
        date: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        inflow: entry?.inflow ?? 0,
        outflow: entry?.outflow ?? 0,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    return result
  }, [overview, hasOverviewData])

  return (
    <div className="space-y-6">
      <header className="app-page-header">
        <h1 className="app-page-title">Transactions</h1>
        <p className="app-page-description">Every transaction, all in one place.</p>
      </header>

      {/* Metrics & charts section — with overlay when no data */}
      <section className="relative">
        {!hasOverviewData && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-md"
            style={{
              background: 'color-mix(in srgb, var(--app-bg) 75%, transparent)',
              boxShadow: 'inset 0 0 40px 20px var(--app-bg)',
            }}
          >
            <p className="text-lg font-medium" style={{ color: 'var(--app-text-muted)' }}>
              No transaction data for {rangeLabel}.
            </p>
          </div>
        )}

        <div
          style={{
            height: 2,
            background: 'var(--app-accent)',
            opacity: 0.35,
            borderRadius: 1,
          }}
        />
        <div className="grid grid-cols-3 py-5">
          {/* Net Flow */}
          <div className="pr-6">
            <p className="app-label mb-1.5">Net Flow</p>
            <p
              className="font-financial font-semibold tracking-tight leading-none text-6xl"
              style={{ color: netColor }}
            >
              {netFlow >= 0 ? '+' : ''}{formatCurrency(netFlow, displayCurrency)}
            </p>
            <div className="mt-3 flex items-center gap-4">
              <span
                className="inline-flex items-center gap-1 font-financial text-sm font-medium"
                style={{ color: 'var(--app-positive)' }}
              >
                <ArrowDownLeft size={14} aria-hidden />
                {formatCurrency(inflow, displayCurrency)}
              </span>
              <span
                className="inline-flex items-center gap-1 font-financial text-sm font-medium"
                style={{ color: 'var(--app-negative)' }}
              >
                <ArrowUpRight size={14} aria-hidden />
                {formatCurrency(Math.abs(outflow), displayCurrency)}
              </span>
            </div>
          </div>

          {/* Unusual Spending */}
          <div className="px-6" style={{ borderInline: '1px solid var(--app-border)' }}>
            <p className="app-label mb-1">Most Expensive Transactions</p>
            <div className="space-y-1 mt-2">
              {outliers.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5"
                  style={{
                    borderLeft: '2px solid var(--app-accent)',
                    background: 'var(--app-accent-soft)',
                  }}
                >
                  <p className="truncate min-w-0 text-sm font-medium">
                    {t.merchant_name ?? t.notes ?? 'Unknown'}
                  </p>
                  <p
                    className="font-financial text-sm font-medium shrink-0"
                    style={{ color: 'var(--app-negative)' }}
                  >
                    {formatCurrency(Math.abs(t.amount), displayCurrency)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Top Categories */}
          <div className="pl-6 flex flex-col">
            <p className="app-label mb-1">Top Categories</p>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categorySpend} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fontSize: 13, fill: 'var(--app-text-subtle)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--app-surface-soft)' }}
                    formatter={(value) => [formatCurrency(Number(value), displayCurrency), 'Spent']}
                    contentStyle={{
                      background: 'var(--app-nav-bg)',
                      border: '1px solid var(--app-border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="amount" radius={[0, 3, 3, 0]} barSize={10}>
                    {categorySpend.map((_, i) => (
                      <Cell
                        key={i}
                        fill={i === 0 ? 'var(--app-accent)' : 'var(--app-border-strong)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Grey divider with note */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px" style={{ background: 'var(--app-border-strong)' }} />
          <p className="shrink-0 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            Showing data for {rangeLabel}
          </p>
          <div className="flex-1 h-px" style={{ background: 'var(--app-border-strong)' }} />
        </div>

        {/* Daily Cash Flow */}
        <p className="app-label mb-3">Daily Cash Flow</p>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyFlow} margin={{ top: 4, right: 12, bottom: 0, left: 12 }}>
              <defs>
                <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--app-positive)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--app-positive)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="outflowGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="var(--app-negative)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--app-negative)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--app-text-subtle)' }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.ceil(dailyFlow.length / 10) - 1)}
              />
              <YAxis hide />
              <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
              <Tooltip
                formatter={(value, name) => [
                  formatCurrency(Math.abs(Number(value)), displayCurrency),
                  name === 'inflow' ? 'Inflow' : 'Outflow',
                ]}
                contentStyle={{
                  background: 'var(--app-nav-bg)',
                  border: '1px solid var(--app-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="inflow"
                stroke="var(--app-positive)"
                fill="url(#inflowGrad)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="outflow"
                stroke="var(--app-negative)"
                fill="url(#outflowGrad)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Gold divider */}
      <div
        style={{
          height: 2,
          background: 'var(--app-accent)',
          opacity: 0.35,
          borderRadius: 1,
        }}
      />

      {/* Toolbar */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 py-3 -my-3"
        style={{ background: 'var(--app-bg)' }}
      >
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--app-text-subtle)' }}
            aria-hidden
          />
          <input
            type="text"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="app-input w-full pl-9"
          />
        </div>
        <FilterChip
          label="Account"
          selectedLabel={accounts?.find((a) => a.id === filters.account_id)?.name ?? null}
          onClear={() => setFilter({ account_id: undefined })}
        >
          {(close) => (
            <FilterOptionList
              options={(accounts ?? []).map((a) => ({ value: a.id, label: a.name }))}
              selectedValue={filters.account_id}
              onSelect={(v) => { setFilter({ account_id: v }); close() }}
              searchPlaceholder="Search accounts..."
            />
          )}
        </FilterChip>

        <FilterChip
          label="Category"
          selectedLabel={categories?.find((c) => c.id === filters.category_id)?.name ?? null}
          onClear={() => setFilter({ category_id: undefined })}
        >
          {(close) => {
            const KIND_LABELS: Record<string, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' }
            const opts = (['expense', 'income', 'transfer'] as const).flatMap((kind) =>
              (categories ?? [])
                .filter((c) => c.kind === kind)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => ({ value: c.id, label: c.name, group: KIND_LABELS[kind] })),
            )
            return (
              <FilterOptionList
                options={opts}
                selectedValue={filters.category_id}
                onSelect={(v) => { setFilter({ category_id: v }); close() }}
                searchPlaceholder="Search categories..."
              />
            )
          }}
        </FilterChip>

        <FilterChip
          label="Date range"
          selectedLabel={
            filters.from_date || filters.to_date
              ? `${filters.from_date ?? '…'} → ${filters.to_date ?? '…'}`
              : null
          }
          onClear={() => setFilter({ from_date: undefined, to_date: undefined })}
          panelClassName="w-72 p-4 space-y-3"
        >
          {() => (
            <>
              <div>
                <label className="app-label block mb-1.5">From</label>
                <input
                  type="date"
                  className="app-input w-full"
                  value={filters.from_date ?? ''}
                  onChange={(e) => setFilter({ from_date: e.target.value })}
                />
              </div>
              <div>
                <label className="app-label block mb-1.5">To</label>
                <input
                  type="date"
                  className="app-input w-full"
                  value={filters.to_date ?? ''}
                  onChange={(e) => setFilter({ to_date: e.target.value })}
                />
              </div>
            </>
          )}
        </FilterChip>
        <button
          type="button"
          className="app-primary-button"
          onClick={openCreateModal}
        >
          <Plus size={16} aria-hidden />
          Add Transaction
        </button>
      </div>

      {/* Transaction list */}
      {txnLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="rounded-lg h-14 bg-gray-300" />
          ))}
        </div>
      ) : txnError ? (
        <p className="py-2 font-medium" style={{ color: 'var(--app-negative)' }}>
          Unable to load transactions.
        </p>
      ) : dateGroups.length === 0 ? (
        <p
          className="py-8 text-center italic text-sm"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          {search ? 'No transactions match your search.' : 'No transactions yet.'}
        </p>
      ) : (
        <section className="space-y-4">
          {dateGroups.map(({ dateLabel, transactions: txns }) => {
            const dailyTotal = txns.reduce((sum, t) => sum + t.amount, 0)
            const dailyColor = dailyTotal >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
            return (
              <div key={dateLabel}>
                {/* Date header */}
                <div
                  className="sticky top-[3.25rem] z-10 flex items-center justify-between px-3 py-2 rounded-lg"
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
                    {formatCurrency(dailyTotal, displayCurrency)}
                  </p>
                </div>

                {/* Rows */}
                <div>
                  {txns.map((t) => {
                    const isIncome = t.amount > 0
                    const category = categoryMap.get(t.category_id)
                    const merchantName = t.merchant_id ? merchantMap.get(t.merchant_id)?.name : null
                    const accountName = accountMap.get(t.account_id)
                    const Icon = getCategoryIcon(category?.icon)
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openEditModal(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openEditModal(t)
                          }
                        }}
                        className="flex items-center gap-4 py-3.5 px-3 cursor-pointer transition-colors duration-100 hover:bg-[var(--app-surface-soft)]"
                        style={{ borderBottom: '1px solid var(--app-border)' }}
                      >
                        {/* Category icon */}
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

                        {/* Merchant + account */}
                        <div className="min-w-0 w-44 shrink-0">
                          <p className="font-medium truncate">{merchantName ?? 'Transfer'}</p>
                          <p
                            className="text-sm mt-0.5 truncate"
                            style={{ color: 'var(--app-text-muted)' }}
                          >
                            {accountName ?? '\u00A0'}
                          </p>
                        </div>

                        {/* Notes */}
                        <p
                          className="min-w-0 flex-1 truncate"
                          style={{ color: 'var(--app-text-subtle)' }}
                        >
                          {t.notes ?? '\u00A0'}
                        </p>

                        {/* Category badge */}
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

                        {/* Amount */}
                        <p
                          className="font-financial font-medium shrink-0 tabular-nums w-28 text-right"
                          style={{ color: isIncome ? 'var(--app-positive)' : 'var(--app-text)' }}
                        >
                          {t.amount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(t.amount), displayCurrency)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Sentinel + loading / end-of-list indicator for infinite scroll */}
          <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
          {isFetchingNextPage || pendingFetch ? (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              Loading more transactions...
            </p>
          ) : hasNextPage === false ? (
            <p className="py-4 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              You've reached the end.
            </p>
          ) : null}
        </section>
      )}

      <CreateTransactionModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        transaction={editingTransaction ?? undefined}
      />
    </div>
  )
}
