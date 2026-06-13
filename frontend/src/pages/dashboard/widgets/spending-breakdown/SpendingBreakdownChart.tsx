import { useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from 'recharts'
import type { CategoryBreakdownEntry } from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/display/ScrambledNumber'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import {
  BREAKDOWN_DONUT_TRANSITION,
  BREAKDOWN_PIE_ANIMATION_MS,
} from '@/pages/dashboard/constants/animation'
import { useCursorTooltip } from '@/hooks/useCursorTooltip'
import { formatDashboardMoney } from '@/pages/dashboard/utils/formatDashboardMoney'
import {
  getSpendingBreakdownEntryColor,
  type BreakdownMode,
  type SpendingBreakdownSummary,
} from '@/pages/dashboard/utils/getSpendingBreakdownSummary'

import { SpendingBreakdownTooltipContent } from './SpendingBreakdownTooltipContent'

type SpendingBreakdownChartProps = {
  entries: CategoryBreakdownEntry[]
  total: number
  chartKey: string
  breakdownMode: BreakdownMode
  displayCurrency: string
  summary: SpendingBreakdownSummary
  shouldReduceMotion: boolean
}

/**
 * Renders the interactive spending breakdown donut chart and owns its tooltip state
 */
export function SpendingBreakdownChart({
  entries,
  total,
  chartKey,
  breakdownMode,
  displayCurrency,
  summary,
  shouldReduceMotion,
}: SpendingBreakdownChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const {
    tooltipRef,
    tooltipItem: hoveredEntry,
    tooltipVisible,
    showTooltip,
    hideTooltip,
    handleTooltipTransitionEnd,
  } = useCursorTooltip<CategoryBreakdownEntry, HTMLDivElement>({
    originRef: chartRef,
    xProperty: '--breakdown-tooltip-x',
    yProperty: '--breakdown-tooltip-y',
    getItemKey: (entry) => entry.category_id,
  })

  return (
    <div
      ref={chartRef}
      className="relative min-h-0 flex-1"
      onMouseLeave={hideTooltip}
    >
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="app-label app-label-compact">
          Total {breakdownMode === 'spending' ? 'Expense' : 'Income'}
        </span>
        <span className="font-financial mt-1 text-3xl font-normal tracking-tight max-[1000px]:text-[1.6875rem]">
          <AppScrambledNumber text={formatDashboardMoney(total, displayCurrency, 'breakdown')} />
        </span>
      </div>
      <AnimatePresence initial={false}>
        <motion.div
          key={chartKey}
          className="absolute inset-0"
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.975 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 1.015 }}
          transition={shouldReduceMotion ? { duration: 0 } : BREAKDOWN_DONUT_TRANSITION}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={entries}
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
                onMouseEnter={(_sector, index, event) => {
                  showTooltip(entries[index], event)
                }}
                onMouseMove={(_sector, index, event) => {
                  showTooltip(entries[index], event)
                }}
                onMouseLeave={hideTooltip}
              >
                {entries.map((entry) => (
                  <Cell
                    key={entry.category_id}
                    fill={getSpendingBreakdownEntryColor(entry, summary)}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </motion.div>
      </AnimatePresence>
      <CursorTooltipPortal
        ref={tooltipRef}
        className="min-w-40"
        onTransitionEnd={handleTooltipTransitionEnd}
        style={{
          opacity: tooltipVisible ? 1 : 0,
          transform: 'translate3d(var(--breakdown-tooltip-x, 0px), var(--breakdown-tooltip-y, 0px), 0)',
        }}
      >
        {hoveredEntry && (
          <SpendingBreakdownTooltipContent
            entry={hoveredEntry}
            breakdownMode={breakdownMode}
            displayCurrency={displayCurrency}
          />
        )}
      </CursorTooltipPortal>
    </div>
  )
}
