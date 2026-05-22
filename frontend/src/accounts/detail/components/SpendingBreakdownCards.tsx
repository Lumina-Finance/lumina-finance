import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  useAccountSpendingBreakdown,
  type Account,
  type AccountSpendingBreakdown,
  type SpendingRange,
} from '@/api/accounts'
import { TimeRangeSelector, type TimeRangeSelectorOption } from '@/components/TimeRangeSelector'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  getCategoryColor,
  getCategoryColorMap,
  getDeterministicChartColor,
  getDeterministicChartColorMap,
} from '@/utils/chartColor'
import { EASE } from '@/accounts/detail/constants/accountDetail'

// Spending range tabs. `SpendingRange` is imported from the API layer so
// the select options stay in lockstep with the backend's accepted values.
const SPENDING_RANGE_OPTIONS: TimeRangeSelectorOption<SpendingRange>[] = [
  { value: 'WTD', label: 'WTD', description: 'Week to date' },
  { value: 'MTD', label: 'MTD', description: 'Month to date' },
  { value: 'QTD', label: 'QTD', description: 'Quarter to date' },
  { value: 'YTD', label: 'YTD', description: 'Year to date' },
]

interface BreakdownRow {
  key: string
  name: string
  total: number
  isOther: boolean
  color?: string
}

const BREAKDOWN_CARD_LIST_MIN_HEIGHT = 270
const BREAKDOWN_RANGE_LOADING_DELAY_MS = 500
const BREAKDOWN_LOADING_ROW_WIDTHS = ['72%', '58%', '66%', '50%', '62%', '44%'] as const

// Append an "Other (N)" row when the backend signals more entries exist
// beyond the top 5. Its total = grand_total - sum(top 5), which the card
// also uses to size the row's proportional fill.
function withOtherRow(rows: BreakdownRow[], otherCount: number, grandTotal: number): BreakdownRow[] {
  if (otherCount <= 0) return rows
  const topSum = rows.reduce((sum, r) => sum + r.total, 0)
  const otherTotal = Math.max(grandTotal - topSum, 0)
  return [...rows, { key: 'other', name: `Other (${otherCount})`, total: otherTotal, isOther: true }]
}

