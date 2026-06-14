import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { TransactionsOverview } from '@/api/transactions'
import TransactionFilterLoadingOverlay from '@/pages/transactions/components/FilterLoadingOverlay'
import DailyCashFlowChart, {
  type DailyCashFlowChartMode,
} from '@/pages/transactions/components/top-band/DailyCashFlowChart'
import MostExpensiveTransactionsPanel from '@/pages/transactions/components/top-band/MostExpensiveTransactionsPanel'
import NetFlowSummary from '@/pages/transactions/components/top-band/NetFlowSummary'
import TopCategoriesChart from '@/pages/transactions/components/top-band/TopCategoriesChart'
import {
  PLACEHOLDER_CATEGORIES,
  PLACEHOLDER_FLOW,
  PLACEHOLDER_OUTLIERS,
} from '@/pages/transactions/components/top-band/constants'

const topBandDividerStyle = {
  height: 1,
  background:
    'linear-gradient(to right, var(--app-accent), var(--app-accent-border), transparent)',
}

function TopBandDivider({ className = '' }: { className?: string }) {
  return <div className={className} style={topBandDividerStyle} />
}

/**
 * Renders the transaction overview metrics band and daily cash-flow chart
 */
export default function TransactionsTopBand({
  overview,
  displayCurrency,
  loading,
  rangeLabel,
  fromDate,
  toDate,
  chartAnimationKey,
  prefersReducedMotion,
  openingOutlierId,
  outlierOpenError,
  onOpenOutlierTransaction,
}: {
  overview: TransactionsOverview | undefined
  displayCurrency: string
  loading: boolean
  rangeLabel: string
  fromDate: string
  toDate: string
  chartAnimationKey: string
  prefersReducedMotion: boolean | null
  openingOutlierId: string | null
  outlierOpenError: string | null
  onOpenOutlierTransaction: (transactionId: string) => void
}) {
  const overviewOutliers = overview?.outliers ?? []
  const overviewCategories = overview?.top_categories ?? []
  const overviewDailyCashFlow = overview?.daily_cash_flow ?? []
  const hasTransactions = overview?.total_inflow !== null && overview?.total_inflow !== undefined
  const hasNetFlowData =
    (overview?.total_inflow ?? 0) !== 0 || (overview?.total_outflow ?? 0) !== 0
  const hasOutlierData = overviewOutliers.length > 0
  const hasCategoryData = overviewCategories.length > 0
  const hasDailyCashFlowData = overviewDailyCashFlow.some((day) => day.inflow !== 0 || day.outflow !== 0)
  const hasOverviewData = hasNetFlowData || hasOutlierData || hasCategoryData || hasDailyCashFlowData
  const emptyOverlayMessage = hasTransactions
    ? `No qualifying transactions for ${rangeLabel}`
    : `No transaction data for ${rangeLabel}.`

  // Placeholders preserve chart geometry only when the whole top band is under the empty overlay
  const inflow = hasNetFlowData ? overview!.total_inflow! : PLACEHOLDER_FLOW.total_inflow
  const outflow = hasNetFlowData ? overview!.total_outflow! : PLACEHOLDER_FLOW.total_outflow
  const outliers = hasOutlierData
    ? overviewOutliers
    : hasOverviewData
      ? []
      : PLACEHOLDER_OUTLIERS.map((outlier) => ({ ...outlier, currency: displayCurrency }))
  const categorySpend = hasCategoryData
    ? overviewCategories.map((category) => ({
        name: category.category_name,
        amount: Math.abs(category.total),
      }))
    : hasOverviewData
      ? []
      : PLACEHOLDER_CATEGORIES
  const metricsLayoutTransition = {
    duration: prefersReducedMotion ? 0 : 0.28,
    ease: [0.25, 0.1, 0.25, 1],
  } as const
  const metricsBandContentRef = useRef<HTMLDivElement>(null)
  const [metricsBandHeight, setMetricsBandHeight] = useState<number | null>(null)
  const [dailyCashFlowMode, setDailyCashFlowMode] = useState<DailyCashFlowChartMode>('net')

  useLayoutEffect(() => {
    const element = metricsBandContentRef.current
    if (!element) return
    const metricsBandContent = element

    /**
     * Measures the metrics grid because its row count changes across responsive breakpoints
     */
    function updateHeight() {
      setMetricsBandHeight(metricsBandContent.getBoundingClientRect().height)
    }
    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(metricsBandContent)
    return () => observer.disconnect()
  }, [])

  return (
    <section className="relative" data-tooltip-bounds>
      <AnimatePresence>
        {loading && (
          <TransactionFilterLoadingOverlay
            placement="center"
            reducedMotion={prefersReducedMotion}
            label="Loading transaction summary"
          />
        )}
      </AnimatePresence>
      {!loading && !hasOverviewData && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-md"
          style={{
            background: 'color-mix(in srgb, var(--app-bg) 75%, transparent)',
            boxShadow: 'inset 0 0 40px 20px var(--app-bg)',
          }}
        >
          <p className="text-lg font-medium" style={{ color: 'var(--app-text-muted)' }}>
            {emptyOverlayMessage}
          </p>
        </div>
      )}

      <TopBandDivider className="mb-3" />
      <motion.div
        animate={metricsBandHeight === null ? undefined : { height: metricsBandHeight }}
        initial={false}
        transition={metricsLayoutTransition}
        style={{ overflow: 'hidden' }}
      >
        <div
          ref={metricsBandContentRef}
          className="grid grid-cols-1 items-start gap-y-5 pb-2 min-[730px]:grid-cols-2 min-[730px]:gap-y-6 min-[1750px]:grid-cols-3 min-[1750px]:gap-y-0"
        >
          <NetFlowSummary
            inflow={inflow}
            outflow={outflow}
            fxStatus={overview?.net_flow_fx_status}
            displayCurrency={displayCurrency}
            className="min-[730px]:col-span-2 min-[1750px]:col-span-1 min-[1750px]:pr-6"
          />
          <MostExpensiveTransactionsPanel
            outliers={outliers}
            fxStatus={overview?.outliers_fx_status}
            prefersReducedMotion={prefersReducedMotion}
            openingOutlierId={openingOutlierId}
            outlierOpenError={outlierOpenError}
            onOpenOutlierTransaction={onOpenOutlierTransaction}
            className="border-t border-[var(--app-border)] pt-3 min-[730px]:relative min-[730px]:pr-6 min-[730px]:after:absolute min-[730px]:after:bottom-0 min-[730px]:after:right-0 min-[730px]:after:top-3 min-[730px]:after:w-px min-[730px]:after:bg-[var(--app-border)] min-[730px]:after:content-[''] min-[1750px]:border-x min-[1750px]:border-t-0 min-[1750px]:px-6 min-[1750px]:pt-0 min-[1750px]:after:hidden"
          />
          <TopCategoriesChart
            categorySpend={categorySpend}
            fxStatus={overview?.top_categories_fx_status}
            displayCurrency={displayCurrency}
            chartAnimationKey={chartAnimationKey}
            prefersReducedMotion={prefersReducedMotion}
            className="border-t border-[var(--app-border)] pt-3 min-[730px]:pl-6 min-[1750px]:border-t-0 min-[1750px]:pt-0"
          />
        </div>
      </motion.div>

      <div className="mb-3 mt-2 flex items-center gap-4 min-[730px]:my-2">
        <div className="flex-1 h-px" style={{ background: 'var(--app-border-strong)' }} />
        <p className="shrink-0 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          Showing data for {rangeLabel}
        </p>
        <div className="flex-1 h-px" style={{ background: 'var(--app-border-strong)' }} />
      </div>

      <DailyCashFlowChart
        rawDailyFlow={overviewDailyCashFlow}
        fromDate={fromDate}
        toDate={toDate}
        fxStatus={overview?.daily_cash_flow_fx_status}
        showPlaceholderData={!hasOverviewData}
        displayCurrency={displayCurrency}
        chartAnimationKey={chartAnimationKey}
        prefersReducedMotion={prefersReducedMotion}
        mode={dailyCashFlowMode}
        onModeToggle={() => setDailyCashFlowMode((mode) => (mode === 'net' ? 'gross' : 'net'))}
      />
    </section>
  )
}
