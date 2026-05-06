import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Plus,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
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
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts, type AccountsOverview } from '@/api/accounts'
import { useCategories, type Category } from '@/api/categories'
import {
  fetchTransaction,
  useInfiniteTransactions,
  useTransactionsOverview,
  type Transaction,
} from '@/api/transactions'
import { transactionKeys, transactionOverviewKeys } from '@/api/queryKeys'
import { useFocusRefetch } from '@/hooks/useFocusRefetch'
import { formatCurrency } from '@/utils/formatCurrency'
import CreateTransactionModal from '@/components/CreateTransactionModal'
import DateRangeFilterPanel from '@/components/DateRangeFilterPanel'
import FilterChip from '@/components/FilterChip'
import FilterOptionList from '@/components/FilterOptionList'
import IconTooltip from '@/components/IconTooltip'
import TransactionRow from '@/components/TransactionRow'

const DEFAULT_CATEGORY_ICON = '🏷️'

interface TransactionFilterValues {
  account_id?: string
  category_id?: string
  from_date?: string
  to_date?: string
}

const TRANSACTION_FILTER_KEYS = [
  'account_id',
  'category_id',
  'from_date',
  'to_date',
] as const
const FILTER_LIST_LOADING_MIN_MS = 1000
const TOP_CATEGORY_AXIS_MIN_WIDTH = 110
const TOP_CATEGORY_AXIS_LABEL_PADDING = 18
const TOP_CATEGORY_AXIS_AVG_CHAR_WIDTH = 7.4

