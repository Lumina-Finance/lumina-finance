import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { TransactionsOverview } from '@/api/transactions'
import TransactionFilterLoadingOverlay from '@/transactions/components/TransactionFilterLoadingOverlay'
import DailyCashFlowChart from '@/transactions/components/topBand/DailyCashFlowChart'
import MostExpensiveTransactionsPanel from '@/transactions/components/topBand/MostExpensiveTransactionsPanel'
import NetFlowSummary from '@/transactions/components/topBand/NetFlowSummary'
import TopCategoriesChart from '@/transactions/components/topBand/TopCategoriesChart'
import {
  PLACEHOLDER_CATEGORIES,
  PLACEHOLDER_FLOW,
  PLACEHOLDER_OUTLIERS,
} from '@/transactions/components/topBand/constants'

const topBandDividerStyle = {
  height: 1,
  background:
    'linear-gradient(to right, var(--app-accent), var(--app-accent-border), transparent)',
}

function TopBandDivider({ className = '' }: { className?: string }) {
  return <div className={className} style={topBandDividerStyle} />
}

export default function TransactionsTopBand({
  overview,
  displayCurrency,
  filterListLoading,
  rangeLabel,
  chartAnimationKey,
  prefersReducedMotion,
  openingOutlierId,
  outlierOpenError,
  onOpenOutlierTransaction,
}: {
  overview: TransactionsOverview | undefined
  displayCurrency: string
  filterListLoading: boolean
  rangeLabel: string
  chartAnimationKey: string
  prefersReducedMotion: boolean | null
  openingOutlierId: string | null
  outlierOpenError: string | null
  onOpenOutlierTransaction: (transactionId: string) => void
}) {
  // Null overview totals mean "no data"; placeholders preserve chart geometry under the empty overlay.
  const hasOverviewData = overview?.total_inflow !== null && overview?.total_inflow !== undefined
  const inflow = hasOverviewData ? overview!.total_inflow! : PLACEHOLDER_FLOW.total_inflow
  const outflow = hasOverviewData ? overview!.total_outflow! : PLACEHOLDER_FLOW.total_outflow
  const outliers = hasOverviewData ? (overview!.outliers ?? []) : PLACEHOLDER_OUTLIERS
  const categorySpend = hasOverviewData
    ? (overview!.top_categories ?? []).map((category) => ({
        name: category.category_name,
        amount: Math.abs(category.total),
      }))
    : PLACEHOLDER_CATEGORIES
  const metricsLayoutTransition = {
    duration: prefersReducedMotion ? 0 : 0.28,
    ease: [0.25, 0.1, 0.25, 1],
  } as const
  const metricsBandContentRef = useRef<HTMLDivElement>(null)
  const [metricsBandHeight, setMetricsBandHeight] = useState<number | null>(null)

  // Keep the animated metrics band height in sync with responsive content.
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
    <section className="relative" data-tooltip-bounds>
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
            displayCurrency={displayCurrency}
            prefersReducedMotion={prefersReducedMotion}
            openingOutlierId={openingOutlierId}
            outlierOpenError={outlierOpenError}
            onOpenOutlierTransaction={onOpenOutlierTransaction}
            className="border-t border-[var(--app-border)] pt-3 min-[730px]:relative min-[730px]:pr-6 min-[730px]:after:absolute min-[730px]:after:bottom-0 min-[730px]:after:right-0 min-[730px]:after:top-3 min-[730px]:after:w-px min-[730px]:after:bg-[var(--app-border)] min-[730px]:after:content-[''] min-[1750px]:border-x min-[1750px]:border-t-0 min-[1750px]:px-6 min-[1750px]:pt-0 min-[1750px]:after:hidden"
          />
          <TopCategoriesChart
            categorySpend={categorySpend}
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
        rawDailyFlow={overview?.daily_cash_flow ?? []}
        hasOverviewData={hasOverviewData}
        displayCurrency={displayCurrency}
        chartAnimationKey={chartAnimationKey}
        prefersReducedMotion={prefersReducedMotion}
      />
    </section>
  )
}
