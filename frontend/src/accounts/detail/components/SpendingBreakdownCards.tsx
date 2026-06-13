import { useMemo, useState } from 'react'
import {
  useAccountSpendingBreakdown,
  type Account,
  type SpendingRange,
} from '@/api/accounts'
import { TimeRangeSelector } from '@/components/TimeRangeSelector'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/LoadingTransition'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import {
  getCategoryColor,
  getCategoryColorMap,
  getDeterministicChartColor,
  getDeterministicChartColorMap,
} from '@/utils/chartColor'
import {
  BREAKDOWN_CARD_LIST_MIN_HEIGHT,
  BREAKDOWN_OTHER_COLOR,
  SPENDING_RANGE_OPTIONS,
  getBreakdownRowFillPercent,
  getBreakdownRows,
  type BreakdownRow,
  type BreakdownSnapshot,
} from '@/accounts/detail/utils/spendingBreakdownViewModel'

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
  transitionKey,
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
  transitionKey: string
}) {
  const incomingSnapshot = useMemo<BreakdownSnapshot>(() => ({
    rows,
    grandTotal,
    currency,
    emptyLabel,
  }), [currency, emptyLabel, grandTotal, rows])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<BreakdownSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })

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
        <LoadingContent
          concealed={contentConcealed}
          shouldReduceMotion={shouldReduceMotion}
          className="flex min-h-0 flex-1 flex-col"
        >
          {displaySnapshot.rows.length === 0 ? (
            <div
              className="flex-1 flex items-center justify-center text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {displaySnapshot.emptyLabel}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5" style={{ minHeight: BREAKDOWN_CARD_LIST_MIN_HEIGHT }}>
                {displaySnapshot.rows.map((item) => {
                  const barPct = getBreakdownRowFillPercent(item.total, displaySnapshot.grandTotal)
                  const color = item.isOther ? BREAKDOWN_OTHER_COLOR : item.color ?? getDeterministicChartColor(item.key || item.name)
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
                        {formatCurrency(item.total, displaySnapshot.currency)}
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
                  {formatCurrency(displaySnapshot.grandTotal, displaySnapshot.currency)}
                </span>
              </div>
            </>
          )}
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label={`Loading ${title.toLowerCase()}`}
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}

export function TopCategoriesBySpendingCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data, isFetching } = useAccountSpendingBreakdown(account.id, range)
  const categoryColors = useMemo(() => getCategoryColorMap((data?.top_categories ?? []).map((category) => ({
    id: category.category_id,
    name: category.name,
    kind: 'expense',
  }))), [data?.top_categories])

  const handleRangeChange = (nextRange: SpendingRange) => {
    if (nextRange === range) return
    setRange(nextRange)
  }

  const rows = getBreakdownRows(
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
      loading={isFetching}
      transitionKey={range}
    />
  )
}

export function TopMerchantsBySpendingCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data, isFetching } = useAccountSpendingBreakdown(account.id, range)
  const merchantColors = useMemo(() => getDeterministicChartColorMap((data?.top_merchants ?? []).map((merchant) => {
    const key = merchant.merchant_id || merchant.name

    return {
      key,
      seed: key,
    }
  })), [data?.top_merchants])

  const handleRangeChange = (nextRange: SpendingRange) => {
    if (nextRange === range) return
    setRange(nextRange)
  }

  const rows = getBreakdownRows(
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
      loading={isFetching}
      transitionKey={range}
    />
  )
}