function currentTimeMs() {
  return Date.now()
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

// Compact label for the date range filter chip. Drops the duplicate year when
// both dates share one (e.g. "Jan 1 – Apr 30, 2026") and uses a short 2-digit
// year otherwise ("Jan 1, '25 – Apr 30, '26"). Returns null when no dates are
// set so the chip falls back to its placeholder.
function formatDateRangeLabel(from?: string, to?: string): string | null {
  if (!from && !to) return null
  const monthDay = (ymd: string) =>
    parseYmdLocal(ymd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const fullYear = (ymd: string) => ymd.slice(0, 4)
  const shortYear = (ymd: string) => `'${ymd.slice(2, 4)}`

  if (from && to) {
    if (fullYear(from) === fullYear(to)) {
      return `${monthDay(from)} – ${monthDay(to)}, ${fullYear(to)}`
    }
    return `${monthDay(from)}, ${shortYear(from)} – ${monthDay(to)}, ${shortYear(to)}`
  }
  if (from) return `From ${monthDay(from)}, ${fullYear(from)}`
  return `Until ${monthDay(to!)}, ${fullYear(to!)}`
}

function normalizeTransactionFilters(filters: TransactionFilterValues): TransactionFilterValues {
  const next = { ...filters }
  for (const key of TRANSACTION_FILTER_KEYS) {
    if (!next[key]) delete next[key]
  }
  return next
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

function TransactionFilterLoadingOverlay({
  placement = 'top',
  reducedMotion,
}: {
  placement?: 'center' | 'top'
  reducedMotion: boolean | null
}) {
  return (
    <motion.div
      className={`absolute inset-0 z-30 flex min-h-64 flex-col items-center gap-4 ${
        placement === 'center' ? 'justify-center' : 'justify-start pt-24'
      }`}
      style={{
        background: 'color-mix(in srgb, var(--app-bg) 72%, transparent)',
        backdropFilter: 'blur(3px)',
        touchAction: 'none',
      }}
      role="status"
      aria-live="polite"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.18 }}
      onWheel={(event) => event.preventDefault()}
      onTouchMove={(event) => event.preventDefault()}
    >
      <div
        className="h-9 w-9 rounded-full border-2 animate-spin motion-reduce:animate-none"
        style={{ borderColor: 'var(--app-border-strong)', borderTopColor: 'var(--app-accent)' }}
        aria-hidden
      />
      <p
        className="text-xs font-medium uppercase tracking-[0.2em]"
        style={{ color: 'var(--app-text-subtle)' }}
      >
        Loading transactions
      </p>
    </motion.div>
  )
}

// ── Component ──

export default function Transactions() {
  const prefersReducedMotion = useReducedMotion()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  // `search` tracks what the user is typing in real time; `activeSearch` is
  // what actually gets sent to the API. It catches up 1 second after typing
  // pauses, or right away when the user presses Enter — so the input stays
  // responsive and the API isn't hit on every keystroke.
  const [activeSearch, setActiveSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setActiveSearch(search), 1000)
    return () => clearTimeout(timer)
  }, [search])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [openingOutlierId, setOpeningOutlierId] = useState<string | null>(null)
  const [outlierOpenError, setOutlierOpenError] = useState<string | null>(null)
  const latestTransactionsRef = useRef<Transaction[]>([])
  const filterLoadingStartedAtRef = useRef(0)
  const filterLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useFocusRefetch([
    { queryKey: transactionKeys.all, exact: false },
    { queryKey: transactionOverviewKeys.all, exact: false },
  ])

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
  const openOutlierTransaction = async (transactionId: string) => {
    const loadedTransaction = latestTransactionsRef.current.find((txn) => txn.id === transactionId)
    if (loadedTransaction) {
      openEditModal(loadedTransaction)
      return
    }

    setOutlierOpenError(null)
    setOpeningOutlierId(transactionId)
    try {
      const transaction = await queryClient.fetchQuery({
        queryKey: transactionKeys.detail(transactionId),
        queryFn: () => fetchTransaction(transactionId),
        staleTime: 10 * 60 * 1000,
      })
      openEditModal(transaction)
    } catch {
      setOutlierOpenError('Unable to open transaction')
    } finally {
      setOpeningOutlierId((current) => (current === transactionId ? null : current))
    }
  }
  const [filters, setFilters] = useState<TransactionFilterValues>({})
  const filtersRef = useRef(filters)
  const [filterListLoading, setFilterListLoading] = useState(false)
  const [filterLoadingRows, setFilterLoadingRows] = useState<Transaction[] | null>(null)
  const [pendingClearReveal, setPendingClearReveal] = useState(false)
  const [clearExitRows, setClearExitRows] = useState<Transaction[] | null>(null)
  const [listRevealKey, setListRevealKey] = useState(0)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const setFilter = (patch: Partial<TransactionFilterValues>) => {
    const current = filtersRef.current
    const next = normalizeTransactionFilters({ ...current, ...patch })
    const changed = TRANSACTION_FILTER_KEYS.some((key) => current[key] !== next[key])
    if (!changed) return

    const isApplyingFilter = Object.values(patch).some(Boolean)
    if (isApplyingFilter) {
      setPendingClearReveal(false)
      setClearExitRows(null)
      if (filterLoadingTimeoutRef.current !== null) {
        clearTimeout(filterLoadingTimeoutRef.current)
        filterLoadingTimeoutRef.current = null
      }
      filterLoadingStartedAtRef.current = currentTimeMs()
      setFilterLoadingRows(latestTransactionsRef.current)
      setFilterListLoading(true)
    } else {
      if (filterLoadingTimeoutRef.current !== null) {
        clearTimeout(filterLoadingTimeoutRef.current)
        filterLoadingTimeoutRef.current = null
      }
      filterLoadingStartedAtRef.current = 0
      setFilterListLoading(false)
      setFilterLoadingRows(null)
      setClearExitRows(latestTransactionsRef.current)
      setPendingClearReveal(true)
    }

    setFilters(next)
  }

  // Date range chip: the user edits `pendingFrom` / `pendingTo` inside the
  // popover, and those only become the applied `filters.from_date` /
  // `filters.to_date` (which is what triggers a refetch) when they click Apply
  // or close the panel. An invalid range (from > to, mirroring the backend's
  // 422 rule) gets reverted on close and blocks the Apply button.
  //
  // Drafts are reset to the applied values whenever filters change externally
  // (e.g. a different chip clears the range). The "adjust state while
  // rendering" pattern avoids the cascading render an effect would cause.
  const [pendingFrom, setPendingFrom] = useState(filters.from_date ?? '')
  const [pendingTo, setPendingTo] = useState(filters.to_date ?? '')
  const [syncedRange, setSyncedRange] = useState({
    from: filters.from_date,
    to: filters.to_date,
  })
  if (syncedRange.from !== filters.from_date || syncedRange.to !== filters.to_date) {
    setSyncedRange({ from: filters.from_date, to: filters.to_date })
    setPendingFrom(filters.from_date ?? '')
    setPendingTo(filters.to_date ?? '')
  }
  const dateRangeInvalid = !!pendingFrom && !!pendingTo && pendingFrom > pendingTo
  const dateRangeChanged =
    (pendingFrom || undefined) !== filters.from_date ||
    (pendingTo || undefined) !== filters.to_date
  const commitDateRange = () => {
    if (dateRangeInvalid) {
      setPendingFrom(filters.from_date ?? '')
      setPendingTo(filters.to_date ?? '')
      return
    }
    const nextFrom = pendingFrom || undefined
    const nextTo = pendingTo || undefined
    if (nextFrom === filters.from_date && nextTo === filters.to_date) return
    setFilter({ from_date: nextFrom, to_date: nextTo })
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
  const { data: overview, isFetching: isOverviewFetching } = useTransactionsOverview({
    account_id: filters.account_id,
    from_date: filters.from_date ?? monthStart,
    to_date: filters.to_date ?? today,
  })
  const {
    data: txnPages,
    error: txnError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteTransactions({
    ...filters,
    q: activeSearch || undefined,
  })
  const transactions = useMemo(() => txnPages?.pages.flat() ?? [], [txnPages])
  const transactionsLoaded = txnPages !== undefined
  const displayedTransactions = filterListLoading && filterLoadingRows
    ? filterLoadingRows
    : clearExitRows ?? transactions
  const displayedTransactionsLoaded =
    transactionsLoaded || (filterListLoading && filterLoadingRows !== null) || clearExitRows !== null

  useEffect(() => {
    return () => {
      if (filterLoadingTimeoutRef.current !== null) {
        clearTimeout(filterLoadingTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!filterListLoading && !pendingClearReveal && clearExitRows === null && transactionsLoaded) {
      latestTransactionsRef.current = transactions
    }
  }, [clearExitRows, filterListLoading, pendingClearReveal, transactions, transactionsLoaded])

  useEffect(() => {
    if (!pendingClearReveal || isFetching || txnPages === undefined) return
    const revealTimeout = window.setTimeout(() => {
      setListRevealKey((key) => key + 1)
      setClearExitRows(null)
      setPendingClearReveal(false)
    }, 0)
    return () => window.clearTimeout(revealTimeout)
  }, [isFetching, pendingClearReveal, txnPages])

  useEffect(() => {
    if (!filterListLoading) return
    if (!isFetching && !isOverviewFetching && (txnPages !== undefined || txnError)) {
      const elapsed = Date.now() - filterLoadingStartedAtRef.current
      const remaining = Math.max(FILTER_LIST_LOADING_MIN_MS - elapsed, 0)
      if (filterLoadingTimeoutRef.current !== null) {
        clearTimeout(filterLoadingTimeoutRef.current)
      }
      filterLoadingTimeoutRef.current = setTimeout(() => {
        setFilterListLoading(false)
        setFilterLoadingRows(null)
        filterLoadingStartedAtRef.current = 0
        filterLoadingTimeoutRef.current = null
      }, remaining)
    }
  }, [filterListLoading, isFetching, isOverviewFetching, txnError, txnPages])

  // Infinite scroll: when the sentinel becomes visible, mark a fetch as
  // pending so the user sees feedback immediately, then fire fetchNextPage
  // after 1s of continuous visibility (soft throttle). The raw `pendingFetch`
  // flag only tracks the viewport-intersection side; actual visibility in the
  // UI is derived below so query state (no next page, already fetching) takes
  // precedence without needing an effect to reset the flag.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [pendingFetch, setPendingFetch] = useState(false)
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || filterListLoading) return
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
  }, [hasNextPage, isFetchingNextPage, filterListLoading, fetchNextPage])
  const showPendingFetch = pendingFetch && hasNextPage && !isFetchingNextPage
  const { data: categories } = useCategories()
  const { data: accounts } = useAccounts()

  const hasOverviewData = overview?.total_inflow !== null && overview?.total_inflow !== undefined

  // Lookup maps for resolving IDs → display values
  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>()
    categories?.forEach((c) => map.set(c.id, c))
    return map
  }, [categories])

  const accountMap = useMemo(() => {
    const map = new Map<string, AccountsOverview>()
    accounts?.forEach((a) => map.set(a.id, a))
    return map
  }, [accounts])

  const dateGroups = useMemo(
    () => groupByDate(displayedTransactions),
    [displayedTransactions],
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
  const topCategoryChartHeight = Math.max(24, categorySpend.length * 26)
  const topCategoryAxisWidth = Math.max(
    TOP_CATEGORY_AXIS_MIN_WIDTH,
    Math.ceil(
      categorySpend.reduce((longest, category) => Math.max(longest, category.name.length), 0)
      * TOP_CATEGORY_AXIS_AVG_CHAR_WIDTH
      + TOP_CATEGORY_AXIS_LABEL_PADDING,
    ),
  )

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
  const chartAnimationKey = [
    filters.account_id ?? 'all-accounts',
    filters.category_id ?? 'all-categories',
    filters.from_date ?? monthStart,
    filters.to_date ?? today,
  ].join('|')
  const chartAnimationDuration = prefersReducedMotion ? 0 : 550
  const metricsLayoutTransition = {
    duration: prefersReducedMotion ? 0 : 0.28,
    ease: [0.25, 0.1, 0.25, 1],
  } as const
  const metricsBandContentRef = useRef<HTMLDivElement>(null)
  const [metricsBandHeight, setMetricsBandHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = metricsBandContentRef.current
    if (!element) return

    const updateHeight = () => setMetricsBandHeight(element.getBoundingClientRect().height)
    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="space-y-6">
      <header className="app-page-header">
        <h1 className="app-page-title">Transactions</h1>
        <p className="app-page-description">Every transaction, all in one place.</p>
      </header>

      {/* Metrics & charts section — with overlay when no data */}
      <section className="relative">
        <AnimatePresence>
          {filterListLoading && (
            <TransactionFilterLoadingOverlay
              placement="center"
              reducedMotion={prefersReducedMotion}
            />
          )}
        </AnimatePresence>
        {!filterListLoading && !hasOverviewData && (
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
        <motion.div
          animate={metricsBandHeight === null ? undefined : { height: metricsBandHeight }}
          initial={false}
          transition={metricsLayoutTransition}
          style={{ overflow: 'hidden' }}
        >
          <div ref={metricsBandContentRef} className="grid grid-cols-3 items-start pb-2 pt-5">
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
            <div className="px-6 flex flex-col" style={{ borderInline: '1px solid var(--app-border)' }}>
              <p className="app-label mb-1 inline-flex items-center gap-2">
                Most Expensive Transactions
                <IconTooltip
                  label="How most expensive transactions are calculated"
                  level="info"
                  placement="bottom"
                  widthClassName="w-64"
                >
                  Shows the three largest expense transactions in the selected period
                </IconTooltip>
              </p>
              <div className="mt-2 flex flex-col gap-2.5">
                <AnimatePresence initial={false}>
                  {outliers.map((t) => {
                    const loading = openingOutlierId === t.id
                    const label = t.merchant_name ?? t.notes ?? 'Unknown'
                    return (
                      <motion.button
                        key={t.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-opacity hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                        style={{
                          borderLeft: '2px solid var(--app-accent)',
                          background: 'var(--app-accent-soft)',
                        }}
                        aria-busy={loading}
                        aria-label={`Edit transaction: ${label}`}
                        disabled={openingOutlierId !== null}
                        onClick={() => { void openOutlierTransaction(t.id) }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: prefersReducedMotion ? 0 : 0.28 }}
                      >
                        <p className="truncate min-w-0 text-sm font-medium">
                          {label}
                        </p>
                        {loading ? (
                          <span
                            className="app-spinner shrink-0"
                            aria-label="Loading transaction"
                            style={{ width: 16, height: 16, borderWidth: 2 }}
                          />
                        ) : (
                          <p
                            className="font-financial text-sm font-medium shrink-0"
                            style={{ color: 'var(--app-negative)' }}
                          >
                            {formatCurrency(Math.abs(t.amount), displayCurrency)}
                          </p>
                        )}
                      </motion.button>
                    )
                  })}
                </AnimatePresence>
                {outlierOpenError && (
                  <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
                    {outlierOpenError}
                  </p>
                )}
              </div>
            </div>

            {/* Top Categories */}
            <div className="pl-6 flex flex-col">
              <p className="app-label mb-1 inline-flex items-center gap-2">
                Top Categories
                <IconTooltip
                  label="How top categories are calculated"
                  level="info"
                  placement="bottom"
                  widthClassName="w-64"
                >
                  The top 5 categories as ranked by total amount spent in the selected period. The progress bar is relative to the highest-spend category, not an absolute scale.
                </IconTooltip>
              </p>
              <div className="mt-2">
                <div style={{ height: topCategoryChartHeight }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      key={`categories-${chartAnimationKey}`}
                      data={categorySpend}
                      layout="vertical"
                      margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={topCategoryAxisWidth}
                        interval={0}
                        tickMargin={6}
                        tick={{ fontSize: 13, fill: 'var(--app-text-subtle)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        wrapperClassName="app-chart-tooltip-compact"
                        cursor={{ fill: 'var(--app-surface-soft)' }}
                        formatter={(value) => [formatCurrency(Number(value), displayCurrency), 'Spent']}
                      />
                      <Bar
                        dataKey="amount"
                        radius={[0, 5, 5, 0]}
                        barSize={16}
                        isAnimationActive={!prefersReducedMotion}
                        animationDuration={chartAnimationDuration}
                      >
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
          </div>
        </motion.div>

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
            <AreaChart
              key={`daily-flow-${chartAnimationKey}`}
              data={dailyFlow}
              margin={{ top: 4, right: 12, bottom: 0, left: 12 }}
            >
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
                wrapperClassName="app-chart-tooltip-compact"
                formatter={(value, name) => [
                  formatCurrency(Math.abs(Number(value)), displayCurrency),
                  name === 'inflow' ? 'Inflow' : 'Outflow',
                ]}
              />
              <Area
                type="monotone"
                dataKey="inflow"
                stroke="var(--app-positive)"
                fill="url(#inflowGrad)"
                strokeWidth={1.5}
                isAnimationActive={!prefersReducedMotion}
                animationDuration={chartAnimationDuration}
              />
              <Area
                type="monotone"
                dataKey="outflow"
                stroke="var(--app-negative)"
                fill="url(#outflowGrad)"
                strokeWidth={1.5}
                isAnimationActive={!prefersReducedMotion}
                animationDuration={chartAnimationDuration}
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
        className="sticky top-0 z-30 !mt-2 mb-2 flex items-center gap-3 pb-2 pt-5"
        style={{
          background: 'var(--app-bg)',
          boxShadow: '0 0.25rem 0 var(--app-bg)',
        }}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') setActiveSearch(search)
            }}
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
                .map((c) => ({ value: c.id, label: c.name, group: KIND_LABELS[kind], icon: c.icon ?? DEFAULT_CATEGORY_ICON })),
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
          selectedLabel={formatDateRangeLabel(filters.from_date, filters.to_date)}
          onClear={() => setFilter({ from_date: undefined, to_date: undefined })}
          onClose={commitDateRange}
          panelAlign="right"
          panelClassName="w-[25rem] overflow-hidden"
        >
          {(close) => (
            <DateRangeFilterPanel
              from={pendingFrom}
              to={pendingTo}
              changed={dateRangeChanged}
              invalid={dateRangeInvalid}
              onFromChange={setPendingFrom}
              onToChange={setPendingTo}
              onReset={() => {
                setPendingFrom('')
                setPendingTo('')
              }}
              onApply={close}
            />
          )}
        </FilterChip>
        <button
          type="button"
          className="app-primary-button"
          onClick={openCreateModal}
        >
          <Plus size={18} aria-hidden />
          Add Transaction
        </button>
      </div>

      {/* Transaction list */}
      <div className="relative" aria-busy={filterListLoading}>
        <AnimatePresence>
          {filterListLoading && <TransactionFilterLoadingOverlay reducedMotion={prefersReducedMotion} />}
        </AnimatePresence>

        <AnimatePresence initial={false} mode="wait">
          {txnError ? (
            <motion.p
              key={`error-${listRevealKey}`}
              className="py-2 font-medium"
              style={{ color: 'var(--app-negative)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
            >
              Unable to load transactions.
            </motion.p>
          ) : displayedTransactionsLoaded && dateGroups.length === 0 ? (
            <motion.p
              key={`empty-${listRevealKey}`}
              className="py-8 text-center italic text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
              initial={listRevealKey === 0 || prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: [0.25, 0.1, 0.25, 1] }}
            >
              {search ? 'No transactions match your search.' : 'No transactions yet.'}
            </motion.p>
          ) : displayedTransactionsLoaded ? (
            <motion.section
              key={`list-${listRevealKey}`}
              className="space-y-4"
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            >
              {dateGroups.map(({ dateLabel, transactions: txns }, groupIndex) => {
                const dailyTotal = txns.reduce((sum, t) => sum + t.amount, 0)
                const dailyColor = dailyTotal >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
                return (
                  <motion.div
                    key={`${dateLabel}-${listRevealKey}`}
                    initial={
                      listRevealKey === 0 || prefersReducedMotion
                        ? false
                        : { opacity: 0 }
                    }
                    animate={{ opacity: 1 }}
                    transition={{
                      duration: prefersReducedMotion ? 0 : 0.28,
                      delay: prefersReducedMotion ? 0 : Math.min(groupIndex * 0.035, 0.18),
                      ease: [0.25, 0.1, 0.25, 1],
                    }}
                  >
                  {/* Date header */}
                  <div
                    className="sticky top-[4.5rem] z-20 flex items-center justify-between px-3 py-2 rounded-lg"
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
                      const category = categoryMap.get(t.category_id)
                      const account = accountMap.get(t.account_id)
                      return (
                        <TransactionRow
                          key={t.id}
                          accountInstitution={account?.institution}
                          accountName={account?.name}
                          category={category}
                          currency={displayCurrency}
                          transaction={t}
                          onOpen={openEditModal}
                        />
                      )
                    })}
                  </div>
                  </motion.div>
                )
              })}

              {/* Sentinel + loading / end-of-list indicator for infinite scroll */}
              <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
              {isFetchingNextPage || showPendingFetch ? (
                <p className="py-4 text-center text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  Loading more transactions...
                </p>
              ) : hasNextPage === false ? (
                <p
                  className="py-4 text-center text-sm italic"
                  style={{ color: 'var(--app-text-subtle)' }}
                >
                  You've reached the end.
                </p>
              ) : null}
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>

      <CreateTransactionModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        transaction={editingTransaction ?? undefined}
      />
    </div>
  )
}
