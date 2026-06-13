import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from 'recharts'
import type { CategoryBreakdownEntry } from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import { SpendingBreakdownTooltipContent } from '@/dashboard/components/SpendingBreakdownTooltipContent'
import {
  BREAKDOWN_DONUT_TRANSITION,
  BREAKDOWN_PIE_ANIMATION_MS,
} from '@/dashboard/constants/animation'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import {
  getSpendingBreakdownEntryColor,
  type BreakdownMode,
  type SpendingBreakdownSummary,
} from '@/dashboard/utils/getSpendingBreakdownSummary'
import { applyCursorTooltipPosition } from '@/utils/tooltipPosition'

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
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredEntry, setHoveredEntry] = useState<CategoryBreakdownEntry | null>(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)

  /**
   * Keeps the portal tooltip aligned to the cursor within the chart bounds
   */
  function updateTooltipPosition(clientX: number, clientY: number) {
    const chart = chartRef.current
    const tooltip = tooltipRef.current
    if (!chart || !tooltip) return

    applyCursorTooltipPosition({
      origin: chart,
      tooltip,
      clientX,
      clientY,
      xProperty: '--breakdown-tooltip-x',
      yProperty: '--breakdown-tooltip-y',
    })
  }

  /**
   * Shows a tooltip only when Recharts resolves a concrete breakdown slice
   */
  function showTooltip(
    entry: CategoryBreakdownEntry | undefined,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    if (!entry) {
      setTooltipVisible(false)
      return
    }

    updateTooltipPosition(event.clientX, event.clientY)
    setHoveredEntry((current) => (
      current?.category_id === entry.category_id ? current : entry
    ))
    setTooltipVisible(true)
    requestAnimationFrame(() => updateTooltipPosition(event.clientX, event.clientY))
  }

  function hideTooltip() {
    setTooltipVisible(false)
  }

  /**
   * Keeps faded tooltip content mounted until the opacity transition finishes
   */
  function handleTooltipTransitionEnd(event: ReactTransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || tooltipVisible) return
    setHoveredEntry(null)
  }

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