function useBreakdownRangeTransition(isFetching: boolean) {
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [showLoading, setShowLoading] = useState(false)

  // Keep the range-change skeleton from flashing on very fast responses, while
  // still guaranteeing it clears after the fetch settles.
  useEffect(() => {
    if (startedAt === null) return undefined

    const elapsed = performance.now() - startedAt
    const remaining = Math.max(BREAKDOWN_RANGE_LOADING_DELAY_MS - elapsed, 0)

    if (isFetching) {
      if (showLoading) return undefined

      const timeoutId = window.setTimeout(() => setShowLoading(true), remaining)
      return () => window.clearTimeout(timeoutId)
    }

    const timeoutId = window.setTimeout(() => {
      setStartedAt(null)
      setShowLoading(false)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isFetching, showLoading, startedAt])

  return {
    loading: showLoading,
    startTransition: () => {
      setStartedAt(performance.now())
      setShowLoading(false)
    },
  }
}

function BreakdownLoadingOverlay({ shouldReduceMotion }: { shouldReduceMotion: boolean }) {
  return (
    <motion.div
      key="breakdown-loading"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex flex-col"
      style={{ background: 'var(--app-surface-soft)' }}
      initial={false}
      animate={{ opacity: 1 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: EASE }}
    >
      <div className="flex flex-col gap-1.5" style={{ minHeight: BREAKDOWN_CARD_LIST_MIN_HEIGHT }}>
        {BREAKDOWN_LOADING_ROW_WIDTHS.map((width) => (
          <div
            key={width}
            className="relative h-10 overflow-hidden rounded-xl"
            style={{ background: 'var(--app-bg)' }}
          >
            <span
              className="absolute left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
              style={{ background: 'var(--app-accent-soft)' }}
            />
            <span
              className="absolute left-8 top-1/2 h-2.5 -translate-y-1/2 rounded-full"
              style={{ width, background: 'var(--app-border)' }}
            />
            {!shouldReduceMotion && (
              <motion.span
                className="absolute inset-y-0 w-1/3"
                style={{
                  background: 'linear-gradient(90deg, transparent, var(--app-surface-soft), transparent)',
                }}
                animate={{ x: ['-140%', '360%'] }}
                transition={{ duration: 1.1, ease: EASE, repeat: Infinity }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex-1" />

      <div
        className="flex items-center gap-3 pt-3"
        style={{ borderTop: '1px solid var(--app-border)' }}
      >
        <div className="w-2 shrink-0" />
        <span
          className="h-2.5 w-12 rounded-full"
          style={{ background: 'var(--app-border)' }}
        />
        <span className="flex-1" />
        <span
          className="h-3 w-24 rounded-full"
          style={{ background: 'var(--app-border)' }}
        />
      </div>
    </motion.div>
  )
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
  loading,
  contentKey,
}: {
  title: string
  rangeLabel: string
  range: SpendingRange
  onRangeChange: (r: SpendingRange) => void
  rows: BreakdownRow[]
  grandTotal: number
  currency: string
  emptyLabel: string
  loading: boolean
  contentKey: string
}) {
  const shouldReduceMotion = useReducedMotion() ?? false

  return (
    <section
      className="app-card flex h-[440px] flex-col min-[1200px]:h-[400px]"
      aria-busy={loading}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">{title}</p>
        <TimeRangeSelector
          value={range}
          options={SPENDING_RANGE_OPTIONS}
          onChange={onRangeChange}
          ariaLabel={rangeLabel}
          className="hidden min-[1200px]:inline-flex"
        />
        <TimeRangeSelector
          value={range}
          options={SPENDING_RANGE_OPTIONS}
          onChange={onRangeChange}
          ariaLabel={rangeLabel}
          variant="mobile"
          className="w-full min-[1200px]:hidden"
          sheetTitle={rangeLabel}
        />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={contentKey}
            className="flex min-h-0 flex-1 flex-col"
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: EASE }}
          >
            {rows.length === 0 ? (
              <div
                className="flex-1 flex items-center justify-center text-sm"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                {emptyLabel}
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5" style={{ minHeight: BREAKDOWN_CARD_LIST_MIN_HEIGHT }}>
                  {rows.map((item) => {
                    // Width is based on share of total spend. A 4% minimum keeps
                    // tiny rows visible, and abs() handles signed spend totals.
                    const totalAbs = Math.abs(grandTotal)
                    const barPct = totalAbs > 0 ? Math.max((Math.abs(item.total) / totalAbs) * 100, 4) : 0
                    const color = item.isOther ? '#8C8074' : item.color ?? getDeterministicChartColor(item.key || item.name)
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

                {/* Keeps Total pinned to the bottom when there are few rows. */}
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
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {loading && <BreakdownLoadingOverlay shouldReduceMotion={shouldReduceMotion} />}
        </AnimatePresence>
      </div>
    </section>
  )
}

export function TopCategoriesBySpendingCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data, isFetching } = useAccountSpendingBreakdown(account.id, range)
  const { loading, startTransition } = useBreakdownRangeTransition(isFetching)
  const categoryColors = useMemo(() => getCategoryColorMap((data?.top_categories ?? []).map((category) => ({
    id: category.category_id,
    name: category.name,
    kind: 'expense',
  }))), [data?.top_categories])

  const handleRangeChange = (nextRange: SpendingRange) => {
    if (nextRange === range) return
    startTransition()
    setRange(nextRange)
  }

  const rows = breakdownToRows(
    data,
    (b) => b.top_categories.map((c) => ({
      key: c.category_id,
      name: c.name,
      total: c.total,
      isOther: false,
      color: categoryColors.get(c.category_id || c.name) ?? getCategoryColor({
        id: c.category_id,
        name: c.name,
        kind: 'expense',
      }),
    })),
    (b) => b.other_categories_count,
  )

  return (
    <BreakdownCard
      title="Categories by Spending"
      rangeLabel="Spending range"
      range={range}
      onRangeChange={handleRangeChange}
      rows={rows}
      grandTotal={data?.grand_total_spend ?? 0}
      currency={account.currency}
      emptyLabel="No spending in this range"
      loading={loading}
      contentKey={`categories-${data?.range ?? range}`}
    />
  )
}

export function TopMerchantsBySpendingCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data, isFetching } = useAccountSpendingBreakdown(account.id, range)
  const { loading, startTransition } = useBreakdownRangeTransition(isFetching)
  const merchantColors = useMemo(() => getDeterministicChartColorMap((data?.top_merchants ?? []).map((merchant) => {
    const key = merchant.merchant_id || merchant.name

    return {
      key,
      seed: key,
    }
  })), [data?.top_merchants])

  const handleRangeChange = (nextRange: SpendingRange) => {
    if (nextRange === range) return
    startTransition()
    setRange(nextRange)
  }

  const rows = breakdownToRows(
    data,
    (b) => b.top_merchants.map((m) => {
      const key = m.merchant_id || m.name

      return {
        key,
        name: m.name,
        total: m.total,
        isOther: false,
        color: merchantColors.get(key) ?? getDeterministicChartColor(key),
      }
    }),
    (b) => b.other_merchants_count,
  )

  return (
    <BreakdownCard
      title="Merchants by Spending"
      rangeLabel="Merchant range"
      range={range}
      onRangeChange={handleRangeChange}
      rows={rows}
      grandTotal={data?.grand_total_spend ?? 0}
      currency={account.currency}
      emptyLabel="No merchant activity in this range"
      loading={loading}
      contentKey={`merchants-${data?.range ?? range}`}
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
